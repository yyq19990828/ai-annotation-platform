"""VideoPool · sam2_video predictor 的独立显存池 (v0.10.35 §B).

平行于 model_pool.py 的图片 ModelPool, 但:
  - key = `sam_variant` 单维 (video tracker 不用 GroundingDINO, 无 dino 维)。
  - 与图片池**显存预算独立、互不驱逐**: 各自一份权重, 同容器并存。
  - cap 由 `VIDEO_MODEL_POOL_CAP` (默认 1) 配; 独立 build_timeout。
  - idle 卸载独立: 由 main.py 的 video idle watcher 调 clear_all(), **不挂图片
    idle watcher** (两套池各自计时, 互不连带清空)。
  - 会话不在池层缓存: SAM2VideoTracker.propagate() 按 job 自行 init_state/reset_state,
    池只管模型权重的 build/LRU/释放 (权重可留供下个 job 复用)。

线程/协程模型同 ModelPool: FastAPI 单 worker, get() 在事件循环里跑; per-variant
asyncio.Lock 防同变体并发重复 build, build 本身丢到 executor。
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Literal

UTC = timezone.utc

if TYPE_CHECKING:
    from video_predictor import SAM2VideoTracker

logger = logging.getLogger("grounded-sam2-backend.video-pool")
EvictReason = Literal["lru", "manual", "idle_timeout"]


class VideoPool:
    """sam_variant → SAM2VideoTracker 的 LRU 池 (图片池之外的独立显存预算)。

    构造时注入两个回调避免反向依赖 main.py:
      - build_tracker(sam_variant): 同步构建 SAM2VideoTracker (executor 内调用)。
      - free_gpu_memory(): 驱逐 / 清空后释放 CUDA caching allocator。
    """

    def __init__(
        self,
        cap: int,
        build_tracker: Callable[[str], SAM2VideoTracker],
        free_gpu_memory: Callable[[], None],
        *,
        build_timeout: float = 60.0,
        idle_unload_seconds: float = 600.0,
    ) -> None:
        if cap <= 0:
            raise ValueError("cap must be positive")
        self._cap = cap
        self._build_tracker = build_tracker
        self._free_gpu_memory = free_gpu_memory
        self._build_timeout = build_timeout
        self._idle_unload_seconds = idle_unload_seconds

        self._trackers: OrderedDict[str, SAM2VideoTracker] = OrderedDict()
        self._lru_ts: dict[str, float] = {}
        self._variant_locks: dict[str, asyncio.Lock] = {}
        self._loaded_at: dict[str, datetime] = {}
        self._last_used_at: dict[str, datetime] = {}
        self._hit_count: dict[str, int] = {}
        self._last_evict: dict[str, Any] | None = None
        # 最近一次 video 请求时间 (idle watcher 用; 图片池的 _last_request_at 独立)。
        self._last_request_at = time.monotonic()

    @property
    def cap(self) -> int:
        return self._cap

    @property
    def idle_unload_seconds(self) -> float:
        return self._idle_unload_seconds

    @property
    def loaded(self) -> bool:
        return bool(self._trackers)

    def _lock_for(self, variant: str) -> asyncio.Lock:
        lock = self._variant_locks.get(variant)
        if lock is None:
            lock = asyncio.Lock()
            self._variant_locks[variant] = lock
        return lock

    @staticmethod
    def _key_str(sam_variant: str) -> str:
        """Protocol PoolStatus key. Video tracker pool is keyed by sam_variant."""
        return sam_variant

    def is_loaded(self, sam_variant: str) -> bool:
        return sam_variant in self._trackers

    async def get(self, sam_variant: str) -> SAM2VideoTracker:
        """命中返回已 build 的 tracker; miss 在 per-variant 锁内 build。

        超 build_timeout (排队等其他变体腾显存 / 等同变体 build) 抛 RuntimeError
        (main.py 翻成 503)。
        """
        self._last_request_at = time.monotonic()
        existing = self._trackers.get(sam_variant)
        if existing is not None:
            self._trackers.move_to_end(sam_variant)
            self._lru_ts[sam_variant] = time.monotonic()
            self._last_used_at[sam_variant] = datetime.now(UTC)
            self._hit_count[sam_variant] = self._hit_count.get(sam_variant, 0) + 1
            return existing

        lock = self._lock_for(sam_variant)
        try:
            await asyncio.wait_for(lock.acquire(), timeout=self._build_timeout)
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise RuntimeError(
                f"video pool busy: timed out building variant {sam_variant!r} "
                f"after {self._build_timeout}s"
            ) from exc
        try:
            existing = self._trackers.get(sam_variant)
            if existing is not None:
                self._trackers.move_to_end(sam_variant)
                self._lru_ts[sam_variant] = time.monotonic()
                self._last_used_at[sam_variant] = datetime.now(UTC)
                self._hit_count[sam_variant] = self._hit_count.get(sam_variant, 0) + 1
                return existing

            # 先腾位到 cap-1 再 build, 避免峰值 = (cap+1) 个模型。
            self._evict_until(self._cap - 1)
            loop = asyncio.get_running_loop()
            logger.info(
                "building video variant %r (pool size=%d/%d)",
                sam_variant,
                len(self._trackers),
                self._cap,
            )
            tracker = await loop.run_in_executor(None, self._build_tracker, sam_variant)
            now = datetime.now(UTC)
            self._trackers[sam_variant] = tracker
            self._trackers.move_to_end(sam_variant)
            self._lru_ts[sam_variant] = time.monotonic()
            self._loaded_at[sam_variant] = now
            self._last_used_at[sam_variant] = now
            self._hit_count[sam_variant] = 0
            logger.info(
                "video variant %r built; pool size=%d/%d",
                sam_variant,
                len(self._trackers),
                self._cap,
            )
            return tracker
        finally:
            lock.release()

    async def warmup(
        self, sam_variant: str
    ) -> tuple[bool, int | None, str | None]:
        """协议 §4.4 · 加载 video tracker 权重到池, 不跑 forward。

        与 ModelPool.warmup 接口对齐: 返回 (cache_hit, model_load_ms, evicted_key_str)。
        命中不算 hit_count (warmup ≠ predict 用), 仅 touch lru。
        """
        existing = self._trackers.get(sam_variant)
        if existing is not None:
            self._trackers.move_to_end(sam_variant)
            self._lru_ts[sam_variant] = time.monotonic()
            self._last_used_at[sam_variant] = datetime.now(UTC)
            return True, None, None

        lock = self._lock_for(sam_variant)
        try:
            await asyncio.wait_for(lock.acquire(), timeout=self._build_timeout)
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise RuntimeError(
                f"video pool busy: timed out warming up variant {sam_variant!r} "
                f"after {self._build_timeout}s"
            ) from exc
        try:
            existing = self._trackers.get(sam_variant)
            if existing is not None:
                self._trackers.move_to_end(sam_variant)
                self._lru_ts[sam_variant] = time.monotonic()
                self._last_used_at[sam_variant] = datetime.now(UTC)
                return True, None, None

            evict_marker = self._last_evict
            self._evict_until(self._cap - 1)
            evicted_key_str: str | None = None
            if self._last_evict is not None and self._last_evict is not evict_marker:
                evicted_key_str = self._last_evict["key"]

            loop = asyncio.get_running_loop()
            t0 = time.monotonic()
            tracker = await loop.run_in_executor(None, self._build_tracker, sam_variant)
            load_ms = int((time.monotonic() - t0) * 1000)
            now = datetime.now(UTC)
            self._trackers[sam_variant] = tracker
            self._trackers.move_to_end(sam_variant)
            self._lru_ts[sam_variant] = time.monotonic()
            self._loaded_at[sam_variant] = now
            self._last_used_at[sam_variant] = now
            self._hit_count[sam_variant] = 0
            logger.info(
                "video variant %r warmed up; pool size=%d/%d",
                sam_variant,
                len(self._trackers),
                self._cap,
            )
            return False, load_ms, evicted_key_str
        finally:
            lock.release()

    def _evict_until(self, target_size: int) -> None:
        while len(self._trackers) > max(0, target_size):
            evict_variant, tracker = self._trackers.popitem(last=False)
            logger.info("evicting LRU video variant %r", evict_variant)
            del tracker
            self._lru_ts.pop(evict_variant, None)
            self._loaded_at.pop(evict_variant, None)
            self._last_used_at.pop(evict_variant, None)
            self._hit_count.pop(evict_variant, None)
            self._free_gpu_memory()
            self._last_evict = {
                "key": self._key_str(evict_variant),
                "at": datetime.now(UTC),
                "reason": "lru",
            }

    def clear_all(self, *, reason: str = "manual") -> bool:
        """清空整池 (video idle watcher / 手动 unload)。返回是否清了东西。"""
        if not self._trackers:
            return False
        logger.info("clearing entire video pool (%d variants)", len(self._trackers))
        last_key = next(reversed(self._trackers))
        self._trackers.clear()
        self._lru_ts.clear()
        self._loaded_at.clear()
        self._last_used_at.clear()
        self._hit_count.clear()
        self._free_gpu_memory()
        evict_reason: EvictReason
        if reason == "idle_timeout":
            evict_reason = "idle_timeout"
        elif reason == "manual":
            evict_reason = "manual"
        else:
            evict_reason = "manual"
        self._last_evict = {
            "key": self._key_str(last_key),
            "at": datetime.now(UTC),
            "reason": evict_reason,
        }
        return True

    def maybe_idle_unload(self) -> bool:
        """video idle watcher 周期调用: 超 idle_unload_seconds 且非活跃则清空。

        有活跃会话时不卸载 (正在传播的 job 不能被抽走权重)。
        """
        if not self._trackers or self._idle_unload_seconds <= 0:
            return False
        if self.active_sessions() > 0:
            return False
        idle_for = time.monotonic() - self._last_request_at
        if idle_for >= self._idle_unload_seconds:
            logger.info("video pool idle %.0fs; clearing", idle_for)
            return self.clear_all(reason="idle_timeout")
        return False

    # ---------- 观测 ----------

    def active_sessions(self) -> int:
        return sum(t.active_sessions for t in self._trackers.values())

    def pool_status(self) -> dict[str, Any]:
        loaded_keys: list[dict[str, Any]] = []
        for sam_variant in self._trackers.keys():
            loaded_at = self._loaded_at.get(sam_variant)
            last_used = self._last_used_at.get(sam_variant, loaded_at)
            loaded_keys.append({
                "key": self._key_str(sam_variant),
                "loaded_at": loaded_at.isoformat() if loaded_at else None,
                "last_used_at": last_used.isoformat() if last_used else None,
                "hit_count": self._hit_count.get(sam_variant, 0),
            })
        last_evict: dict[str, Any] | None = None
        if self._last_evict is not None:
            last_evict = {
                "key": self._last_evict["key"],
                "at": self._last_evict["at"].isoformat(),
                "reason": self._last_evict["reason"],
            }
        return {
            "cap": self._cap,
            "current_size": len(self._trackers),
            "loaded_keys": loaded_keys,
            "last_evict": last_evict,
        }

    def health(self) -> dict[str, Any]:
        return {
            **self.pool_status(),
            "active_sessions": self.active_sessions(),
            "idle_seconds": round(time.monotonic() - self._last_request_at, 2),
            "idle_unload_seconds": self._idle_unload_seconds,
        }
