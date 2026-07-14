"""ADR-0049 static GPU claim database invariants."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


_INSERT = text(
    """
    INSERT INTO ml_backend_registry
      (id, name, url, gpu_resource_id, vram_budget_mb)
    VALUES
      (:id, :name, :url, :gpu_resource_id, :vram_budget_mb)
    """
)


async def _raw_insert(
    db: AsyncSession,
    *,
    gpu_resource_id: str | None,
    vram_budget_mb: int | None,
) -> uuid.UUID:
    backend_id = uuid.uuid4()
    await db.execute(
        _INSERT,
        {
            "id": backend_id,
            "name": f"gpu-claim-{backend_id}",
            "url": f"http://gpu-claim-{backend_id}:8000",
            "gpu_resource_id": gpu_resource_id,
            "vram_budget_mb": vram_budget_mb,
        },
    )
    return backend_id


async def test_gpu_claim_columns_keep_safe_database_defaults(
    db_session: AsyncSession,
) -> None:
    backend_id = uuid.uuid4()
    row = (
        await db_session.execute(
            text(
                """
                INSERT INTO ml_backend_registry (id, name, url)
                VALUES (:id, :name, :url)
                RETURNING gpu_resource_id, vram_budget_mb, eviction_priority
                """
            ),
            {
                "id": backend_id,
                "name": f"gpu-default-{backend_id}",
                "url": f"http://gpu-default-{backend_id}:8000",
            },
        )
    ).one()

    assert row.gpu_resource_id is None
    assert row.vram_budget_mb is None
    assert row.eviction_priority == 0


@pytest.mark.parametrize(
    ("gpu_resource_id", "vram_budget_mb", "constraint_name"),
    [
        ("node-a/GPU-test", None, "ck_ml_backend_registry_gpu_claim_pair"),
        (None, 1024, "ck_ml_backend_registry_gpu_claim_pair"),
        ("node-a/GPU-test", 0, "ck_ml_backend_registry_vram_budget_positive"),
        ("node-a/GPU-test", -1, "ck_ml_backend_registry_vram_budget_positive"),
        (" node-a/GPU-test", 1024, "ck_ml_backend_registry_gpu_resource_id"),
        ("node-a/GPU test", 1024, "ck_ml_backend_registry_gpu_resource_id"),
        ("node-a/GPU-a,GPU-b", 1024, "ck_ml_backend_registry_gpu_resource_id"),
        ("node-a", 1024, "ck_ml_backend_registry_gpu_resource_id"),
        ("node-a/", 1024, "ck_ml_backend_registry_gpu_resource_id"),
    ],
)
async def test_gpu_claim_database_checks_reject_invalid_raw_writes(
    db_session: AsyncSession,
    gpu_resource_id: str | None,
    vram_budget_mb: int | None,
    constraint_name: str,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        async with db_session.begin_nested():
            await _raw_insert(
                db_session,
                gpu_resource_id=gpu_resource_id,
                vram_budget_mb=vram_budget_mb,
            )

    assert constraint_name in str(exc_info.value.orig)


async def test_gpu_resource_claim_lookup_has_an_index(
    db_session: AsyncSession,
) -> None:
    index_definition = (
        await db_session.execute(
            text(
                """
                SELECT indexdef
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = 'ml_backend_registry'
                  AND indexname = 'ix_ml_backend_registry_gpu_resource_id'
                """
            )
        )
    ).scalar_one()

    assert "(gpu_resource_id)" in index_definition
