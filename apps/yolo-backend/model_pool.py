"""ModelPool · 单容器内 (task, series, size) → ultralytics YOLO 模型 LRU 池.

设计要点 (与 grounded-sam2-backend/model_pool.py 同源, 但简化):
  - 无 embedding cache (yolo 是纯前向, 无 image embedding 复用价值)
  - 无 per-variant locks 复杂度 (yolo 模型 build 是 ultralytics.YOLO(path) 单行,
    秒级冷启, 不存在多并发同 key 重复 build 把显存撑爆的风险, 用单全局锁即可)
  - LRU 容量由 env `YOLO_MODEL_POOL_CAP` 配, 默认 2 (单 4060 8G 装两个 m/l 安全)
  - 命中 move_to_end; miss 时同步 build (`run_in_executor`); 超 cap 删 LRU 头部
  - idle: main.py 的 idle watcher 调 `unload_all()` 清空整池

v0.14.14: pool 暴露 PoolStatus 统一 schema (协议 §4.3), 含 loaded_at/last_used_at/
hit_count/last_evict, 供模型市场列表与运维卡片渲染.

线程/协程模型: FastAPI 单 worker, `get()` 在事件循环里; build 丢 executor.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from observability import (
    record_pool_evict,
    record_pool_idle_unload,
    record_pool_load,
    update_pool_size,
)

if TYPE_CHECKING:
    from ultralytics import YOLO

logger = logging.getLogger("yolo-backend.pool")

ModelKey = tuple[str, str, str]  # (task, series, size)
EvictReason = Literal["lru", "manual", "idle_timeout"]


class ModelPool:
    """(task, series, size) → ultralytics.YOLO 的 LRU 池.

    `build_model` 回调由 main 注入, 负责把 weight filename 解析为绝对路径并 load 模型.
    """

    def __init__(
        self,
        cap: int,
        build_model: Callable[[str, str, str], "YOLO"],
        free_gpu_memory: Callable[[], None],
        *,
        build_timeout: float = 30.0,
    ) -> None:
        if cap <= 0:
            raise ValueError("cap must be positive")
        self._cap = cap
        self._build_model = build_model
        self._free_gpu_memory = free_gpu_memory
        self._build_timeout = build_timeout

        self._models: OrderedDict[ModelKey, "YOLO"] = OrderedDict()
        # v0.14.14: 运行时观测元数据 (协议 §4.3 PoolStatus 字段源).
        self._loaded_at: dict[ModelKey, datetime] = {}
        self._last_used_at: dict[ModelKey, datetime] = {}
        self._hit_count: dict[ModelKey, int] = {}
        self._lru_ts: dict[ModelKey, float] = {}  # idle watcher 用 monotonic 秒
        self._last_evict: dict[str, Any] | None = None
        self._lock = asyncio.Lock()

    @property
    def cap(self) -> int:
        return self._cap

    def __len__(self) -> int:
        return len(self._models)

    def has(self, key: ModelKey) -> bool:
        return key in self._models

    @staticmethod
    def _key_str(key: ModelKey) -> str:
        """v0.14.14: 序列化为协议 §4.3 的 opaque key. yolo 用 series/size/task."""
        task, series, size = key
        return f"{series}/{size}/{task}"

    async def get(self, task: str, series: str, size: str) -> tuple["YOLO", bool, int | None]:
        """v0.14.14 起返回 (model, cache_hit, load_ms).

        - cache_hit=True 时 load_ms=None (命中复用, 无加载耗时)
        - cache_hit=False 时 load_ms 是本次 disk→GPU 加载毫秒
        """
        key: ModelKey = (task, series, size)
        async with self._lock:
            if key in self._models:
                self._models.move_to_end(key)
                now_mono = time.time()
                self._lru_ts[key] = now_mono
                self._last_used_at[key] = datetime.now(UTC)
                self._hit_count[key] = self._hit_count.get(key, 0) + 1
                return self._models[key], True, None
            load_ms, _evicted = await self._build_and_insert(key)
            return self._models[key], False, load_ms

    async def warmup(self, task: str, series: str, size: str) -> tuple[bool, int | None, str | None]:
        """v0.14.14 协议 §4.4 端点支撑: 加载权重但不算 hit, 也不跑 forward.

        返回 (cache_hit, load_ms, evicted_key_str). evicted 仅本次因 cap 而淘汰其他
        key 时不为空, 供前端 toast 提示.
        """
        key: ModelKey = (task, series, size)
        async with self._lock:
            if key in self._models:
                # 已加载: 不算 hit (warmup 不增 hit_count). 但更新 last_used_at 让 LRU 不在
                # 下一次 miss 时立刻把它评成牺牲者.
                self._models.move_to_end(key)
                self._lru_ts[key] = time.time()
                self._last_used_at[key] = datetime.now(UTC)
                return True, None, None
            load_ms, evicted = await self._build_and_insert(key)
            return False, load_ms, evicted

    async def _build_and_insert(self, key: ModelKey) -> tuple[int, str | None]:
        """caller 已持锁. miss 路径: build + evict_until_cap + insert.

        返回 (load_ms, evicted_key_str). evicted_key_str 仅在本次因 cap 上限触发了
        LRU 淘汰时不为空 (取最后一个被淘汰的 key, 通常 evict_until 循环只跑 0 或 1 次).
        """
        task, series, size = key
        loop = asyncio.get_running_loop()
        t0 = time.monotonic()
        try:
            model = await asyncio.wait_for(
                loop.run_in_executor(None, self._build_model, task, series, size),
                timeout=self._build_timeout,
            )
        except asyncio.TimeoutError as exc:
            raise RuntimeError(
                f"model build timeout ({self._build_timeout}s) for {key}"
            ) from exc
        load_ms = int((time.monotonic() - t0) * 1000)
        record_pool_load(task, series, size)

        build_at = datetime.now(UTC)

        # evict LRU 头部直到 cap 内. 本次循环内被淘汰的 key 记到 evicted_this_call.
        evicted_this_call: str | None = None
        while len(self._models) >= self._cap:
            evicted_key, evicted_model = self._models.popitem(last=False)
            self._lru_ts.pop(evicted_key, None)
            self._loaded_at.pop(evicted_key, None)
            self._last_used_at.pop(evicted_key, None)
            self._hit_count.pop(evicted_key, None)
            del evicted_model
            gc.collect()
            self._free_gpu_memory()
            record_pool_evict()
            evicted_this_call = self._key_str(evicted_key)
            self._last_evict = {
                "key": evicted_this_call,
                "at": datetime.now(UTC),
                "reason": "lru",
            }
            logger.info("model_pool evicted %s", evicted_key)

        self._models[key] = model
        self._lru_ts[key] = time.time()
        self._loaded_at[key] = build_at
        self._last_used_at[key] = build_at
        self._hit_count[key] = 0
        update_pool_size(len(self._models))
        return load_ms, evicted_this_call

    async def unload_all(self, *, reason: str = "idle") -> int:
        async with self._lock:
            n = len(self._models)
            if n == 0:
                return 0
            last_key = next(reversed(self._models))
            for key in list(self._models.keys()):
                model = self._models.pop(key)
                self._lru_ts.pop(key, None)
                self._loaded_at.pop(key, None)
                self._last_used_at.pop(key, None)
                self._hit_count.pop(key, None)
                del model
            gc.collect()
            self._free_gpu_memory()
            update_pool_size(0)
            if reason == "idle":
                for _ in range(n):
                    record_pool_idle_unload()
                evict_reason: EvictReason = "idle_timeout"
            elif reason == "manual":
                evict_reason = "manual"
            else:  # "shutdown" 等 → 归 manual
                evict_reason = "manual"
            self._last_evict = {
                "key": self._key_str(last_key),
                "at": datetime.now(UTC),
                "reason": evict_reason,
            }
            logger.info("model_pool unloaded all %d models (reason=%s)", n, reason)
            return n

    def loaded_keys(self) -> list[ModelKey]:
        return list(self._models.keys())

    def last_used_at(self) -> float | None:
        if not self._lru_ts:
            return None
        return max(self._lru_ts.values())

    def pool_status(self) -> dict[str, Any]:
        """v0.14.14 协议 §4.3 PoolStatus 统一格式 (序列化为可 JSON 的 dict).

        datetime 输出为 ISO 8601 字符串, 前端不需要解析时间, 只看 hit_count 与 key.
        """
        loaded_keys: list[dict[str, Any]] = []
        for key in self._models.keys():
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
            "current_size": len(self._models),
            "loaded_keys": loaded_keys,
            "last_evict": last_evict,
        }


__all__ = ["ModelPool", "ModelKey"]
