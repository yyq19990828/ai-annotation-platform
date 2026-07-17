"""Durable GPU fence primitives: membership row-lock, high-water marks, token horizon.

Moved verbatim from the legacy aggregate ``gpu_arbiter.py``. This module owns the
durable fence transaction boundary (membership lock, generation / control-epoch /
runtime-epoch / token-expiry high-water UPDATE ... RETURNING) and the public
``advance_gpu_backend_fence`` / ``record_gpu_backend_token_expiry`` /
``activate_gpu_backend_membership`` / ``read_gpu_backend_fence`` entry points.

It depends only on ``gpu_arbitration.policy`` (for ``_MAX_POSITIVE_INT64``), config
DB models and SQLAlchemy. It must not depend on proofs, control, reconciliation,
retirement, dispatch or ml_client.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from datetime import datetime
from typing import Any, Literal, NoReturn
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.services.gpu_arbitration.policy import _MAX_POSITIVE_INT64

GPUFenceSessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]
GPUReadinessDemoter = Callable[[str], Awaitable[None]]
GPUFenceCounter = Literal["generation", "control_epoch"]


class GPUFenceExhaustedError(RuntimeError):
    """A durable positive-int64 fencing sequence cannot advance safely."""


class GPUFenceMembershipError(RuntimeError):
    """Fence issuance did not match one active durable resource membership."""


async def _lock_gpu_backend_membership(
    db: AsyncSession,
    backend_registry_id: uuid.UUID,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
    state: Literal["pending", "active"],
) -> GPUBackendMembership:
    membership = await db.scalar(
        select(GPUBackendMembership)
        .where(
            GPUBackendMembership.backend_registry_id == backend_registry_id,
            GPUBackendMembership.gpu_resource_id == gpu_resource_id,
            GPUBackendMembership.membership_epoch == membership_epoch,
            GPUBackendMembership.state == state,
        )
        .with_for_update()
    )
    if membership is None:
        raise GPUFenceMembershipError(
            f"{state} GPU membership changed before durable fence update"
        )
    return membership


async def _raise_fence_update_failure(
    db: AsyncSession,
    backend_registry_id: uuid.UUID,
    counter: str,
) -> NoReturn:
    fence_exists = await db.scalar(
        select(GPUBackendFence.backend_registry_id).where(
            GPUBackendFence.backend_registry_id == backend_registry_id
        )
    )
    if fence_exists is None:
        raise GPUFenceMembershipError("durable GPU fence is missing")
    raise GPUFenceExhaustedError(f"{counter} high-water reached positive int64 maximum")


def _validate_token_expiry(token_expires_at: datetime) -> None:
    if token_expires_at.tzinfo is None:
        raise ValueError("token_expires_at must be timezone-aware")


async def _advance_gpu_backend_fence_in_transaction(
    db: AsyncSession,
    backend_registry_id: uuid.UUID,
    counter: GPUFenceCounter,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
    token_expires_at: datetime | None,
) -> int:
    """Advance one existing high-water mark with UPDATE + RETURNING."""

    await _lock_gpu_backend_membership(
        db,
        backend_registry_id,
        gpu_resource_id=gpu_resource_id,
        membership_epoch=membership_epoch,
        state="active",
    )
    if token_expires_at is not None:
        _validate_token_expiry(token_expires_at)

    if counter == "generation":
        column = GPUBackendFence.generation_high_water
    elif counter == "control_epoch":
        column = GPUBackendFence.control_epoch_high_water
    else:  # pragma: no cover - Literal callers are statically constrained
        raise ValueError(f"unsupported fence counter: {counter}")

    update_values: dict[str, Any] = {
        column.key: column + 1,
        "updated_at": func.now(),
    }
    if token_expires_at is not None:
        update_values["token_expiry_high_water"] = func.greatest(
            func.coalesce(
                GPUBackendFence.token_expiry_high_water,
                token_expires_at,
            ),
            token_expires_at,
        )

    statement = (
        update(GPUBackendFence)
        .where(
            GPUBackendFence.backend_registry_id == backend_registry_id,
            column < _MAX_POSITIVE_INT64,
        )
        .values(**update_values)
        .returning(column)
    )
    value = (await db.execute(statement)).scalar_one_or_none()
    if value is None:
        await _raise_fence_update_failure(db, backend_registry_id, counter)
    return int(value)


async def _record_gpu_backend_token_expiry_in_transaction(
    db: AsyncSession,
    backend_registry_id: uuid.UUID,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
    token_expires_at: datetime,
) -> datetime:
    """Persist one token horizon without changing generation or control epoch."""

    _validate_token_expiry(token_expires_at)
    await _lock_gpu_backend_membership(
        db,
        backend_registry_id,
        gpu_resource_id=gpu_resource_id,
        membership_epoch=membership_epoch,
        state="active",
    )
    statement = (
        update(GPUBackendFence)
        .where(GPUBackendFence.backend_registry_id == backend_registry_id)
        .values(
            token_expiry_high_water=func.greatest(
                func.coalesce(
                    GPUBackendFence.token_expiry_high_water,
                    token_expires_at,
                ),
                token_expires_at,
            ),
            updated_at=func.now(),
        )
        .returning(GPUBackendFence.token_expiry_high_water)
    )
    value = (await db.execute(statement)).scalar_one_or_none()
    if value is None:
        raise GPUFenceMembershipError("durable GPU fence is missing")
    return value


async def _activate_gpu_backend_membership_in_transaction(
    db: AsyncSession,
    backend_registry_id: uuid.UUID,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
) -> int:
    """Enter a durable runtime epoch and activate the exact pending membership."""

    membership = await _lock_gpu_backend_membership(
        db,
        backend_registry_id,
        gpu_resource_id=gpu_resource_id,
        membership_epoch=membership_epoch,
        state="pending",
    )
    statement = (
        update(GPUBackendFence)
        .where(
            GPUBackendFence.backend_registry_id == backend_registry_id,
            GPUBackendFence.runtime_epoch_high_water < _MAX_POSITIVE_INT64,
        )
        .values(
            runtime_epoch_high_water=GPUBackendFence.runtime_epoch_high_water + 1,
            updated_at=func.now(),
        )
        .returning(GPUBackendFence.runtime_epoch_high_water)
    )
    value = (await db.execute(statement)).scalar_one_or_none()
    if value is None:
        await _raise_fence_update_failure(db, backend_registry_id, "runtime_epoch")
    membership.state = "active"
    await db.flush()
    return int(value)


async def advance_gpu_backend_fence(
    session_factory: GPUFenceSessionFactory,
    backend_registry_id: uuid.UUID,
    counter: GPUFenceCounter,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
    token_expires_at: datetime | None = None,
) -> str:
    """Durably advance a fence and return only after the short transaction commits.

    Token issuance and Redis writes must happen after this function returns. A later
    failure intentionally leaves a gap; high-water values are never rolled back or
    reused.
    """

    async with session_factory() as db:
        async with db.begin():
            value = await _advance_gpu_backend_fence_in_transaction(
                db,
                backend_registry_id,
                counter,
                gpu_resource_id=gpu_resource_id,
                membership_epoch=membership_epoch,
                token_expires_at=token_expires_at,
            )
    return str(value)


async def record_gpu_backend_token_expiry(
    session_factory: GPUFenceSessionFactory,
    backend_registry_id: uuid.UUID,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
    token_expires_at: datetime,
) -> datetime:
    """Persist a token expiry before signing without advancing a fence counter."""

    async with session_factory() as db:
        async with db.begin():
            return await _record_gpu_backend_token_expiry_in_transaction(
                db,
                backend_registry_id,
                gpu_resource_id=gpu_resource_id,
                membership_epoch=membership_epoch,
                token_expires_at=token_expires_at,
            )


async def activate_gpu_backend_membership(
    session_factory: GPUFenceSessionFactory,
    backend_registry_id: uuid.UUID,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
) -> str:
    """Atomically activate one membership and make mutation guards durable."""

    async with session_factory() as db:
        async with db.begin():
            value = await _activate_gpu_backend_membership_in_transaction(
                db,
                backend_registry_id,
                gpu_resource_id=gpu_resource_id,
                membership_epoch=membership_epoch,
            )
    return str(value)


async def read_gpu_backend_fence(
    db: AsyncSession, backend_registry_id: uuid.UUID
) -> GPUBackendFence | None:
    return await db.get(GPUBackendFence, backend_registry_id)
