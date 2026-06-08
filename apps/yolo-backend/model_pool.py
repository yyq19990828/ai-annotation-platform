"""ModelPool · 单容器内 (task, series, size) → ultralytics YOLO 模型 LRU 池.

设计要点 (与 grounded-sam2-backend/model_pool.py 同源, 但简化):
  - 无 embedding cache (yolo 是纯前向, 无 image embedding 复用价值)
  - 无 per-variant locks 复杂度 (yolo 模型 build 是 ultralytics.YOLO(path) 单行,
    秒级冷启, 不存在多并发同 key 重复 build 把显存撑爆的风险, 用单全局锁即可)
  - LRU 容量由 env `YOLO_MODEL_POOL_CAP` 配, 默认 2 (单 4060 8G 装两个 m/l 安全)
  - 命中 move_to_end; miss 时同步 build (`run_in_executor`); 超 cap 删 LRU 头部
  - idle: main.py 的 idle watcher 调 `unload_all()` 清空整池

线程/协程模型: FastAPI 单 worker, `get()` 在事件循环里; build 丢 executor.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import TYPE_CHECKING

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
        self._lru_ts: dict[ModelKey, float] = {}
        self._lock = asyncio.Lock()

    @property
    def cap(self) -> int:
        return self._cap

    def __len__(self) -> int:
        return len(self._models)

    def has(self, key: ModelKey) -> bool:
        return key in self._models

    async def get(self, task: str, series: str, size: str) -> "YOLO":
        key: ModelKey = (task, series, size)
        async with self._lock:
            if key in self._models:
                self._models.move_to_end(key)
                self._lru_ts[key] = time.time()
                return self._models[key]

            # miss: build + insert. build 走 executor 不阻塞事件循环.
            loop = asyncio.get_running_loop()
            try:
                model = await asyncio.wait_for(
                    loop.run_in_executor(None, self._build_model, task, series, size),
                    timeout=self._build_timeout,
                )
            except asyncio.TimeoutError as exc:
                raise RuntimeError(
                    f"model build timeout ({self._build_timeout}s) for {key}"
                ) from exc
            record_pool_load(task, series, size)

            # evict LRU 头部直到 cap 内.
            while len(self._models) >= self._cap:
                evicted_key, evicted_model = self._models.popitem(last=False)
                self._lru_ts.pop(evicted_key, None)
                del evicted_model
                gc.collect()
                self._free_gpu_memory()
                record_pool_evict()
                logger.info("model_pool evicted %s", evicted_key)

            self._models[key] = model
            self._lru_ts[key] = time.time()
            update_pool_size(len(self._models))
            return model

    async def unload_all(self, *, reason: str = "idle") -> int:
        async with self._lock:
            n = len(self._models)
            if n == 0:
                return 0
            for key in list(self._models.keys()):
                model = self._models.pop(key)
                self._lru_ts.pop(key, None)
                del model
            gc.collect()
            self._free_gpu_memory()
            update_pool_size(0)
            if reason == "idle":
                for _ in range(n):
                    record_pool_idle_unload()
            logger.info("model_pool unloaded all %d models (reason=%s)", n, reason)
            return n

    def loaded_keys(self) -> list[ModelKey]:
        return list(self._models.keys())

    def last_used_at(self) -> float | None:
        if not self._lru_ts:
            return None
        return max(self._lru_ts.values())


__all__ = ["ModelPool", "ModelKey"]
