"""ModelPool · 单容器内 (sam_variant, dino_variant) 模型变体运行期热切换 (v0.10.23).

背景: v0.10.22 之前 grounded-sam2-backend 用全局单例 `_predictor` + 单 `_cache`,
变体由启动时 env `SAM_VARIANT`/`DINO_VARIANT` 锁死, 运行期不可变。本模块把那套
"按需 build / 释放显存 / idle 卸载" 的雏形扩成真正的 LRU pool, 让请求携带的
`(sam_variant, dino_variant)` 决定用哪个变体。

设计要点:
  - `OrderedDict[(sam,dino), GroundedSAM2Predictor]` LRU, cap 由 `MODEL_POOL_CAP` 配。
  - `async get(sam, dino)`: 命中 move_to_end; miss 在 **per-variant 锁**内
    用 `run_in_executor` build (1-3s 冷启), 防并发同变体重复 build。
  - 超 cap 驱逐 LRU 项: `del predictor` + 调 build_predictor 注入的 `free_gpu_memory()`,
    并连带 clear 该变体的 embedding cache 桶 (不同变体张量不可跨用, 必须隔离)。
  - pool 满 + 并发 miss: per-variant 锁排队, 超 `build_timeout` 返回 RuntimeError
    (main.py 翻成 503 "显存繁忙, 稍后重试")。
  - embedding cache 按变体分桶: `dict[(sam,dino), EmbeddingCache]`, 驱逐时连带清。
  - idle: main.py 的 idle watcher 调 `clear_all()` 清空整池。

线程/协程模型: FastAPI 单 worker, get() 在事件循环里跑; per-variant 锁是
asyncio.Lock。pool 自身的结构改动 (OrderedDict / dict 增删) 都在事件循环单线程内
完成, build 本身丢到 executor。
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime, timezone

UTC = timezone.utc
from typing import TYPE_CHECKING, Any, Literal

from embedding_cache import EmbeddingCache

if TYPE_CHECKING:
    from predictor import GroundedSAM2Predictor

logger = logging.getLogger("grounded-sam2-backend.pool")

VariantKey = tuple[str, str]
EvictReason = Literal["lru", "manual", "idle_timeout"]


class ModelPool:
    """(sam_variant, dino_variant) → GroundedSAM2Predictor 的 LRU 池。

    构造时注入两个回调, 避免 pool 反向依赖 main.py:
      - build_predictor(sam, dino, cache): 同步构建 predictor (会在 executor 内调用)。
      - free_gpu_memory(): 驱逐 / 清空后释放 CUDA caching allocator。
    """

    def __init__(
        self,
        cap: int,
        build_predictor: Callable[[str, str, EmbeddingCache], GroundedSAM2Predictor],
        free_gpu_memory: Callable[[], None],
        *,
        embedding_cache_size: int = 16,
        build_timeout: float = 30.0,
    ) -> None:
        if cap <= 0:
            raise ValueError("cap must be positive")
        self._cap = cap
        self._build_predictor = build_predictor
        self._free_gpu_memory = free_gpu_memory
        self._embedding_cache_size = embedding_cache_size
        self._build_timeout = build_timeout

        self._predictors: OrderedDict[VariantKey, GroundedSAM2Predictor] = OrderedDict()
        self._caches: dict[VariantKey, EmbeddingCache] = {}
        self._lru_ts: dict[VariantKey, float] = {}
        # per-variant 锁: 同一变体并发 miss 只 build 一次; 不同变体可并行排队。
        self._variant_locks: dict[VariantKey, asyncio.Lock] = {}
        # v0.14.14: 运行时观测元数据 (协议 §4.3 PoolStatus). 老 `_evict_count` 累加值
        # 在 v0.14.15 起被 _last_evict 详细记录替代; loaded_at/last_used_at/hit_count
        # 是 LoadedKey 元数据.
        self._loaded_at: dict[VariantKey, datetime] = {}
        self._last_used_at: dict[VariantKey, datetime] = {}
        self._hit_count: dict[VariantKey, int] = {}
        self._last_evict: dict[str, Any] | None = None

    @property
    def cap(self) -> int:
        return self._cap

    def is_loaded(self, sam_variant: str, dino_variant: str) -> bool:
        """协议 §4.3 之前曾用 `(sv, dv) in pool.loaded_variants()` 判断; v0.14.14 之后
        消费方应走 pool_status()['loaded_keys'], 内部调用方用本 helper."""
        return (sam_variant, dino_variant) in self._predictors

    def _lock_for(self, key: VariantKey) -> asyncio.Lock:
        lock = self._variant_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._variant_locks[key] = lock
        return lock

    def cache_for(self, sam_variant: str, dino_variant: str) -> EmbeddingCache:
        """返回该变体的 embedding cache 桶 (首次访问时按需建)。

        cache_key 已含 sam_variant (compute_cache_key), 但桶仍按 variant 隔离,
        驱逐 predictor 时连带 clear 才不会留悬挂张量占显存。
        """
        key: VariantKey = (sam_variant, dino_variant)
        cache = self._caches.get(key)
        if cache is None:
            cache = EmbeddingCache(capacity=self._embedding_cache_size, sam_variant=sam_variant)
            self._caches[key] = cache
        return cache

    @staticmethod
    def _key_str(key: VariantKey) -> str:
        """v0.14.14: 协议 §4.3 opaque key 序列化. gsam2 用 sam=X/dino=Y."""
        sv, dv = key
        return f"sam={sv}/dino={dv}"

    async def get(
        self, sam_variant: str, dino_variant: str
    ) -> tuple[GroundedSAM2Predictor, bool, int | None]:
        """v0.14.14: 返回 (predictor, cache_hit, model_load_ms).

        - cache_hit=True 时 load_ms=None (命中复用, 无加载耗时)
        - cache_hit=False 时 load_ms 是本次 build 毫秒

        miss 在 per-variant 锁内 build; 超 build_timeout 抛 RuntimeError。
        """
        key: VariantKey = (sam_variant, dino_variant)
        existing = self._predictors.get(key)
        if existing is not None:
            self._predictors.move_to_end(key)
            self._lru_ts[key] = time.monotonic()
            self._last_used_at[key] = datetime.now(UTC)
            self._hit_count[key] = self._hit_count.get(key, 0) + 1
            return existing, True, None

        lock = self._lock_for(key)
        try:
            await asyncio.wait_for(lock.acquire(), timeout=self._build_timeout)
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise RuntimeError(
                f"model pool busy: timed out building variant {key} "
                f"after {self._build_timeout}s"
            ) from exc
        try:
            # double-check: 等锁期间别的协程可能已 build 好同变体。
            existing = self._predictors.get(key)
            if existing is not None:
                self._predictors.move_to_end(key)
                self._lru_ts[key] = time.monotonic()
                self._last_used_at[key] = datetime.now(UTC)
                self._hit_count[key] = self._hit_count.get(key, 0) + 1
                return existing, True, None

            # 先腾位 (驱逐到 cap-1), 再 build 新变体, 避免峰值显存 = (cap+1) 个模型。
            self._evict_until(self._cap - 1)
            cache = self.cache_for(sam_variant, dino_variant)
            loop = asyncio.get_running_loop()
            logger.info(
                "building variant %s (pool size=%d/%d)", key, len(self._predictors), self._cap
            )
            t0 = time.monotonic()
            predictor = await loop.run_in_executor(
                None, self._build_predictor, sam_variant, dino_variant, cache
            )
            load_ms = int((time.monotonic() - t0) * 1000)
            now = datetime.now(UTC)
            self._predictors[key] = predictor
            self._predictors.move_to_end(key)
            self._lru_ts[key] = time.monotonic()
            self._loaded_at[key] = now
            self._last_used_at[key] = now
            self._hit_count[key] = 0
            logger.info("variant %s built; pool size=%d/%d", key, len(self._predictors), self._cap)
            return predictor, False, load_ms
        finally:
            lock.release()

    async def warmup(
        self, sam_variant: str, dino_variant: str
    ) -> tuple[bool, int | None, str | None]:
        """v0.14.14 协议 §4.4: 加载权重不算 hit, 不跑 forward.

        返回 (cache_hit, model_load_ms, evicted_key_str).
        """
        key: VariantKey = (sam_variant, dino_variant)
        existing = self._predictors.get(key)
        if existing is not None:
            self._predictors.move_to_end(key)
            self._lru_ts[key] = time.monotonic()
            self._last_used_at[key] = datetime.now(UTC)
            return True, None, None

        lock = self._lock_for(key)
        try:
            await asyncio.wait_for(lock.acquire(), timeout=self._build_timeout)
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise RuntimeError(
                f"model pool busy: timed out warming up variant {key} "
                f"after {self._build_timeout}s"
            ) from exc
        try:
            existing = self._predictors.get(key)
            if existing is not None:
                self._predictors.move_to_end(key)
                self._lru_ts[key] = time.monotonic()
                self._last_used_at[key] = datetime.now(UTC)
                return True, None, None

            # 记录本次 warmup 之前的 last_evict 引用, 用于判断是否新触发 evict.
            evict_marker = self._last_evict
            self._evict_until(self._cap - 1)
            evicted_key_str: str | None = None
            if self._last_evict is not None and self._last_evict is not evict_marker:
                evicted_key_str = self._last_evict["key"]

            cache = self.cache_for(sam_variant, dino_variant)
            loop = asyncio.get_running_loop()
            t0 = time.monotonic()
            predictor = await loop.run_in_executor(
                None, self._build_predictor, sam_variant, dino_variant, cache
            )
            load_ms = int((time.monotonic() - t0) * 1000)
            now = datetime.now(UTC)
            self._predictors[key] = predictor
            self._predictors.move_to_end(key)
            self._lru_ts[key] = time.monotonic()
            self._loaded_at[key] = now
            self._last_used_at[key] = now
            self._hit_count[key] = 0  # warmup 不算 hit
            logger.info("variant %s warmed; pool size=%d/%d", key, len(self._predictors), self._cap)
            return False, load_ms, evicted_key_str
        finally:
            lock.release()

    def _evict_until(self, target_size: int) -> None:
        """驱逐 LRU 项直到 pool size <= target_size。同步, 在事件循环内调用。"""
        while len(self._predictors) > max(0, target_size):
            evict_key, predictor = self._predictors.popitem(last=False)
            logger.info("evicting LRU variant %s", evict_key)
            del predictor
            self._lru_ts.pop(evict_key, None)
            self._loaded_at.pop(evict_key, None)
            self._last_used_at.pop(evict_key, None)
            self._hit_count.pop(evict_key, None)
            cache = self._caches.get(evict_key)
            if cache is not None:
                cache.clear()
            self._free_gpu_memory()
            self._last_evict = {
                "key": self._key_str(evict_key),
                "at": datetime.now(UTC),
                "reason": "lru",
            }

    def clear_all(self, *, reason: str = "manual") -> bool:
        """清空整池 + 各 cache 桶 (idle watcher / 手动 unload)。返回是否清了东西。

        v0.14.14: reason 参数区分 idle_timeout / manual, 用于 PoolStatus.last_evict.
        """
        if not self._predictors:
            return False
        logger.info("clearing entire pool (%d variants, reason=%s)", len(self._predictors), reason)
        # 记录最后一个 key 作为 last_evict 代表条目.
        last_key = next(reversed(self._predictors))
        self._predictors.clear()
        self._lru_ts.clear()
        self._loaded_at.clear()
        self._last_used_at.clear()
        self._hit_count.clear()
        for cache in self._caches.values():
            cache.clear()
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

    # ---------- 观测 ----------

    @property
    def loaded(self) -> bool:
        return bool(self._predictors)

    def pool_status(self) -> dict[str, Any]:
        """v0.14.14 协议 §4.3 PoolStatus: cap / current_size / loaded_keys / last_evict."""
        loaded_keys: list[dict[str, Any]] = []
        for key in self._predictors.keys():
            loaded_at = self._loaded_at.get(key)
            last_used = self._last_used_at.get(key, loaded_at)
            loaded_keys.append({
                "key": self._key_str(key),
                "loaded_at": loaded_at.isoformat() if loaded_at else None,
                "last_used_at": last_used.isoformat() if last_used else None,
                "hit_count": self._hit_count.get(key, 0),
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
            "current_size": len(self._predictors),
            "loaded_keys": loaded_keys,
            "last_evict": last_evict,
        }

    def aggregate_cache_stats(self) -> dict:
        """聚合各桶 cache stats: 整体 size/hits/misses + 各变体明细。"""
        buckets: dict[str, dict] = {}
        total_size = total_hits = total_misses = 0
        for (sv, dv), cache in self._caches.items():
            s = cache.stats()
            buckets[f"{sv}/{dv}"] = s
            total_size += s["size"]
            total_hits += s["hits"]
            total_misses += s["misses"]
        total = total_hits + total_misses
        return {
            "size": total_size,
            "hits": total_hits,
            "misses": total_misses,
            "hit_rate": round(total_hits / total, 4) if total else 0.0,
            "buckets": buckets,
        }

    def total_cache_size(self) -> int:
        return sum(cache.size() for cache in self._caches.values())
