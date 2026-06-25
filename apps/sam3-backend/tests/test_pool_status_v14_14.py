"""v0.14.14 sam3 PoolStatus + /warmup 单测.

sam3 单档无 ModelPool, 但仍按协议 §4.3 PoolStatus 格式输出 /health.pool.
"""

from __future__ import annotations

import asyncio
import sys
import types
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def main_module(monkeypatch):
    if "torch" not in sys.modules:
        torch_stub = types.ModuleType("torch")
        torch_stub.cuda = types.SimpleNamespace(
            is_available=lambda: False,
            empty_cache=lambda: None,
            ipc_collect=lambda: None,
            mem_get_info=lambda: (0, 0),
            get_device_name=lambda _index: "stub",
        )
        sys.modules["torch"] = torch_stub
    fake_sam3_mod = types.ModuleType("sam3")
    fake_sam3_mod.build_sam3_image_model = MagicMock(return_value=MagicMock())
    sys.modules["sam3"] = fake_sam3_mod

    sys.modules.pop("main", None)
    import main as m  # noqa: PLC0415

    monkeypatch.setattr(m, "_build_predictor", lambda: MagicMock(device="cpu"))
    m._predictor = None
    m._idle_task = None
    m._pool_loaded_at = None
    m._pool_last_used_at = None
    m._pool_hit_count = 0
    m._pool_last_evict = None
    return m


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_pool_status_when_unloaded(main_module):
    """cap=1, current_size=0 when _predictor is None."""
    m = main_module
    m._predictor = None
    s = m._pool_status()
    assert s["cap"] == 1
    assert s["current_size"] == 0
    assert s["loaded_keys"] == []
    assert s["last_evict"] is None


def test_pool_status_after_ensure_loaded(main_module):
    m = main_module
    _run(m._ensure_predictor_loaded())
    s = m._pool_status()
    assert s["cap"] == 1
    assert s["current_size"] == 1
    assert len(s["loaded_keys"]) == 1
    key = s["loaded_keys"][0]
    assert key["key"] == "sam3"
    assert isinstance(key["loaded_at"], str)
    assert isinstance(key["last_used_at"], str)
    assert key["hit_count"] == 0  # 第一次是 miss, 不算 hit


def test_pool_status_hit_count_increments(main_module):
    m = main_module
    _run(m._ensure_predictor_loaded())  # miss
    _run(m._ensure_predictor_loaded())  # hit 1
    _run(m._ensure_predictor_loaded())  # hit 2
    s = m._pool_status()
    assert s["loaded_keys"][0]["hit_count"] == 2


def test_pool_status_unload_sets_last_evict_manual(main_module):
    m = main_module
    _run(m._ensure_predictor_loaded())
    _run(m._unload_predictor(reason="manual"))
    s = m._pool_status()
    assert s["current_size"] == 0
    assert s["last_evict"]["key"] == "sam3"
    assert s["last_evict"]["reason"] == "manual"


def test_pool_status_unload_idle_sets_last_evict_idle_timeout(main_module):
    m = main_module
    _run(m._ensure_predictor_loaded())
    _run(m._unload_predictor(reason="idle 1200s"))
    s = m._pool_status()
    assert s["last_evict"]["reason"] == "idle_timeout"


def test_warmup_does_not_increment_hit_count(main_module):
    """_ensure_predictor_loaded(count_as_hit=False) 不增 hit_count."""
    m = main_module
    _run(m._ensure_predictor_loaded())  # miss, hit_count=0
    _run(m._ensure_predictor_loaded(count_as_hit=False))  # 已加载, count_as_hit=False
    s = m._pool_status()
    assert s["loaded_keys"][0]["hit_count"] == 0


def test_warmup_cold_returns_miss_and_load_ms(main_module):
    m = main_module
    m._predictor = None
    _, cache_hit, load_ms = _run(m._ensure_predictor_loaded(count_as_hit=False))
    assert cache_hit is False
    assert load_ms is not None and load_ms >= 0


def test_warmup_hot_returns_hit_with_none_load_ms(main_module):
    m = main_module
    _run(m._ensure_predictor_loaded())
    _, cache_hit, load_ms = _run(m._ensure_predictor_loaded(count_as_hit=False))
    assert cache_hit is True
    assert load_ms is None
