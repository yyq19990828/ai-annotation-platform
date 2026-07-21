"""Durable GPU rollout state and dispatch-mode decision logic.

Moved verbatim from the legacy flat module ``gpu_arbiter_rollout.py``; this is a
cycle-safe leaf consumed by ``ml_client`` (resolve/boundary) and the membership /
rollout-control orchestration modules. It depends only on config and the rollout
DB model.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import GPUArbiterMode, Settings, settings
from app.db.models.gpu_arbiter_rollout import GPUArbiterRollout


GPURolloutState = Literal[
    "off",
    "promoting",
    "enforcing",
    "demoting",
    "blocked",
]


class GPUArbiterRolloutError(RuntimeError):
    """Base error for durable rollout state operations."""


class GPUArbiterRolloutConflict(GPUArbiterRolloutError):
    """The requested transition conflicts with the durable state."""


class GPUArbiterRolloutUnavailable(GPUArbiterRolloutError):
    """The durable rollout state could not be read safely."""


@dataclass(frozen=True)
class GPUArbiterRolloutSnapshot:
    resource_id: str
    state: GPURolloutState
    effective_mode: GPUArbiterMode
    target_mode: GPUArbiterMode
    transition_id: uuid.UUID | None
    last_transition_id: uuid.UUID | None
    blocker_reason: str | None
    revision: int


@dataclass(frozen=True)
class GPUArbiterRolloutDecision:
    resource_id: str
    state: GPURolloutState | Literal["uninitialized", "disabled"]
    effective_mode: GPUArbiterMode
    dispatch_mode: GPUArbiterMode | None
    blocked_reason: str | None
    revision: int | None

    @property
    def dispatch_blocked(self) -> bool:
        return self.dispatch_mode is None


def gpu_arbiter_rollout_snapshot(
    row: GPUArbiterRollout,
) -> GPUArbiterRolloutSnapshot:
    return GPUArbiterRolloutSnapshot(
        resource_id=row.gpu_resource_id,
        state=row.state,  # type: ignore[arg-type]
        effective_mode=GPUArbiterMode(row.effective_mode),
        target_mode=GPUArbiterMode(row.target_mode),
        transition_id=row.transition_id,
        last_transition_id=row.last_transition_id,
        blocker_reason=row.blocker_reason,
        revision=row.revision,
    )


def classify_gpu_arbiter_rollout(
    resource_id: str,
    desired_mode: GPUArbiterMode,
    rollout: GPUArbiterRolloutSnapshot | None,
    *,
    rollout_enabled: bool,
) -> GPUArbiterRolloutDecision:
    """Resolve reporting and dispatch modes without performing I/O."""

    if not rollout_enabled:
        effective = (
            GPUArbiterMode.OBSERVE
            if desired_mode is GPUArbiterMode.OBSERVE
            else GPUArbiterMode.OFF
        )
        return GPUArbiterRolloutDecision(
            resource_id=resource_id,
            state="disabled",
            effective_mode=effective,
            dispatch_mode=effective,
            blocked_reason=None,
            revision=None,
        )

    if rollout is None:
        if desired_mode is GPUArbiterMode.ENFORCE:
            return GPUArbiterRolloutDecision(
                resource_id=resource_id,
                state="uninitialized",
                effective_mode=GPUArbiterMode.OFF,
                dispatch_mode=None,
                blocked_reason="gpu_rollout_not_initialized",
                revision=None,
            )
        return GPUArbiterRolloutDecision(
            resource_id=resource_id,
            state="uninitialized",
            effective_mode=desired_mode,
            dispatch_mode=desired_mode,
            blocked_reason=None,
            revision=None,
        )

    if rollout.state == "off":
        if desired_mode is GPUArbiterMode.ENFORCE:
            dispatch_mode = None
            blocked_reason = "gpu_rollout_promotion_required"
        else:
            dispatch_mode = desired_mode
            blocked_reason = None
        return GPUArbiterRolloutDecision(
            resource_id=resource_id,
            state=rollout.state,
            effective_mode=GPUArbiterMode.OFF,
            dispatch_mode=dispatch_mode,
            blocked_reason=blocked_reason,
            revision=rollout.revision,
        )

    if rollout.state == "enforcing":
        if desired_mode is GPUArbiterMode.ENFORCE:
            return GPUArbiterRolloutDecision(
                resource_id=resource_id,
                state=rollout.state,
                effective_mode=GPUArbiterMode.ENFORCE,
                dispatch_mode=GPUArbiterMode.ENFORCE,
                blocked_reason=None,
                revision=rollout.revision,
            )
        return GPUArbiterRolloutDecision(
            resource_id=resource_id,
            state=rollout.state,
            effective_mode=GPUArbiterMode.ENFORCE,
            dispatch_mode=None,
            blocked_reason="gpu_rollout_demotion_required",
            revision=rollout.revision,
        )

    reason = (
        rollout.blocker_reason
        if rollout.state == "blocked"
        else f"gpu_rollout_{rollout.state}"
    )
    return GPUArbiterRolloutDecision(
        resource_id=resource_id,
        state=rollout.state,
        effective_mode=rollout.effective_mode,
        dispatch_mode=None,
        blocked_reason=reason,
        revision=rollout.revision,
    )


async def read_gpu_arbiter_rollout(
    factory: async_sessionmaker[AsyncSession],
    resource_id: str,
) -> GPUArbiterRolloutSnapshot | None:
    try:
        async with factory() as db:
            row = await db.get(GPUArbiterRollout, resource_id)
            return gpu_arbiter_rollout_snapshot(row) if row is not None else None
    except Exception as exc:  # noqa: BLE001 - callers must fail closed on DB loss
        raise GPUArbiterRolloutUnavailable(
            f"GPU rollout state unavailable for {resource_id}"
        ) from exc


async def read_gpu_arbiter_rollouts(
    factory: async_sessionmaker[AsyncSession],
) -> tuple[GPUArbiterRolloutSnapshot, ...]:
    """Read every durable rollout in stable resource order."""

    try:
        async with factory() as db:
            rows = tuple(
                (
                    await db.execute(
                        select(GPUArbiterRollout).order_by(
                            GPUArbiterRollout.gpu_resource_id
                        )
                    )
                )
                .scalars()
                .all()
            )
        return tuple(gpu_arbiter_rollout_snapshot(row) for row in rows)
    except Exception as exc:  # noqa: BLE001 - callers must fail closed on DB loss
        raise GPUArbiterRolloutUnavailable(
            "GPU rollout states could not be listed safely"
        ) from exc


async def resolve_gpu_arbiter_rollout(
    factory: async_sessionmaker[AsyncSession],
    resource_id: str,
    *,
    config: Settings = settings,
) -> GPUArbiterRolloutDecision:
    desired = config.gpu_arbiter_desired_mode(resource_id)
    if not config.gpu_arbiter_rollout_enabled:
        return classify_gpu_arbiter_rollout(
            resource_id,
            desired,
            None,
            rollout_enabled=False,
        )
    rollout = await read_gpu_arbiter_rollout(factory, resource_id)
    return classify_gpu_arbiter_rollout(
        resource_id,
        desired,
        rollout,
        rollout_enabled=True,
    )


async def gpu_rollout_boundary_active(
    factory: async_sessionmaker[AsyncSession],
    *,
    config: Settings = settings,
) -> bool:
    """Whether any durable resource may require managed-wire protection."""

    if not config.gpu_arbiter_rollout_enabled:
        return False
    try:
        async with factory() as db:
            state = await db.scalar(
                select(GPUArbiterRollout.state)
                .where(GPUArbiterRollout.state != "off")
                .limit(1)
            )
            return state is not None
    except Exception as exc:  # noqa: BLE001 - unknown boundary is unsafe
        raise GPUArbiterRolloutUnavailable(
            "GPU rollout boundary could not be determined"
        ) from exc


async def begin_gpu_arbiter_rollout(
    factory: async_sessionmaker[AsyncSession],
    resource_id: str,
    target_mode: GPUArbiterMode,
) -> GPUArbiterRolloutSnapshot:
    """Start or replay one exact promotion/demotion transition."""

    async with factory.begin() as db:
        initial_target = (
            target_mode.value
            if target_mode is not GPUArbiterMode.ENFORCE
            else GPUArbiterMode.OFF.value
        )
        await db.execute(
            insert(GPUArbiterRollout)
            .values(
                gpu_resource_id=resource_id,
                state="off",
                effective_mode="off",
                target_mode=initial_target,
                revision=1,
            )
            .on_conflict_do_nothing(index_elements=["gpu_resource_id"])
        )
        row = await db.scalar(
            select(GPUArbiterRollout)
            .where(GPUArbiterRollout.gpu_resource_id == resource_id)
            .with_for_update()
        )
        if row is None:
            raise GPUArbiterRolloutUnavailable("GPU rollout row disappeared")

        if target_mode is GPUArbiterMode.ENFORCE:
            if row.state == "enforcing":
                return gpu_arbiter_rollout_snapshot(row)
            if row.state == "promoting" and row.target_mode == "enforce":
                return gpu_arbiter_rollout_snapshot(row)
            if row.state == "blocked" and row.effective_mode != "off":
                raise GPUArbiterRolloutConflict(
                    "blocked effective-enforce rollout must demote before promotion"
                )
            if row.state not in {"off", "blocked"}:
                raise GPUArbiterRolloutConflict(
                    f"cannot promote GPU rollout from {row.state}"
                )
            row.state = "promoting"
            row.effective_mode = "off"
            row.target_mode = "enforce"
        else:
            if row.state == "off":
                if row.target_mode == target_mode.value:
                    return gpu_arbiter_rollout_snapshot(row)
                row.target_mode = target_mode.value
                row.revision += 1
                await db.flush()
                return gpu_arbiter_rollout_snapshot(row)
            if row.state == "demoting" and row.target_mode == target_mode.value:
                return gpu_arbiter_rollout_snapshot(row)
            if row.state not in {"promoting", "enforcing", "blocked"}:
                raise GPUArbiterRolloutConflict(
                    f"cannot demote GPU rollout from {row.state}"
                )
            row.state = "demoting"
            row.effective_mode = "enforce"
            row.target_mode = target_mode.value

        row.transition_id = uuid.uuid4()
        row.transition_started_at = datetime.now(UTC)
        row.blocker_reason = None
        row.revision += 1
        await db.flush()
        return gpu_arbiter_rollout_snapshot(row)


async def complete_gpu_arbiter_rollout(
    factory: async_sessionmaker[AsyncSession],
    resource_id: str,
    transition_id: uuid.UUID,
) -> GPUArbiterRolloutSnapshot:
    """Settle an exact transition; response-loss replay is read-only."""

    async with factory.begin() as db:
        row = await db.scalar(
            select(GPUArbiterRollout)
            .where(GPUArbiterRollout.gpu_resource_id == resource_id)
            .with_for_update()
        )
        if row is None:
            raise GPUArbiterRolloutConflict("GPU rollout is not initialized")
        if row.last_transition_id == transition_id and row.state in {
            "off",
            "enforcing",
        }:
            return gpu_arbiter_rollout_snapshot(row)
        if row.transition_id != transition_id or row.state not in {
            "promoting",
            "demoting",
        }:
            raise GPUArbiterRolloutConflict("GPU rollout transition identity changed")

        row.last_transition_id = transition_id
        if row.state == "promoting":
            row.state = "enforcing"
            row.effective_mode = "enforce"
            row.target_mode = "enforce"
        else:
            row.state = "off"
            row.effective_mode = "off"
        row.transition_id = None
        row.transition_started_at = None
        row.blocker_reason = None
        row.revision += 1
        await db.flush()
        return gpu_arbiter_rollout_snapshot(row)


async def block_gpu_arbiter_rollout(
    factory: async_sessionmaker[AsyncSession],
    resource_id: str,
    transition_id: uuid.UUID,
    reason: str,
) -> GPUArbiterRolloutSnapshot:
    """Persist an exact transition failure without relaxing its boundary."""

    normalized_reason = reason.strip()[:256]
    if not normalized_reason:
        raise ValueError("GPU rollout blocker reason must be non-empty")
    async with factory.begin() as db:
        row = await db.scalar(
            select(GPUArbiterRollout)
            .where(GPUArbiterRollout.gpu_resource_id == resource_id)
            .with_for_update()
        )
        if row is None or row.transition_id != transition_id:
            raise GPUArbiterRolloutConflict("GPU rollout transition identity changed")
        if row.state == "blocked":
            if row.blocker_reason != normalized_reason:
                raise GPUArbiterRolloutConflict("GPU rollout blocker already differs")
            return gpu_arbiter_rollout_snapshot(row)
        if row.state not in {"promoting", "demoting"}:
            raise GPUArbiterRolloutConflict(
                f"cannot block GPU rollout from {row.state}"
            )
        row.state = "blocked"
        row.blocker_reason = normalized_reason
        row.revision += 1
        await db.flush()
        return gpu_arbiter_rollout_snapshot(row)


__all__ = [
    "GPUArbiterRolloutConflict",
    "GPUArbiterRolloutDecision",
    "GPUArbiterRolloutSnapshot",
    "GPUArbiterRolloutUnavailable",
    "begin_gpu_arbiter_rollout",
    "block_gpu_arbiter_rollout",
    "classify_gpu_arbiter_rollout",
    "complete_gpu_arbiter_rollout",
    "gpu_arbiter_rollout_snapshot",
    "gpu_rollout_boundary_active",
    "read_gpu_arbiter_rollout",
    "read_gpu_arbiter_rollouts",
    "resolve_gpu_arbiter_rollout",
]
