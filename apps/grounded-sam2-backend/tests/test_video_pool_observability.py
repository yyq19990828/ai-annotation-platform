"""v0.14.15 VideoPool PoolStatus observability tests."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock


def _make_pool(cap: int = 2):
    from video_pool import VideoPool

    def _build(sam_variant: str):
        tracker = MagicMock(name=f"tracker-{sam_variant}")
        tracker.active_sessions = 0
        return tracker

    def _free():
        pass

    return VideoPool(
        cap=cap,
        build_tracker=_build,
        free_gpu_memory=_free,
        build_timeout=5.0,
        idle_unload_seconds=600.0,
    )


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_video_pool_status_shape_matches_pool_status_protocol() -> None:
    pool = _make_pool()
    _run(pool.get("tiny"))
    s = pool.pool_status()
    assert s["cap"] == 2
    assert s["current_size"] == 1
    assert s["last_evict"] is None
    assert s["loaded_keys"][0]["key"] == "tiny"
    assert isinstance(s["loaded_keys"][0]["loaded_at"], str)
    assert s["loaded_keys"][0]["hit_count"] == 0


def test_video_pool_hit_count_increments_on_hit() -> None:
    pool = _make_pool()
    _run(pool.get("tiny"))
    _run(pool.get("tiny"))
    assert pool.pool_status()["loaded_keys"][0]["hit_count"] == 1


def test_video_pool_lru_evict_sets_last_evict() -> None:
    pool = _make_pool(cap=1)
    _run(pool.get("tiny"))
    _run(pool.get("small"))
    s = pool.pool_status()
    assert s["current_size"] == 1
    assert s["last_evict"] == {
        "key": "tiny",
        "at": s["last_evict"]["at"],
        "reason": "lru",
    }


def test_video_pool_clear_all_idle_sets_last_evict_idle_timeout() -> None:
    pool = _make_pool()
    _run(pool.get("tiny"))
    pool.clear_all(reason="idle_timeout")
    s = pool.pool_status()
    assert s["current_size"] == 0
    assert s["last_evict"]["key"] == "tiny"
    assert s["last_evict"]["reason"] == "idle_timeout"


def test_video_pool_health_removes_legacy_fields() -> None:
    pool = _make_pool()
    _run(pool.get("tiny"))
    h = pool.health()
    assert "loaded_keys" in h
    assert "loaded_variants" not in h
    assert "evict_count" not in h
