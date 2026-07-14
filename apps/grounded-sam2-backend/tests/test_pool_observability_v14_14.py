"""Image ModelPool observability and lease behavior without real checkpoints."""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_modules() -> None:
    sys.modules.setdefault(
        "torch",
        MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False))),
    )


def _make_pool(cap: int = 2):
    from embedding_cache import EmbeddingCache
    from model_pool import ModelPool

    def _build(sv: str, dv: str, cache: EmbeddingCache):
        predictor = MagicMock(name=f"predictor-{sv}-{dv}")
        predictor.device = "cpu"
        predictor.cleanup_uncertain = False
        return predictor

    return ModelPool(
        cap=cap,
        build_predictor=_build,
        free_gpu_memory=lambda: None,
        embedding_cache_size=8,
        build_timeout=5.0,
    )


def _run(coro):
    return asyncio.run(coro)


async def _borrow_once(pool, sv: str, dv: str):
    async with pool.borrow(sv, dv) as lease:
        return lease.predictor, lease.cache_hit, lease.model_load_ms


def test_borrow_reports_miss_then_hit_and_hit_count() -> None:
    async def scenario() -> None:
        pool = _make_pool()
        try:
            predictor, cache_hit, load_ms = await _borrow_once(pool, "tiny", "T")
            assert predictor is not None
            assert cache_hit is False
            assert load_ms is not None and load_ms >= 0

            _, cache_hit, load_ms = await _borrow_once(pool, "tiny", "T")
            assert cache_hit is True
            assert load_ms is None
            status = await pool.pool_status()
            assert status["loaded_keys"][0]["hit_count"] == 1
        finally:
            await pool.shutdown()

    _run(scenario())


def test_pool_status_shape_matches_protocol() -> None:
    async def scenario() -> None:
        pool = _make_pool(cap=2)
        try:
            await _borrow_once(pool, "tiny", "T")
            status = await pool.pool_status()
            assert status["cap"] == 2
            assert status["current_size"] == 1
            assert status["last_evict"] is None
            item = status["loaded_keys"][0]
            assert item["key"] == "sam=tiny/dino=T"
            assert isinstance(item["loaded_at"], str) and "T" in item["loaded_at"]
            assert isinstance(item["last_used_at"], str)
            assert item["hit_count"] == 0
        finally:
            await pool.shutdown()

    _run(scenario())


def test_lru_evict_and_warmup_observability() -> None:
    async def scenario() -> None:
        pool = _make_pool(cap=1)
        try:
            hit, load_ms, evicted = await pool.warmup("tiny", "T")
            assert hit is False
            assert load_ms is not None
            assert evicted is None
            assert (await pool.pool_status())["loaded_keys"][0]["hit_count"] == 0

            hit, load_ms, evicted = await pool.warmup("small", "T")
            assert hit is False
            assert load_ms is not None
            assert evicted == "sam=tiny/dino=T"
            status = await pool.pool_status()
            assert status["current_size"] == 1
            assert status["last_evict"]["reason"] == "lru"
        finally:
            await pool.shutdown()

    _run(scenario())


def test_warmup_hit_does_not_increment_hit_count() -> None:
    async def scenario() -> None:
        pool = _make_pool()
        try:
            await pool.warmup("tiny", "T")
            hit, load_ms, evicted = await pool.warmup("tiny", "T")
            assert hit is True
            assert load_ms is None
            assert evicted is None
            assert (await pool.pool_status())["loaded_keys"][0]["hit_count"] == 0
        finally:
            await pool.shutdown()

    _run(scenario())


@pytest.mark.parametrize(
    ("reason", "expected"),
    [("idle", "idle_timeout"), ("manual", "manual")],
)
def test_unload_records_reason(reason: str, expected: str) -> None:
    async def scenario() -> None:
        pool = _make_pool()
        try:
            await _borrow_once(pool, "tiny", "T")
            await pool.unload_all(reason=reason)
            status = await pool.pool_status()
            assert status["current_size"] == 0
            assert status["last_evict"]["reason"] == expected
        finally:
            await pool.shutdown()

    _run(scenario())


def test_is_loaded_helper() -> None:
    async def scenario() -> None:
        pool = _make_pool()
        try:
            assert await pool.is_loaded("tiny", "T") is False
            await _borrow_once(pool, "tiny", "T")
            assert await pool.is_loaded("tiny", "T") is True
            assert await pool.is_loaded("small", "B") is False
        finally:
            await pool.shutdown()

    _run(scenario())
