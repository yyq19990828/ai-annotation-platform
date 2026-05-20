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
from typing import TYPE_CHECKING

from embedding_cache import EmbeddingCache

if TYPE_CHECKING:
    from predictor import GroundedSAM2Predictor

logger = logging.getLogger("grounded-sam2-backend.pool")

VariantKey = tuple[str, str]


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
        self._evict_count = 0

    @property
    def cap(self) -> int:
        return self._cap

    @property
    def evict_count(self) -> int:
        return self._evict_count

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

    async def get(self, sam_variant: str, dino_variant: str) -> GroundedSAM2Predictor:
        """命中返回已 build 的 predictor; miss 在 per-variant 锁内 build。

        超 build_timeout (排队等其他变体腾显存 / 等同变体 build) 抛 RuntimeError。
        """
        key: VariantKey = (sam_variant, dino_variant)
        existing = self._predictors.get(key)
        if existing is not None:
            self._predictors.move_to_end(key)
            self._lru_ts[key] = time.monotonic()
            return existing

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
                return existing

            # 先腾位 (驱逐到 cap-1), 再 build 新变体, 避免峰值显存 = (cap+1) 个模型。
            self._evict_until(self._cap - 1)
            cache = self.cache_for(sam_variant, dino_variant)
            loop = asyncio.get_running_loop()
            logger.info(
                "building variant %s (pool size=%d/%d)", key, len(self._predictors), self._cap
            )
            predictor = await loop.run_in_executor(
                None, self._build_predictor, sam_variant, dino_variant, cache
            )
            self._predictors[key] = predictor
            self._predictors.move_to_end(key)
            self._lru_ts[key] = time.monotonic()
            logger.info("variant %s built; pool size=%d/%d", key, len(self._predictors), self._cap)
            return predictor
        finally:
            lock.release()

    def _evict_until(self, target_size: int) -> None:
        """驱逐 LRU 项直到 pool size <= target_size。同步, 在事件循环内调用。"""
        while len(self._predictors) > max(0, target_size):
            evict_key, predictor = self._predictors.popitem(last=False)
            logger.info("evicting LRU variant %s", evict_key)
            del predictor
            self._lru_ts.pop(evict_key, None)
            cache = self._caches.get(evict_key)
            if cache is not None:
                cache.clear()
            self._free_gpu_memory()
            self._evict_count += 1

    def clear_all(self) -> bool:
        """清空整池 + 各 cache 桶 (idle watcher / 手动 unload)。返回是否清了东西。"""
        if not self._predictors:
            return False
        logger.info("clearing entire pool (%d variants)", len(self._predictors))
        self._predictors.clear()
        self._lru_ts.clear()
        for cache in self._caches.values():
            cache.clear()
        self._free_gpu_memory()
        return True

    # ---------- 观测 ----------

    @property
    def loaded(self) -> bool:
        return bool(self._predictors)

    def loaded_variants(self) -> list[dict]:
        """已加载变体列表 (LRU 顺序, 最近用在后)。"""
        return [{"sam_variant": sv, "dino_variant": dv} for (sv, dv) in self._predictors.keys()]

    def per_variant_lru_ts(self) -> dict[str, float]:
        """每变体最近访问的 monotonic 时间戳 (key 用 'sam/dino' 字面)。"""
        return {f"{sv}/{dv}": round(ts, 2) for (sv, dv), ts in self._lru_ts.items()}

    def health(self) -> dict:
        return {
            "cap": self._cap,
            "loaded_variants": self.loaded_variants(),
            "evict_count": self._evict_count,
            "per_variant_lru_ts": self.per_variant_lru_ts(),
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
