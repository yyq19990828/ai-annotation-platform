from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.services.gpu_arbiter import (
    GPUFenceExhaustedError,
    advance_gpu_backend_fence,
)


_MAX_POSITIVE_INT64 = 9_223_372_036_854_775_807


@pytest.fixture
async def committed_backend(
    test_engine: AsyncEngine,
) -> AsyncIterator[tuple[async_sessionmaker[AsyncSession], uuid.UUID]]:
    """Create a committed row visible to independent concurrent connections."""

    factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    backend_id = uuid.uuid4()
    async with factory.begin() as db:
        db.add(
            MLBackendRegistry(
                id=backend_id,
                name="gpu-fence-test",
                url=f"http://gpu-fence-{backend_id}.test",
            )
        )
    try:
        yield factory, backend_id
    finally:
        # FK cascade removes the fence row; no committed test data is left behind.
        async with factory.begin() as db:
            await db.execute(
                delete(MLBackendRegistry).where(MLBackendRegistry.id == backend_id)
            )


@pytest.mark.asyncio
async def test_fence_sequences_start_at_one_and_advance_independently(
    committed_backend,
) -> None:
    factory, backend_id = committed_backend

    assert await advance_gpu_backend_fence(factory, backend_id, "generation") == "1"
    assert await advance_gpu_backend_fence(factory, backend_id, "control_epoch") == "1"
    assert await advance_gpu_backend_fence(factory, backend_id, "generation") == "2"

    async with factory() as db:
        row = await db.get(GPUBackendFence, backend_id)
        assert row is not None
        assert row.generation_high_water == 2
        assert row.control_epoch_high_water == 1


@pytest.mark.asyncio
async def test_generation_advance_is_atomic_across_independent_sessions(
    committed_backend,
) -> None:
    factory, backend_id = committed_backend

    values = await asyncio.gather(
        *(
            advance_gpu_backend_fence(factory, backend_id, "generation")
            for _ in range(24)
        )
    )

    assert sorted(map(int, values)) == list(range(1, 25))
    async with factory() as db:
        high_water = await db.scalar(
            select(GPUBackendFence.generation_high_water).where(
                GPUBackendFence.backend_registry_id == backend_id
            )
        )
    assert high_water == 24


@pytest.mark.asyncio
async def test_failed_followup_does_not_reuse_a_durable_generation(
    committed_backend,
) -> None:
    factory, backend_id = committed_backend

    issued_before_hypothetical_redis_failure = await advance_gpu_backend_fence(
        factory, backend_id, "generation"
    )
    issued_after_retry = await advance_gpu_backend_fence(
        factory, backend_id, "generation"
    )

    assert issued_before_hypothetical_redis_failure == "1"
    assert issued_after_retry == "2"


@pytest.mark.asyncio
async def test_fence_overflow_fails_closed(committed_backend) -> None:
    factory, backend_id = committed_backend
    assert await advance_gpu_backend_fence(factory, backend_id, "generation") == "1"
    async with factory.begin() as db:
        await db.execute(
            update(GPUBackendFence)
            .where(GPUBackendFence.backend_registry_id == backend_id)
            .values(generation_high_water=_MAX_POSITIVE_INT64)
        )

    with pytest.raises(GPUFenceExhaustedError):
        await advance_gpu_backend_fence(factory, backend_id, "generation")

    async with factory() as db:
        high_water = await db.scalar(
            select(GPUBackendFence.generation_high_water).where(
                GPUBackendFence.backend_registry_id == backend_id
            )
        )
    assert high_water == _MAX_POSITIVE_INT64


@pytest.mark.asyncio
async def test_fence_rejects_negative_high_water(committed_backend) -> None:
    factory, backend_id = committed_backend
    assert await advance_gpu_backend_fence(factory, backend_id, "generation") == "1"

    with pytest.raises(IntegrityError):
        async with factory.begin() as db:
            await db.execute(
                update(GPUBackendFence)
                .where(GPUBackendFence.backend_registry_id == backend_id)
                .values(generation_high_water=-1)
            )


@pytest.mark.asyncio
async def test_registry_delete_cascades_fence(test_engine: AsyncEngine) -> None:
    factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    backend_id = uuid.uuid4()
    async with factory.begin() as db:
        db.add(
            MLBackendRegistry(
                id=backend_id,
                name="gpu-fence-cascade-test",
                url=f"http://gpu-fence-cascade-{backend_id}.test",
            )
        )
    try:
        assert (
            await advance_gpu_backend_fence(factory, backend_id, "control_epoch") == "1"
        )
        async with factory.begin() as db:
            await db.execute(
                delete(MLBackendRegistry).where(MLBackendRegistry.id == backend_id)
            )
        async with factory() as db:
            assert await db.get(GPUBackendFence, backend_id) is None
    finally:
        async with factory.begin() as db:
            await db.execute(
                delete(MLBackendRegistry).where(MLBackendRegistry.id == backend_id)
            )
