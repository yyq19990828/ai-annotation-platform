"""v0.14.14 ModelPool 改造测试: cache_hit / load_ms / pool_status / warmup / evict.

不需要真实 SAM/DINO checkpoint. 把 ModelPool.build_predictor 回调 mock 成 MagicMock,
直接验证 ModelPool 自己的运行时观测元数据是否符合协议 §4.3 PoolStatus.
"""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_modules() -> None:
    sys.modules.setdefault(
        "torch", MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False)))
    )


def _make_pool(cap: int = 2):
    from model_pool import ModelPool
    from embedding_cache import EmbeddingCache

    def _build(sv: str, dv: str, cache: EmbeddingCache):
        return MagicMock(name=f"predictor-{sv}-{dv}")

    def _free():
        pass

    return ModelPool(
        cap=cap,
        build_predictor=_build,
        free_gpu_memory=_free,
        embedding_cache_size=8,
        build_timeout=5.0,
    )


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_get_first_call_returns_cache_miss_with_load_ms() -> None:
    pool = _make_pool()
    pred, cache_hit, load_ms = _run(pool.get("tiny", "T"))
    assert pred is not None
    assert cache_hit is False
    assert load_ms is not None and load_ms >= 0


def test_get_second_call_returns_cache_hit_with_none_load_ms() -> None:
    pool = _make_pool()
    _run(pool.get("tiny", "T"))
    _, cache_hit, load_ms = _run(pool.get("tiny", "T"))
    assert cache_hit is True
    assert load_ms is None


def test_get_increments_hit_count_only_on_hit() -> None:
    pool = _make_pool()
    _run(pool.get("tiny", "T"))  # miss
    assert pool.pool_status()["loaded_keys"][0]["hit_count"] == 0
    _run(pool.get("tiny", "T"))
    _run(pool.get("tiny", "T"))
    assert pool.pool_status()["loaded_keys"][0]["hit_count"] == 2


def test_pool_status_shape_matches_protocol() -> None:
    pool = _make_pool(cap=2)
    _run(pool.get("tiny", "T"))
    s = pool.pool_status()
    assert s["cap"] == 2
    assert s["current_size"] == 1
    assert s["last_evict"] is None
    assert len(s["loaded_keys"]) == 1
    item = s["loaded_keys"][0]
    assert item["key"] == "sam=tiny/dino=T"
    assert isinstance(item["loaded_at"], str) and "T" in item["loaded_at"]
    assert isinstance(item["last_used_at"], str)
    assert item["hit_count"] == 0


def test_pool_status_lru_evict_sets_last_evict() -> None:
    pool = _make_pool(cap=1)
    _run(pool.get("tiny", "T"))
    _run(pool.get("small", "T"))  # 触发 evict
    s = pool.pool_status()
    assert s["current_size"] == 1
    assert s["last_evict"] is not None
    assert s["last_evict"]["key"] == "sam=tiny/dino=T"
    assert s["last_evict"]["reason"] == "lru"


def test_warmup_first_returns_miss_does_not_count_as_hit() -> None:
    pool = _make_pool()
    cache_hit, load_ms, evicted = _run(pool.warmup("tiny", "T"))
    assert cache_hit is False
    assert load_ms is not None and load_ms >= 0
    assert evicted is None
    assert pool.pool_status()["loaded_keys"][0]["hit_count"] == 0


def test_warmup_second_returns_hit_with_none_load_ms() -> None:
    pool = _make_pool()
    _run(pool.warmup("tiny", "T"))
    cache_hit, load_ms, evicted = _run(pool.warmup("tiny", "T"))
    assert cache_hit is True
    assert load_ms is None
    assert evicted is None


def test_warmup_returns_evicted_key_when_pool_full() -> None:
    pool = _make_pool(cap=1)
    _run(pool.warmup("tiny", "T"))
    cache_hit, _load_ms, evicted = _run(pool.warmup("small", "T"))
    assert cache_hit is False
    assert evicted == "sam=tiny/dino=T"


def test_clear_all_idle_sets_last_evict_idle_timeout() -> None:
    pool = _make_pool()
    _run(pool.get("tiny", "T"))
    pool.clear_all(reason="idle_timeout")
    s = pool.pool_status()
    assert s["current_size"] == 0
    assert s["last_evict"]["reason"] == "idle_timeout"


def test_clear_all_manual_sets_last_evict_manual() -> None:
    pool = _make_pool()
    _run(pool.get("tiny", "T"))
    pool.clear_all(reason="manual")
    assert pool.pool_status()["last_evict"]["reason"] == "manual"


def test_health_still_contains_legacy_fields() -> None:
    """v0.14.14: health() 仍输出老字段, 让 admin/前端老消费方过渡."""
    pool = _make_pool()
    _run(pool.get("tiny", "T"))
    h = pool.health()
    assert "loaded_variants" in h
    assert "evict_count" in h
    assert "per_variant_lru_ts" in h
    assert h["cap"] == 2
