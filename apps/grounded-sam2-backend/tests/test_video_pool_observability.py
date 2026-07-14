"""VideoPool observability and lease behavior."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock


def _make_pool(cap: int = 2):
    from video_pool import VideoPool

    def _build(sam_variant: str):
        tracker = MagicMock(name=f"tracker-{sam_variant}")
        tracker.active_sessions = 0
        tracker.device = "cpu"
        tracker.cleanup_uncertain = False
        return tracker

    return VideoPool(
        cap=cap,
        build_tracker=_build,
        free_gpu_memory=lambda: None,
        build_timeout=5.0,
        idle_unload_seconds=600.0,
    )


def _run(coro):
    return asyncio.run(coro)


async def _borrow_once(pool, variant: str):
    async with pool.borrow(variant) as lease:
        return lease.tracker, lease.cache_hit, lease.model_load_ms


def test_video_pool_status_and_hit_count() -> None:
    async def scenario() -> None:
        pool = _make_pool()
        try:
            _, hit, load_ms = await _borrow_once(pool, "tiny")
            assert hit is False
            assert load_ms is not None
            await _borrow_once(pool, "tiny")
            status = await pool.pool_status()
            assert status["cap"] == 2
            assert status["current_size"] == 1
            assert status["last_evict"] is None
            assert status["loaded_keys"][0]["key"] == "tiny"
            assert status["loaded_keys"][0]["hit_count"] == 1
        finally:
            await pool.shutdown()

    _run(scenario())


def test_video_pool_lru_evict_sets_last_evict() -> None:
    async def scenario() -> None:
        pool = _make_pool(cap=1)
        try:
            await _borrow_once(pool, "tiny")
            await _borrow_once(pool, "small")
            status = await pool.pool_status()
            assert status["current_size"] == 1
            assert status["last_evict"]["key"] == "tiny"
            assert status["last_evict"]["reason"] == "lru"
        finally:
            await pool.shutdown()

    _run(scenario())


def test_video_pool_idle_unload_and_health_shape() -> None:
    async def scenario() -> None:
        pool = _make_pool()
        try:
            await _borrow_once(pool, "tiny")
            health = await pool.health()
            assert "loaded_keys" in health
            assert "loaded_variants" not in health
            assert "evict_count" not in health
            await pool.unload_all(reason="idle")
            status = await pool.pool_status()
            assert status["current_size"] == 0
            assert status["last_evict"]["reason"] == "idle_timeout"
        finally:
            await pool.shutdown()

    _run(scenario())
