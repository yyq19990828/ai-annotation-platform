"""ModelPool v0.14.14 改造测试: cache_hit / load_ms / pool_status / warmup / evict.

不需要 ultralytics / GPU. 把 ModelPool.build_model 回调 mock 成同步 MagicMock,
直接验证 ModelPool 自己的运行时观测元数据是否符合协议 §4.3 PoolStatus.
"""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_modules() -> None:
    """让 model_pool 可导入: observability 模块依赖 prometheus_client + torch."""
    sys.modules.setdefault(
        "torch", MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False)))
    )


def _make_pool(cap: int = 2):
    """创建 ModelPool, build 回调返回 MagicMock model. 同步 build 模拟瞬时加载."""
    from model_pool import ModelPool

    def _build(task: str, series: str, size: str):
        return MagicMock(name=f"{series}-{size}-{task}")

    def _free():
        pass

    return ModelPool(cap=cap, build_model=_build, free_gpu_memory=_free, build_timeout=5.0)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_get_first_call_returns_cache_miss_with_load_ms() -> None:
    pool = _make_pool()
    model, cache_hit, load_ms = _run(pool.get("detection", "yolo11", "s"))
    assert model is not None
    assert cache_hit is False
    assert load_ms is not None and load_ms >= 0


def test_get_second_call_returns_cache_hit_with_none_load_ms() -> None:
    pool = _make_pool()
    _run(pool.get("detection", "yolo11", "s"))
    _, cache_hit, load_ms = _run(pool.get("detection", "yolo11", "s"))
    assert cache_hit is True
    assert load_ms is None


def test_get_increments_hit_count_only_on_hit() -> None:
    pool = _make_pool()
    _run(pool.get("detection", "yolo11", "s"))  # miss
    status = pool.pool_status()
    assert status["loaded_keys"][0]["hit_count"] == 0
    _run(pool.get("detection", "yolo11", "s"))  # hit 1
    _run(pool.get("detection", "yolo11", "s"))  # hit 2
    status = pool.pool_status()
    assert status["loaded_keys"][0]["hit_count"] == 2


def test_pool_status_shape_matches_protocol() -> None:
    """协议 §4.3 PoolStatus: {cap, current_size, loaded_keys: [{key, loaded_at, last_used_at, hit_count}], last_evict}."""
    pool = _make_pool(cap=2)
    _run(pool.get("detection", "yolo11", "s"))
    s = pool.pool_status()
    assert s["cap"] == 2
    assert s["current_size"] == 1
    assert s["last_evict"] is None
    assert len(s["loaded_keys"]) == 1
    item = s["loaded_keys"][0]
    assert item["key"] == "yolo11/s/detection"
    assert isinstance(item["loaded_at"], str) and "T" in item["loaded_at"]
    assert isinstance(item["last_used_at"], str)
    assert item["hit_count"] == 0


def test_pool_status_lru_evict_sets_last_evict_reason_lru() -> None:
    """cap=2 时塞 3 个 key, 最旧的应被 LRU 淘汰, last_evict.reason='lru'."""
    pool = _make_pool(cap=2)
    _run(pool.get("detection", "yolo11", "s"))
    _run(pool.get("detection", "yolo11", "m"))
    _run(pool.get("detection", "yolo11", "n"))
    s = pool.pool_status()
    assert s["current_size"] == 2
    assert s["last_evict"] is not None
    assert s["last_evict"]["key"] == "yolo11/s/detection"
    assert s["last_evict"]["reason"] == "lru"


def test_warmup_first_returns_miss_does_not_count_as_hit() -> None:
    pool = _make_pool()
    cache_hit, load_ms, evicted = _run(pool.warmup("detection", "yolo11", "s"))
    assert cache_hit is False
    assert load_ms is not None and load_ms >= 0
    assert evicted is None
    # 关键: hit_count = 0 (warmup 不算 hit)
    assert pool.pool_status()["loaded_keys"][0]["hit_count"] == 0


def test_warmup_second_returns_hit_with_none_load_ms() -> None:
    pool = _make_pool()
    _run(pool.warmup("detection", "yolo11", "s"))
    cache_hit, load_ms, evicted = _run(pool.warmup("detection", "yolo11", "s"))
    assert cache_hit is True
    assert load_ms is None
    assert evicted is None


def test_warmup_returns_evicted_key_when_pool_full() -> None:
    """cap=1 时 warmup 第二个 variant 应返回被 evict 的 key 名."""
    pool = _make_pool(cap=1)
    _run(pool.warmup("detection", "yolo11", "s"))
    cache_hit, _load_ms, evicted = _run(pool.warmup("detection", "yolo11", "m"))
    assert cache_hit is False
    assert evicted == "yolo11/s/detection"


def test_unload_all_idle_sets_last_evict_idle_timeout() -> None:
    pool = _make_pool()
    _run(pool.get("detection", "yolo11", "s"))
    n = _run(pool.unload_all(reason="idle"))
    assert n == 1
    s = pool.pool_status()
    assert s["current_size"] == 0
    assert s["last_evict"]["reason"] == "idle_timeout"


def test_unload_all_manual_sets_last_evict_manual() -> None:
    pool = _make_pool()
    _run(pool.get("detection", "yolo11", "s"))
    n = _run(pool.unload_all(reason="manual"))
    assert n == 1
    assert pool.pool_status()["last_evict"]["reason"] == "manual"


def test_pool_status_after_evict_loaded_keys_excludes_evicted() -> None:
    pool = _make_pool(cap=2)
    _run(pool.get("detection", "yolo11", "s"))
    _run(pool.get("detection", "yolo11", "m"))
    _run(pool.get("detection", "yolo11", "n"))
    keys = {k["key"] for k in pool.pool_status()["loaded_keys"]}
    assert "yolo11/s/detection" not in keys  # 已被 evict
    assert "yolo11/m/detection" in keys
    assert "yolo11/n/detection" in keys
