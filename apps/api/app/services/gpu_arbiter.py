"""ADR-0049 GPU claims, durable fences, proof recovery, and shadow arbitration.

P2b evaluates non-authoritative ``would-*`` decisions from a fresh DB snapshot;
P3a/P3c add durable fencing, exact membership, token-expiry high-water marks, and
the database-locked consumer for Redis proof reset.  Backend network probes remain
outside every database lock in this module.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import asdict, dataclass, field as dataclass_field
from datetime import UTC, datetime, timedelta
from enum import Enum
import hashlib
import json
import re
import secrets
from typing import Any, Literal, NoReturn
import uuid

import structlog
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    validate_canonical_positive_int64,
)
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import GPUArbiterMode, Settings, settings
from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.schemas.ml_backend import GPUBackendConfigStatus, GPUConfigDiagnostic
from app.services.gpu_arbiter_store import (
    GPUAllocation,
    GPUAllocationState,
    GPUArbiterStore,
    GPUArbiterStoreError,
    GPUBackendDomainMember,
    GPUCardSnapshot,
    GPUProofResetContext,
    GPUReconcileResult,
    normalize_gpu_backend_max_concurrency,
)
from app.utils.gpu_resource import validate_gpu_resource_id


logger = structlog.get_logger(__name__)

_LEVEL_ORDER = {
    "ok": 0,
    "info": 1,
    "warning": 2,
    "critical": 3,
    "blocker": 4,
}

# The durable health poll runs once per minute.  Three missed polls make cached
# device/identity evidence untrusted for static diagnostics; stale data remains
# visible in health_meta but is never used to prove CPU-only or physical identity.
_HEALTH_EVIDENCE_MAX_AGE = timedelta(minutes=3)
_HEALTH_EVIDENCE_FUTURE_SKEW = timedelta(minutes=1)
_PROOF_RESET_MAX_WINDOW = timedelta(minutes=5)
_CANONICAL_POSITIVE_INT64_RE = re.compile(r"[1-9][0-9]{0,18}\Z")
_GPU_HEALTH_CHALLENGE_RE = re.compile(r"[0-9a-f]{64}\Z")
_MAX_POSITIVE_INT64 = 9_223_372_036_854_775_807

GPUShadowSessionFactory = Callable[[], AsyncSession]
GPUFenceSessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]
GPUFenceCounter = Literal["generation", "control_epoch"]


class GPUArbiterErrorCode(str, Enum):
    """Stable platform-side arbitration errors frozen by ADR-0049."""

    NOT_READY = "gpu_arbiter_not_ready"
    CAPACITY_UNAVAILABLE = "gpu_capacity_unavailable"
    BACKEND_CONCURRENCY_SATURATED = "gpu_backend_concurrency_saturated"
    DRAIN_TIMEOUT = "gpu_drain_timeout"
    UNAVAILABLE = "gpu_arbiter_unavailable"
    CONFIG_INVALID = "gpu_config_invalid"
    BACKEND_RETIREMENT_REQUIRED = "gpu_backend_retirement_required"


_GPU_ARBITER_DISPATCH_ERROR_STATUS = {
    GPUArbiterErrorCode.NOT_READY: 503,
    GPUArbiterErrorCode.CAPACITY_UNAVAILABLE: 503,
    GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED: 503,
    GPUArbiterErrorCode.DRAIN_TIMEOUT: 503,
    GPUArbiterErrorCode.UNAVAILABLE: 503,
    GPUArbiterErrorCode.CONFIG_INVALID: 503,
    GPUArbiterErrorCode.BACKEND_RETIREMENT_REQUIRED: 409,
}
_GPU_ARBITER_RETRY_AFTER_REQUIRED = frozenset(
    {
        GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED,
        GPUArbiterErrorCode.DRAIN_TIMEOUT,
    }
)


class GPUArbiterDispatchError(HTTPException):
    """Structured dispatch error usable by FastAPI routes and worker callers."""

    def __init__(
        self,
        code: GPUArbiterErrorCode,
        *,
        message: str | None = None,
        retry_after_s: int | None = None,
    ) -> None:
        if code in _GPU_ARBITER_RETRY_AFTER_REQUIRED and retry_after_s is None:
            raise ValueError(f"{code.value} requires retry_after_s")
        if retry_after_s is not None and (
            not isinstance(retry_after_s, int)
            or isinstance(retry_after_s, bool)
            or retry_after_s < 0
        ):
            raise ValueError("retry_after_s must be a non-negative integer")

        detail = {"error_code": code.value}
        if message is not None:
            detail["message"] = message
        headers = (
            {"Retry-After": str(retry_after_s)} if retry_after_s is not None else None
        )
        self.error_code = code.value
        self.retry_after_s = retry_after_s
        super().__init__(
            status_code=_GPU_ARBITER_DISPATCH_ERROR_STATUS[code],
            detail=detail,
            headers=headers,
        )


GPUDispatchOperation = Literal[
    "predict",
    "predict_interactive",
    "warmup",
    "reload",
    "unload",
]


@dataclass(frozen=True)
class GPUDispatchRequest:
    """Exact client metadata passed to the authoritative dispatch context."""

    backend_id: str
    gpu_resource_id: str
    operation: GPUDispatchOperation
    scope: AdmissionScope


@dataclass(frozen=True)
class GPUDispatchGrant:
    """Managed lifecycle headers produced after authoritative admission."""

    generation: str
    admission_token: str

    def __post_init__(self) -> None:
        validate_canonical_positive_int64(self.generation)
        if (
            not self.admission_token
            or self.admission_token.strip() != self.admission_token
        ):
            raise ValueError("admission_token must be non-empty and canonical")


GPUDispatchContextFactory = Callable[
    [GPUDispatchRequest], AbstractAsyncContextManager[GPUDispatchGrant]
]


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


class _GPUProofInvalid(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class _GPUProofProbe:
    raw: dict[str, Any]
    probe_started_at: datetime
    observed_at: datetime


@dataclass(frozen=True)
class _GPUProofResidency:
    raw: dict[str, Any]
    state: str
    gpu_loaded: bool | None
    active_requests: int
    builders: int
    borrowers: int
    draining: bool
    evictable: bool
    generation: str | None
    pool_residencies: tuple[bool | None, ...]
    lifecycle_gate: str
    control_epoch: str | None
    identity: dict[str, str] | None


@dataclass(frozen=True)
class _GPUProofEvaluation:
    allocation: GPUAllocation | None
    complete: bool
    reason: str
    evidence_deadline_ms: int | None
    probe_document: Any
    residency_document: Any


@dataclass(frozen=True)
class _LockedGPUProofDomain:
    memberships: tuple[GPUBackendMembership, ...]
    fences: dict[uuid.UUID, GPUBackendFence]
    registries: dict[uuid.UUID, MLBackendRegistry]
    db_now: datetime


_GPU_PROBE_KEYS = frozenset(
    {
        "protocol_version",
        "challenge",
        "backend_registry_id",
        "gpu_resource_id",
        "membership_epoch",
        "membership_state",
        "probe_started_at",
        "observed_at",
    }
)
_GPU_RESIDENCY_KEYS = frozenset(
    {
        "state",
        "gpu_loaded",
        "active_requests",
        "builders",
        "borrowers",
        "draining",
        "evictable",
        "generation",
        "pools",
        "boot_id",
        "lifecycle_gate",
        "control_epoch",
        "identity",
    }
)
_GPU_POOL_RESIDENCY_KEYS = frozenset({"resident", "device", "provider"})
_GPU_RESIDENCY_IDENTITY_KEYS = frozenset(
    {"audience", "backend_registry_id", "gpu_resource_id"}
)
_GPU_RESIDENCY_STATES = frozenset(
    {"unloaded", "loading", "resident", "draining", "unloading", "unknown"}
)


def _canonical_proof_timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise _GPUProofInvalid("timestamp_timezone_invalid")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_canonical_proof_timestamp(value: Any) -> datetime:
    if type(value) is not str or not value.endswith("Z"):
        raise _GPUProofInvalid("timestamp_format_invalid")
    try:
        parsed = datetime.fromisoformat(f"{value[:-1]}+00:00")
    except ValueError as exc:
        raise _GPUProofInvalid("timestamp_format_invalid") from exc
    if _canonical_proof_timestamp(parsed) != value:
        raise _GPUProofInvalid("timestamp_format_invalid")
    return parsed


def _datetime_to_epoch_ms(value: datetime) -> int:
    utc_value = value.astimezone(UTC)
    delta = utc_value - datetime(1970, 1, 1, tzinfo=UTC)
    return delta.days * 86_400_000 + delta.seconds * 1_000 + delta.microseconds // 1_000


def _strict_nonnegative_int64(value: Any, *, reason: str) -> int:
    if type(value) is not int or value < 0 or value > _MAX_POSITIVE_INT64:
        raise _GPUProofInvalid(reason)
    return value


def _strict_bool_or_none(value: Any, *, reason: str) -> bool | None:
    if value is not None and type(value) is not bool:
        raise _GPUProofInvalid(reason)
    return value


def _strict_string_or_none(value: Any, *, reason: str) -> str | None:
    if value is not None and type(value) is not str:
        raise _GPUProofInvalid(reason)
    return value


def _registry_gpu_max_concurrency(extra_params: Any) -> int:
    if type(extra_params) is not dict:
        raise _GPUProofInvalid("registry_concurrency_invalid")
    raw = extra_params.get("max_concurrency", 4)
    if type(raw) is str and re.fullmatch(r"[1-9][0-9]{0,4}", raw) is not None:
        raw = int(raw)
    try:
        return normalize_gpu_backend_max_concurrency(raw)
    except ValueError as exc:
        raise _GPUProofInvalid("registry_concurrency_invalid") from exc


def _parse_canonical_positive_int64(value: Any, *, reason: str) -> str:
    if (
        type(value) is not str
        or _CANONICAL_POSITIVE_INT64_RE.fullmatch(value) is None
        or int(value) > _MAX_POSITIVE_INT64
    ):
        raise _GPUProofInvalid(reason)
    return value


def _parse_optional_canonical_positive_int64(value: Any, *, reason: str) -> str | None:
    if value is None:
        return None
    return _parse_canonical_positive_int64(value, reason=reason)


def _parse_gpu_proof_probe(value: Any) -> _GPUProofProbe:
    if type(value) is not dict or set(value) != _GPU_PROBE_KEYS:
        raise _GPUProofInvalid("probe_schema_invalid")
    if value["protocol_version"] != "1":
        raise _GPUProofInvalid("probe_protocol_invalid")
    challenge = value["challenge"]
    if (
        type(challenge) is not str
        or _GPU_HEALTH_CHALLENGE_RE.fullmatch(challenge) is None
    ):
        raise _GPUProofInvalid("probe_challenge_invalid")
    for field in (
        "backend_registry_id",
        "gpu_resource_id",
        "membership_state",
    ):
        if type(value[field]) is not str:
            raise _GPUProofInvalid(f"probe_{field}_invalid")
    _parse_canonical_positive_int64(
        value["membership_epoch"], reason="probe_membership_epoch_invalid"
    )
    probe_started_at = _parse_canonical_proof_timestamp(value["probe_started_at"])
    observed_at = _parse_canonical_proof_timestamp(value["observed_at"])
    if probe_started_at >= observed_at:
        raise _GPUProofInvalid("probe_clock_order_invalid")
    return _GPUProofProbe(
        raw=dict(value),
        probe_started_at=probe_started_at,
        observed_at=observed_at,
    )


def _parse_gpu_proof_residency(value: Any) -> _GPUProofResidency:
    if type(value) is not dict or set(value) != _GPU_RESIDENCY_KEYS:
        raise _GPUProofInvalid("residency_schema_invalid")

    state = value["state"]
    if type(state) is not str or state not in _GPU_RESIDENCY_STATES:
        raise _GPUProofInvalid("residency_state_invalid")
    gpu_loaded = _strict_bool_or_none(
        value["gpu_loaded"], reason="residency_gpu_loaded_invalid"
    )
    counters = {
        field: _strict_nonnegative_int64(
            value[field], reason=f"residency_{field}_invalid"
        )
        for field in ("active_requests", "builders", "borrowers")
    }
    if type(value["draining"]) is not bool:
        raise _GPUProofInvalid("residency_draining_invalid")
    if type(value["evictable"]) is not bool:
        raise _GPUProofInvalid("residency_evictable_invalid")
    generation = _parse_optional_canonical_positive_int64(
        value["generation"], reason="residency_generation_invalid"
    )
    control_epoch = _parse_optional_canonical_positive_int64(
        value["control_epoch"], reason="residency_control_epoch_invalid"
    )
    boot_id = value["boot_id"]
    if type(boot_id) is not str or not boot_id or len(boot_id) > 128:
        raise _GPUProofInvalid("residency_boot_id_invalid")
    lifecycle_gate = value["lifecycle_gate"]
    if type(lifecycle_gate) is not str or lifecycle_gate not in {"legacy", "enforce"}:
        raise _GPUProofInvalid("residency_lifecycle_gate_invalid")

    pools = value["pools"]
    if type(pools) is not dict or not pools:
        raise _GPUProofInvalid("residency_pools_invalid")
    pool_residencies: list[bool | None] = []
    for pool_id, pool in pools.items():
        if type(pool_id) is not str or not pool_id or pool_id.strip() != pool_id:
            raise _GPUProofInvalid("residency_pool_id_invalid")
        if type(pool) is not dict or set(pool) != _GPU_POOL_RESIDENCY_KEYS:
            raise _GPUProofInvalid("residency_pool_schema_invalid")
        pool_residencies.append(
            _strict_bool_or_none(
                pool["resident"], reason="residency_pool_state_invalid"
            )
        )
        _strict_string_or_none(pool["device"], reason="residency_pool_device_invalid")
        _strict_string_or_none(
            pool["provider"], reason="residency_pool_provider_invalid"
        )

    identity_value = value["identity"]
    identity: dict[str, str] | None
    if identity_value is None:
        identity = None
    else:
        if (
            type(identity_value) is not dict
            or set(identity_value) != _GPU_RESIDENCY_IDENTITY_KEYS
            or any(type(item) is not str for item in identity_value.values())
            or identity_value["audience"] != "aap-gpu-lifecycle"
        ):
            raise _GPUProofInvalid("residency_identity_invalid")
        identity = dict(identity_value)

    if gpu_loaded is False and (
        counters["builders"] != 0
        or counters["borrowers"] != 0
        or any(item is not False for item in pool_residencies)
    ):
        raise _GPUProofInvalid("residency_unloaded_inconsistent")
    if value["evictable"] and (
        generation is None or identity is None or lifecycle_gate != "enforce"
    ):
        raise _GPUProofInvalid("residency_evictable_inconsistent")

    return _GPUProofResidency(
        raw=dict(value),
        state=state,
        gpu_loaded=gpu_loaded,
        active_requests=counters["active_requests"],
        builders=counters["builders"],
        borrowers=counters["borrowers"],
        draining=value["draining"],
        evictable=value["evictable"],
        generation=generation,
        pool_residencies=tuple(pool_residencies),
        lifecycle_gate=lifecycle_gate,
        control_epoch=control_epoch,
        identity=identity,
    )


async def _lock_gpu_resource_proof_domain(
    db: AsyncSession, resource_id: str
) -> _LockedGPUProofDomain:
    await db.execute(
        text(
            "SELECT pg_advisory_xact_lock("
            "hashtextextended('aap:gpu-resource:' || :resource_id, 0))"
        ),
        {"resource_id": resource_id},
    )
    memberships = tuple(
        (
            await db.execute(
                select(GPUBackendMembership)
                .where(GPUBackendMembership.gpu_resource_id == resource_id)
                .order_by(GPUBackendMembership.backend_registry_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    backend_ids = [item.backend_registry_id for item in memberships]
    fences: tuple[GPUBackendFence, ...] = ()
    registries: tuple[MLBackendRegistry, ...] = ()
    if backend_ids:
        fences = tuple(
            (
                await db.execute(
                    select(GPUBackendFence)
                    .where(GPUBackendFence.backend_registry_id.in_(backend_ids))
                    .order_by(GPUBackendFence.backend_registry_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        # Registry mutation already owns its registry row before it waits for the
        # resource advisory lock.  A plain MVCC read avoids the inverse lock order;
        # the locked membership prevents that mutation from completing meanwhile.
        registries = tuple(
            (
                await db.execute(
                    select(MLBackendRegistry)
                    .where(MLBackendRegistry.id.in_(backend_ids))
                    .order_by(MLBackendRegistry.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
    db_now = await db.scalar(select(func.clock_timestamp()))
    if db_now is None or db_now.tzinfo is None or db_now.utcoffset() is None:
        raise RuntimeError("PostgreSQL returned an invalid proof clock")
    return _LockedGPUProofDomain(
        memberships=memberships,
        fences={item.backend_registry_id: item for item in fences},
        registries={item.id: item for item in registries},
        db_now=db_now,
    )


def _unknown_proof_allocation(
    membership: GPUBackendMembership,
    *,
    generation: str | None,
    last_used_at_ms: int,
) -> GPUAllocation:
    return GPUAllocation(
        backend_id=str(membership.backend_registry_id),
        state=GPUAllocationState.UNKNOWN,
        budget_mb=membership.vram_budget_mb,
        generation=generation,
        eviction_priority=membership.eviction_priority,
        evictable=False,
        max_concurrency=membership.max_concurrency,
        reservation_lease_id=None,
        reservation_owner_id=None,
        last_used_at_ms=last_used_at_ms,
    )


def _invalid_gpu_proof_evaluation(
    membership: GPUBackendMembership,
    context: GPUProofResetContext,
    *,
    reason: str,
    probe_document: Any,
    residency_document: Any,
) -> _GPUProofEvaluation:
    return _GPUProofEvaluation(
        allocation=_unknown_proof_allocation(
            membership,
            generation=None,
            last_used_at_ms=context.prepared_at_ms,
        ),
        complete=False,
        reason=reason,
        evidence_deadline_ms=None,
        probe_document=probe_document,
        residency_document=residency_document,
    )


def _evaluate_gpu_member_proof(
    membership: GPUBackendMembership,
    fence: GPUBackendFence | None,
    registry: MLBackendRegistry | None,
    *,
    context: GPUProofResetContext,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> _GPUProofEvaluation:
    raw_health = registry.health_meta if registry is not None else None
    raw_probe = (
        raw_health.get("gpu_arbiter_probe") if type(raw_health) is dict else None
    )
    raw_residency = raw_health.get("residency") if type(raw_health) is dict else None

    if membership.state == "retiring":
        return _invalid_gpu_proof_evaluation(
            membership,
            context,
            reason="membership_retiring",
            probe_document=None,
            residency_document=None,
        )
    if membership.state == "pending":
        # Activation changes the Redis active domain.  A pending candidate must
        # first activate and obtain a new challenge bound to that exact state;
        # otherwise a post-commit activation could leave a ready pending-domain
        # snapshot behind.
        return _invalid_gpu_proof_evaluation(
            membership,
            context,
            reason="membership_pending",
            probe_document=raw_probe,
            residency_document=raw_residency,
        )
    if membership.state != "active":
        return _invalid_gpu_proof_evaluation(
            membership,
            context,
            reason="membership_state_invalid",
            probe_document=raw_probe,
            residency_document=raw_residency,
        )
    if fence is None:
        return _invalid_gpu_proof_evaluation(
            membership,
            context,
            reason="fence_missing",
            probe_document=raw_probe,
            residency_document=raw_residency,
        )
    if registry is None:
        return _invalid_gpu_proof_evaluation(
            membership,
            context,
            reason="registry_missing",
            probe_document=None,
            residency_document=None,
        )

    try:
        generation_high_water = _strict_nonnegative_int64(
            fence.generation_high_water, reason="generation_high_water_invalid"
        )
        control_epoch_high_water = _strict_nonnegative_int64(
            fence.control_epoch_high_water,
            reason="control_epoch_high_water_invalid",
        )
        runtime_epoch_high_water = _strict_nonnegative_int64(
            fence.runtime_epoch_high_water, reason="runtime_epoch_high_water_invalid"
        )
        runtime_epoch_baseline = _strict_nonnegative_int64(
            membership.runtime_epoch_baseline,
            reason="runtime_epoch_baseline_invalid",
        )
        if runtime_epoch_high_water <= runtime_epoch_baseline:
            raise _GPUProofInvalid("active_runtime_epoch_invalid")

        if (
            registry.state != "connected"
            or registry.gpu_resource_id != membership.gpu_resource_id
            or registry.vram_budget_mb != membership.vram_budget_mb
            or registry.eviction_priority != membership.eviction_priority
        ):
            raise _GPUProofInvalid("registry_claim_mismatch")
        registry_max_concurrency = _registry_gpu_max_concurrency(registry.extra_params)
        if registry_max_concurrency != membership.max_concurrency:
            raise _GPUProofInvalid("registry_concurrency_mismatch")

        probe = _parse_gpu_proof_probe(raw_probe)
        if (
            probe.raw["backend_registry_id"] != str(membership.backend_registry_id)
            or probe.raw["gpu_resource_id"] != membership.gpu_resource_id
            or probe.raw["membership_epoch"] != str(membership.membership_epoch)
            or probe.raw["membership_state"] != membership.state
        ):
            raise _GPUProofInvalid("probe_membership_mismatch")
        if (
            registry.last_checked_at is None
            or registry.last_checked_at.tzinfo is None
            or registry.last_checked_at.utcoffset() is None
            or registry.last_checked_at.astimezone(UTC) != probe.observed_at
        ):
            raise _GPUProofInvalid("probe_registry_clock_mismatch")
        if probe.observed_at > db_now.astimezone(UTC):
            raise _GPUProofInvalid("probe_from_future")
        if db_now.astimezone(UTC) - probe.observed_at > evidence_ttl:
            raise _GPUProofInvalid("probe_expired")
        horizon = fence.token_expiry_high_water
        if horizon is not None:
            if horizon.tzinfo is None or horizon.utcoffset() is None:
                raise _GPUProofInvalid("token_horizon_invalid")
            if probe.probe_started_at <= horizon.astimezone(UTC):
                raise _GPUProofInvalid("probe_not_after_token_horizon")

        residency = _parse_gpu_proof_residency(raw_residency)
        identity = residency.identity
        if identity is not None and (
            identity["backend_registry_id"] != str(membership.backend_registry_id)
            or identity["gpu_resource_id"] != membership.gpu_resource_id
        ):
            raise _GPUProofInvalid("residency_identity_mismatch")
        if (
            residency.generation is not None or residency.control_epoch is not None
        ) and identity is None:
            raise _GPUProofInvalid("residency_identity_missing")
        if identity is not None and horizon is None:
            raise _GPUProofInvalid("token_horizon_missing")
        if (
            residency.generation is not None
            and int(residency.generation) > generation_high_water
        ):
            raise _GPUProofInvalid("residency_generation_ahead")
        if (
            residency.control_epoch is not None
            and int(residency.control_epoch) > control_epoch_high_water
        ):
            raise _GPUProofInvalid("residency_control_epoch_ahead")
        if residency.lifecycle_gate == "enforce" and (
            identity is None or residency.control_epoch is None
        ):
            raise _GPUProofInvalid("residency_enforce_identity_invalid")

        observed_at_ms = _datetime_to_epoch_ms(probe.observed_at)
        evidence_deadline_ms = _datetime_to_epoch_ms(probe.observed_at + evidence_ttl)
        idle = (
            residency.active_requests == 0
            and residency.builders == 0
            and residency.borrowers == 0
            and not residency.draining
        )
        pools_complete = all(item is not None for item in residency.pool_residencies)
        if (
            idle
            and pools_complete
            and residency.gpu_loaded is False
            and residency.state in {"unloaded", "resident"}
            and not residency.evictable
            and all(item is False for item in residency.pool_residencies)
        ):
            return _GPUProofEvaluation(
                allocation=None,
                complete=True,
                reason="unloaded",
                evidence_deadline_ms=evidence_deadline_ms,
                probe_document=probe.raw,
                residency_document=residency.raw,
            )
        if (
            idle
            and pools_complete
            and residency.state == "resident"
            and residency.gpu_loaded is True
            and any(item is True for item in residency.pool_residencies)
            and residency.generation is not None
            and identity is not None
        ):
            return _GPUProofEvaluation(
                allocation=GPUAllocation(
                    backend_id=str(membership.backend_registry_id),
                    state=GPUAllocationState.RESIDENT,
                    budget_mb=membership.vram_budget_mb,
                    generation=residency.generation,
                    eviction_priority=membership.eviction_priority,
                    # B2b does not yet consume the separate managed-lifecycle
                    # capability declaration.  Never amplify health self-report
                    # into eviction authority during proof recovery.
                    evictable=False,
                    max_concurrency=membership.max_concurrency,
                    reservation_lease_id=None,
                    reservation_owner_id=None,
                    last_used_at_ms=observed_at_ms,
                ),
                complete=True,
                reason="resident",
                evidence_deadline_ms=evidence_deadline_ms,
                probe_document=probe.raw,
                residency_document=residency.raw,
            )
        return _GPUProofEvaluation(
            allocation=_unknown_proof_allocation(
                membership,
                generation=residency.generation,
                last_used_at_ms=observed_at_ms,
            ),
            complete=False,
            reason="residency_not_stably_idle",
            evidence_deadline_ms=evidence_deadline_ms,
            probe_document=probe.raw,
            residency_document=residency.raw,
        )
    except _GPUProofInvalid as exc:
        return _invalid_gpu_proof_evaluation(
            membership,
            context,
            reason=exc.reason,
            probe_document=raw_probe,
            residency_document=raw_residency,
        )


def _optional_datetime_document(value: datetime | None) -> Any:
    if value is None:
        return None
    try:
        return _canonical_proof_timestamp(value)
    except _GPUProofInvalid:
        return {"invalid_naive_timestamp": value.isoformat()}


def _allocation_proof_document(allocation: GPUAllocation | None) -> Any:
    if allocation is None:
        return None
    return {
        "backend_id": allocation.backend_id,
        "state": allocation.state.value,
        "budget_mb": allocation.budget_mb,
        "generation": allocation.generation,
        "eviction_priority": allocation.eviction_priority,
        "evictable": allocation.evictable,
        "max_concurrency": allocation.max_concurrency,
        "last_used_at_ms": allocation.last_used_at_ms,
    }


def _gpu_proof_fingerprint(
    context: GPUProofResetContext,
    locked: _LockedGPUProofDomain,
    evaluations: Mapping[uuid.UUID, _GPUProofEvaluation],
    *,
    evidence_deadline_ms: int,
    requested_ready: bool,
    config_matches: bool,
) -> str:
    members: list[dict[str, Any]] = []
    for membership in locked.memberships:
        backend_id = membership.backend_registry_id
        fence = locked.fences.get(backend_id)
        registry = locked.registries.get(backend_id)
        evaluation = evaluations[backend_id]
        members.append(
            {
                "membership": {
                    "backend_registry_id": str(backend_id),
                    "gpu_resource_id": membership.gpu_resource_id,
                    "membership_epoch": str(membership.membership_epoch),
                    "runtime_epoch_baseline": str(membership.runtime_epoch_baseline),
                    "state": membership.state,
                    "vram_budget_mb": membership.vram_budget_mb,
                    "eviction_priority": membership.eviction_priority,
                    "max_concurrency": membership.max_concurrency,
                    "retired_at": _optional_datetime_document(membership.retired_at),
                    "retire_reason": membership.retire_reason,
                    "retired_generation_high_water": (
                        membership.retired_generation_high_water
                    ),
                    "retired_control_epoch_high_water": (
                        membership.retired_control_epoch_high_water
                    ),
                    "retired_runtime_epoch_high_water": (
                        membership.retired_runtime_epoch_high_water
                    ),
                    "retired_token_expiry_high_water": (
                        _optional_datetime_document(
                            membership.retired_token_expiry_high_water
                        )
                    ),
                },
                "fence": (
                    None
                    if fence is None
                    else {
                        "generation_high_water": str(fence.generation_high_water),
                        "control_epoch_high_water": str(fence.control_epoch_high_water),
                        "runtime_epoch_high_water": str(fence.runtime_epoch_high_water),
                        "token_expiry_high_water": _optional_datetime_document(
                            fence.token_expiry_high_water
                        ),
                    }
                ),
                "registry": (
                    None
                    if registry is None
                    else {
                        "state": registry.state,
                        "gpu_resource_id": registry.gpu_resource_id,
                        "vram_budget_mb": registry.vram_budget_mb,
                        "eviction_priority": registry.eviction_priority,
                        "max_concurrency": (
                            registry.extra_params.get("max_concurrency", 4)
                            if type(registry.extra_params) is dict
                            else None
                        ),
                        "last_checked_at": _optional_datetime_document(
                            registry.last_checked_at
                        ),
                    }
                ),
                "probe": evaluation.probe_document,
                "residency": evaluation.residency_document,
                "verdict": {
                    "complete": evaluation.complete,
                    "reason": evaluation.reason,
                    "allocation": _allocation_proof_document(evaluation.allocation),
                },
            }
        )

    document = {
        "schema": "gpu-arbiter-proof/v1",
        "reset": {
            "reset_id": context.reset_id,
            "resource_id": context.resource_id,
            "allocatable_mb": context.allocatable_mb,
            "expected_reset_revision": context.ledger_revision,
            "expected_reset_incarnation": context.ledger_incarnation,
            "prepared_at_ms": context.prepared_at_ms,
            "begin_fingerprint": context.begin_fingerprint,
            "backend_memberships": [
                {
                    "backend_id": item.backend_id,
                    "membership_epoch": str(item.membership_epoch),
                    "state": item.state,
                }
                for item in context.backend_memberships
            ],
            "evidence_deadline_ms": evidence_deadline_ms,
        },
        "config_matches": config_matches,
        "requested_ready": requested_ready,
        "members": members,
    }
    canonical = json.dumps(
        document,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def commit_gpu_proof_reset_from_health(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    context: GPUProofResetContext,
    *,
    config: Settings = settings,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUReconcileResult:
    """Consume cached live-health proof under the durable resource lock.

    This function performs no backend HTTP call.  The resource barrier, all
    membership rows, and all fence rows remain locked through the Redis commit, so
    token horizon advancement and membership creation cannot slip past the final
    proof check.  Invalid evidence is committed only as conservative not-ready
    state; Redis remains the atomic ledger linearization point.
    """

    validate_gpu_resource_id(context.resource_id)
    if evidence_ttl <= timedelta(0) or evidence_ttl > _PROOF_RESET_MAX_WINDOW:
        raise ValueError(
            "evidence_ttl must be positive and no greater than five minutes"
        )

    async with session_factory() as db:
        async with db.begin():
            locked = await _lock_gpu_resource_proof_domain(db, context.resource_id)
            current_domain = tuple(
                GPUBackendDomainMember(
                    backend_id=str(item.backend_registry_id),
                    membership_epoch=item.membership_epoch,
                    state=item.state,  # type: ignore[arg-type]
                )
                for item in locked.memberships
            )
            domain_matches = current_domain == context.backend_memberships
            configured_resource = config.gpu_arbiter_resources.get(context.resource_id)
            config_matches = (
                not config.gpu_arbiter_config_errors
                and configured_resource is not None
                and configured_resource.resource_id == context.resource_id
                and configured_resource.allocatable_mb == context.allocatable_mb
            )

            evaluations = {
                item.backend_registry_id: _evaluate_gpu_member_proof(
                    item,
                    locked.fences.get(item.backend_registry_id),
                    locked.registries.get(item.backend_registry_id),
                    context=context,
                    db_now=locked.db_now,
                    evidence_ttl=evidence_ttl,
                )
                for item in locked.memberships
            }
            allocations = tuple(
                evaluation.allocation
                for evaluation in evaluations.values()
                if evaluation.allocation is not None
            )
            has_active_member = any(
                item.state == "active" for item in locked.memberships
            )
            requested_ready = (
                domain_matches
                and config_matches
                and has_active_member
                and len(locked.fences) == len(locked.memberships)
                and all(item.complete for item in evaluations.values())
                and sum(item.budget_mb for item in allocations)
                <= context.allocatable_mb
            )
            if not domain_matches:
                # The prepared marker owns its original closed domain.  Clear that
                # snapshot conservatively; a later legal domain evolution can then
                # reconcile the current durable membership set.
                allocations = ()

            if requested_ready:
                proof_deadlines = [
                    item.evidence_deadline_ms
                    for item in evaluations.values()
                    if item.evidence_deadline_ms is not None
                ]
                evidence_deadline_ms = min(proof_deadlines)
            else:
                # A not-ready rewrite grants no authority and must remain available
                # after an arbitrarily long restart.  Zero is deterministic across
                # response-loss retries and is never persisted as a ready deadline.
                evidence_deadline_ms = 0

            proof_fingerprint = _gpu_proof_fingerprint(
                context,
                locked,
                evaluations,
                evidence_deadline_ms=evidence_deadline_ms,
                requested_ready=requested_ready,
                config_matches=config_matches,
            )
            return await store.commit_proof_reset(
                context.resource_id,
                context.allocatable_mb,
                reset_id=context.reset_id,
                expected_reset_revision=context.ledger_revision,
                expected_reset_incarnation=context.ledger_incarnation,
                backend_memberships=context.backend_memberships,
                allocations=allocations,
                ready=requested_ready,
                evidence_deadline_ms=evidence_deadline_ms,
                proof_fingerprint=proof_fingerprint,
            )


@dataclass(frozen=True)
class GPUResourceRepairResult:
    resource_id: str
    action: Literal[
        "already_ready",
        "bootstrap",
        "repair",
        "resume_prepared",
    ]
    status: str
    ready: bool
    reason: str
    ledger_revision: int
    ledger_incarnation: str
    committed_mb: int


@dataclass(frozen=True)
class GPUResourceRuntimeObservation:
    status: Literal[
        "disabled",
        "missing",
        "prepared",
        "ready",
        "not_ready",
        "corrupt",
        "unavailable",
    ]
    reason: str
    ready: bool
    ledger_revision: int | None
    ledger_incarnation: str | None
    reconcile_deadline_ms: int | None
    committed_mb: int | None
    backend_count: int
    active_backend_count: int
    membership_state_counts: dict[str, int]
    allocation_state_counts: dict[str, int]
    lease_count: int | None
    card_queue_count: int | None
    backend_queue_count: int | None
    transition_present: bool | None
    durable_domain_matches: bool | None


@dataclass(frozen=True)
class GPURetiredLiveProof:
    backend_id: uuid.UUID
    resource_id: str
    membership_epoch: int
    challenge: str
    probe_started_at: datetime
    observed_at: datetime
    evidence_deadline_ms: int
    evidence_fingerprint: str
    registry_url: str
    registry_auth_method: str
    registry_auth_token: str | None = dataclass_field(repr=False)
    residency: dict[str, Any]


@dataclass(frozen=True)
class GPURetiredProbeResult:
    backend_id: uuid.UUID
    resource_id: str
    membership_epoch: int
    reason: str
    proof: GPURetiredLiveProof | None = None


@dataclass(frozen=True)
class GPUTombstoneCollectionResult:
    backend_id: uuid.UUID
    resource_id: str
    membership_epoch: int
    status: Literal["collected", "blocked", "stale", "error"]
    reason: str
    redis_idempotent: bool = False


def _gpu_domain_members(
    memberships: Iterable[GPUBackendMembership],
) -> tuple[GPUBackendDomainMember, ...]:
    return tuple(
        GPUBackendDomainMember(
            backend_id=str(item.backend_registry_id),
            membership_epoch=item.membership_epoch,
            state=item.state,  # type: ignore[arg-type]
        )
        for item in memberships
    )


async def repair_gpu_resource(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    resource_id: str,
    allocatable_mb: int,
    *,
    config: Settings = settings,
) -> GPUResourceRepairResult:
    """Bootstrap or repair one desired-enforce resource without backend HTTP.

    A valid ready ledger is left untouched.  Every continuity-loss path uses the
    strict two-phase proof reset; ordinary reconciliation is never used to relax
    token-horizon or health requirements.
    """

    validate_gpu_resource_id(resource_id)
    if isinstance(allocatable_mb, bool) or not isinstance(allocatable_mb, int):
        raise ValueError("allocatable_mb must be a positive integer")
    if allocatable_mb <= 0:
        raise ValueError("allocatable_mb must be a positive integer")

    context = await store.prepared_proof_reset(resource_id)
    action: Literal["already_ready", "bootstrap", "repair", "resume_prepared"] = (
        "resume_prepared" if context is not None else "repair"
    )
    begin_result: GPUReconcileResult | None = None

    if context is None:
        async with session_factory() as db:
            async with db.begin():
                locked = await _lock_gpu_resource_proof_domain(db, resource_id)
                durable_domain = _gpu_domain_members(locked.memberships)
                snapshot: GPUCardSnapshot | None = None
                try:
                    snapshot = await store.snapshot(resource_id)
                except GPUArbiterStoreError as exc:
                    if str(exc) == "gpu_arbiter_proof_reset_in_progress":
                        action = "resume_prepared"
                    else:
                        action = "bootstrap"

                if snapshot is not None:
                    domain_matches = snapshot.backend_memberships == durable_domain
                    if (
                        snapshot.ready
                        and snapshot.allocatable_mb == allocatable_mb
                        and domain_matches
                        and all(member.state != "retiring" for member in durable_domain)
                    ):
                        return GPUResourceRepairResult(
                            resource_id=resource_id,
                            action="already_ready",
                            status="ready",
                            ready=True,
                            reason="",
                            ledger_revision=snapshot.ledger_revision,
                            ledger_incarnation=snapshot.ledger_incarnation,
                            committed_mb=snapshot.committed_mb,
                        )
                    expected_revision = snapshot.ledger_revision
                    expected_incarnation = snapshot.ledger_incarnation
                else:
                    cas = await store.proof_reset_cas(resource_id)
                    expected_revision = cas.ledger_revision if cas is not None else None
                    expected_incarnation = (
                        cas.ledger_incarnation if cas is not None else None
                    )

                if action != "resume_prepared":
                    reset_id = uuid.uuid4().hex
                    begin_result = await store.begin_proof_reset(
                        resource_id,
                        allocatable_mb,
                        expected_ledger_revision=expected_revision,
                        expected_ledger_incarnation=expected_incarnation,
                        backend_memberships=durable_domain,
                        reset_id=reset_id,
                    )
                    if (
                        begin_result.status == "stale_revision"
                        and begin_result.reason == "proof_reset_cas_required"
                        and begin_result.ledger_revision > 0
                        and begin_result.ledger_incarnation
                    ):
                        begin_result = await store.begin_proof_reset(
                            resource_id,
                            allocatable_mb,
                            expected_ledger_revision=(begin_result.ledger_revision),
                            expected_ledger_incarnation=(
                                begin_result.ledger_incarnation
                            ),
                            backend_memberships=durable_domain,
                            reset_id=reset_id,
                        )

        context = await store.prepared_proof_reset(resource_id)
        if context is None:
            if begin_result is None:
                raise GPUArbiterStoreError("gpu_arbiter_proof_reset_in_progress")
            return GPUResourceRepairResult(
                resource_id=resource_id,
                action=action,
                status=begin_result.status,
                ready=begin_result.ready,
                reason=begin_result.reason,
                ledger_revision=begin_result.ledger_revision,
                ledger_incarnation=begin_result.ledger_incarnation,
                committed_mb=begin_result.committed_mb,
            )

    result = await commit_gpu_proof_reset_from_health(
        session_factory,
        store,
        context,
        config=config,
    )
    return GPUResourceRepairResult(
        resource_id=resource_id,
        action=action,
        status=result.status,
        ready=result.ready,
        reason=result.reason,
        ledger_revision=result.ledger_revision,
        ledger_incarnation=result.ledger_incarnation,
        committed_mb=result.committed_mb,
    )


async def observe_gpu_resource_runtime(
    store: GPUArbiterStore,
    resource_id: str,
    durable_memberships: Sequence[GPUBackendDomainMember],
) -> GPUResourceRuntimeObservation:
    """Read one resource for admin/task observability; never use it as proof."""

    state_counts = {"pending": 0, "active": 0, "retiring": 0}
    for member in durable_memberships:
        state_counts[member.state] += 1
    try:
        prepared = await store.prepared_proof_reset(resource_id)
        if prepared is not None:
            return GPUResourceRuntimeObservation(
                status="prepared",
                reason="proof_reset_in_progress",
                ready=False,
                ledger_revision=prepared.ledger_revision,
                ledger_incarnation=prepared.ledger_incarnation,
                reconcile_deadline_ms=0,
                committed_mb=0,
                backend_count=len(prepared.backend_ids),
                active_backend_count=len(prepared.active_backend_ids),
                membership_state_counts=state_counts,
                allocation_state_counts={},
                lease_count=None,
                card_queue_count=None,
                backend_queue_count=None,
                transition_present=None,
                durable_domain_matches=(
                    prepared.backend_memberships == tuple(durable_memberships)
                ),
            )
        snapshot = await store.snapshot(resource_id)
    except GPUArbiterStoreError as exc:
        reason = str(exc)
        if reason == "gpu_arbiter_proof_reset_in_progress":
            prepared = await store.prepared_proof_reset(resource_id)
            if prepared is not None:
                return GPUResourceRuntimeObservation(
                    status="prepared",
                    reason=reason,
                    ready=False,
                    ledger_revision=prepared.ledger_revision,
                    ledger_incarnation=prepared.ledger_incarnation,
                    reconcile_deadline_ms=0,
                    committed_mb=0,
                    backend_count=len(prepared.backend_ids),
                    active_backend_count=len(prepared.active_backend_ids),
                    membership_state_counts=state_counts,
                    allocation_state_counts={},
                    lease_count=None,
                    card_queue_count=None,
                    backend_queue_count=None,
                    transition_present=None,
                    durable_domain_matches=(
                        prepared.backend_memberships == tuple(durable_memberships)
                    ),
                )
            status = "not_ready"
        elif reason == "gpu_arbiter_not_ready":
            status = "missing"
        elif reason == "gpu_arbiter_unavailable":
            status = "unavailable"
        else:
            status = "corrupt"
        return GPUResourceRuntimeObservation(
            status=status,
            reason=reason,
            ready=False,
            ledger_revision=None,
            ledger_incarnation=None,
            reconcile_deadline_ms=None,
            committed_mb=None,
            backend_count=0,
            active_backend_count=0,
            membership_state_counts=state_counts,
            allocation_state_counts={},
            lease_count=None,
            card_queue_count=None,
            backend_queue_count=None,
            transition_present=None,
            durable_domain_matches=None,
        )

    allocation_counts: dict[str, int] = defaultdict(int)
    for allocation in snapshot.allocations:
        allocation_counts[allocation.state.value] += 1
    return GPUResourceRuntimeObservation(
        status="ready" if snapshot.ready else "not_ready",
        reason="" if snapshot.ready else (snapshot.not_ready_reason or "not_ready"),
        ready=snapshot.ready,
        ledger_revision=snapshot.ledger_revision,
        ledger_incarnation=snapshot.ledger_incarnation,
        reconcile_deadline_ms=snapshot.reconcile_deadline_ms,
        committed_mb=snapshot.committed_mb,
        backend_count=len(snapshot.backend_ids),
        active_backend_count=len(snapshot.active_backend_ids),
        membership_state_counts=state_counts,
        allocation_state_counts=dict(sorted(allocation_counts.items())),
        lease_count=len(snapshot.leases),
        card_queue_count=snapshot.card_queue_count,
        backend_queue_count=snapshot.backend_queue_count,
        transition_present=snapshot.transition_present,
        durable_domain_matches=(
            snapshot.backend_memberships == tuple(durable_memberships)
        ),
    )


def disabled_gpu_resource_runtime_observation(
    durable_memberships: Sequence[GPUBackendDomainMember],
) -> GPUResourceRuntimeObservation:
    state_counts = {"pending": 0, "active": 0, "retiring": 0}
    for member in durable_memberships:
        state_counts[member.state] += 1
    return GPUResourceRuntimeObservation(
        status="disabled",
        reason="desired_mode_not_enforce",
        ready=False,
        ledger_revision=None,
        ledger_incarnation=None,
        reconcile_deadline_ms=None,
        committed_mb=None,
        backend_count=0,
        active_backend_count=0,
        membership_state_counts=state_counts,
        allocation_state_counts={},
        lease_count=None,
        card_queue_count=None,
        backend_queue_count=None,
        transition_present=None,
        durable_domain_matches=None,
    )


def _retired_proof_fingerprint(
    membership: GPUBackendMembership,
    *,
    challenge: str,
    probe_started_at: datetime,
    observed_at: datetime,
    evidence_deadline_ms: int,
    registry_url: str,
    registry_auth_method: str,
    registry_auth_token: str | None,
    residency: Mapping[str, Any],
) -> str:
    document = {
        "schema": "gpu-arbiter-retired-proof/v1",
        "membership": {
            "backend_id": str(membership.backend_registry_id),
            "resource_id": membership.gpu_resource_id,
            "membership_epoch": str(membership.membership_epoch),
            "retirement_id": str(membership.retirement_id),
            "state": membership.state,
            "vram_budget_mb": membership.vram_budget_mb,
            "retired_generation_high_water": (membership.retired_generation_high_water),
            "retired_control_epoch_high_water": (
                membership.retired_control_epoch_high_water
            ),
            "retired_runtime_epoch_high_water": (
                membership.retired_runtime_epoch_high_water
            ),
            "retired_token_expiry_high_water": _optional_datetime_document(
                membership.retired_token_expiry_high_water
            ),
        },
        "probe": {
            "challenge": challenge,
            "probe_started_at": _canonical_proof_timestamp(probe_started_at),
            "observed_at": _canonical_proof_timestamp(observed_at),
            "evidence_deadline_ms": evidence_deadline_ms,
        },
        "route": {
            "url": registry_url,
            "auth_method": registry_auth_method,
            "auth_token_sha256": hashlib.sha256(
                (registry_auth_token or "").encode("utf-8")
            ).hexdigest(),
        },
        "residency": residency,
    }
    return hashlib.sha256(
        json.dumps(
            document,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()


def _validate_retired_live_unloaded(
    membership: GPUBackendMembership,
    *,
    probe_started_at: datetime,
    observed_at: datetime,
    residency_document: Any,
) -> dict[str, Any]:
    if membership.state != "retiring":
        raise _GPUProofInvalid("membership_not_retiring")
    if membership.retirement_id is None:
        raise _GPUProofInvalid("retirement_identity_missing")
    if (
        probe_started_at.tzinfo is None
        or probe_started_at.utcoffset() is None
        or observed_at.tzinfo is None
        or observed_at.utcoffset() is None
    ):
        raise _GPUProofInvalid("probe_timestamp_invalid")
    horizon = membership.retired_token_expiry_high_water
    if horizon is not None:
        if horizon.tzinfo is None or horizon.utcoffset() is None:
            raise _GPUProofInvalid("retired_token_horizon_invalid")
        if probe_started_at.astimezone(UTC) <= horizon.astimezone(UTC):
            raise _GPUProofInvalid("probe_not_after_retired_token_horizon")
    if probe_started_at >= observed_at:
        raise _GPUProofInvalid("probe_clock_order_invalid")
    residency = _parse_gpu_proof_residency(residency_document)
    identity = residency.identity
    if identity is None:
        raise _GPUProofInvalid("residency_identity_missing")
    if (
        identity["backend_registry_id"] != str(membership.backend_registry_id)
        or identity["gpu_resource_id"] != membership.gpu_resource_id
    ):
        raise _GPUProofInvalid("residency_identity_mismatch")
    if (
        residency.state not in {"unloaded", "resident"}
        or residency.gpu_loaded is not False
        or residency.active_requests != 0
        or residency.builders != 0
        or residency.borrowers != 0
        or residency.draining
        or residency.evictable
        or any(item is not False for item in residency.pool_residencies)
    ):
        raise _GPUProofInvalid("residency_not_stably_unloaded")
    if residency.generation is not None and (
        membership.retired_generation_high_water is None
        or int(residency.generation) > membership.retired_generation_high_water
    ):
        raise _GPUProofInvalid("residency_generation_ahead")
    if residency.control_epoch is not None and (
        membership.retired_control_epoch_high_water is None
        or int(residency.control_epoch) > membership.retired_control_epoch_high_water
    ):
        raise _GPUProofInvalid("residency_control_epoch_ahead")
    return residency.raw


async def probe_retired_gpu_membership(
    session_factory: GPUFenceSessionFactory,
    backend_id: uuid.UUID,
    resource_id: str,
    membership_epoch: int,
    *,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPURetiredProbeResult:
    """Obtain fresh challenge-bound evidence for one retiring tombstone."""

    validate_gpu_resource_id(resource_id)
    if evidence_ttl <= timedelta(0) or evidence_ttl > _HEALTH_EVIDENCE_MAX_AGE:
        raise ValueError("retired GPU evidence TTL must be within three minutes")
    async with session_factory() as db:
        membership = await db.scalar(
            select(GPUBackendMembership).where(
                GPUBackendMembership.backend_registry_id == backend_id,
                GPUBackendMembership.gpu_resource_id == resource_id,
                GPUBackendMembership.membership_epoch == membership_epoch,
                GPUBackendMembership.state == "retiring",
            )
        )
        registry = await db.get(MLBackendRegistry, backend_id)
        probe_started_at = await db.scalar(select(func.clock_timestamp()))
    if membership is None:
        return GPURetiredProbeResult(
            backend_id, resource_id, membership_epoch, "tombstone_missing"
        )
    if registry is None:
        return GPURetiredProbeResult(
            backend_id,
            resource_id,
            membership_epoch,
            "registry_missing_for_live_gc",
        )
    if probe_started_at is None:
        return GPURetiredProbeResult(
            backend_id, resource_id, membership_epoch, "probe_clock_missing"
        )
    if probe_started_at.tzinfo is None or probe_started_at.utcoffset() is None:
        return GPURetiredProbeResult(
            backend_id, resource_id, membership_epoch, "probe_timestamp_invalid"
        )
    horizon = membership.retired_token_expiry_high_water
    if horizon is not None:
        if horizon.tzinfo is None or horizon.utcoffset() is None:
            return GPURetiredProbeResult(
                backend_id,
                resource_id,
                membership_epoch,
                "retired_token_horizon_invalid",
            )
        if probe_started_at.astimezone(UTC) <= horizon.astimezone(UTC):
            return GPURetiredProbeResult(
                backend_id,
                resource_id,
                membership_epoch,
                "waiting_token_horizon",
            )

    challenge = secrets.token_hex(32)
    from app.services.ml_client import (  # local import avoids ml_client cycle
        GPU_HEALTH_CHALLENGE_ECHO_MARKER,
        MLBackendClient,
    )

    healthy, meta = await MLBackendClient(registry).health_meta(
        gpu_health_challenge=challenge
    )
    async with session_factory() as db:
        observed_at = await db.scalar(select(func.clock_timestamp()))
    if observed_at is None:
        return GPURetiredProbeResult(
            backend_id, resource_id, membership_epoch, "probe_clock_missing"
        )
    if not healthy or type(meta) is not dict:
        return GPURetiredProbeResult(
            backend_id, resource_id, membership_epoch, "live_health_unavailable"
        )
    meta = dict(meta)
    if meta.pop(GPU_HEALTH_CHALLENGE_ECHO_MARKER, None) != challenge:
        return GPURetiredProbeResult(
            backend_id, resource_id, membership_epoch, "challenge_echo_missing"
        )
    try:
        residency = _validate_retired_live_unloaded(
            membership,
            probe_started_at=probe_started_at,
            observed_at=observed_at,
            residency_document=meta.get("residency"),
        )
    except _GPUProofInvalid as exc:
        return GPURetiredProbeResult(
            backend_id, resource_id, membership_epoch, exc.reason
        )
    evidence_deadline_ms = _datetime_to_epoch_ms(observed_at + evidence_ttl)
    fingerprint = _retired_proof_fingerprint(
        membership,
        challenge=challenge,
        probe_started_at=probe_started_at,
        observed_at=observed_at,
        evidence_deadline_ms=evidence_deadline_ms,
        registry_url=registry.url,
        registry_auth_method=registry.auth_method,
        registry_auth_token=registry.auth_token,
        residency=residency,
    )
    proof = GPURetiredLiveProof(
        backend_id=backend_id,
        resource_id=resource_id,
        membership_epoch=membership_epoch,
        challenge=challenge,
        probe_started_at=probe_started_at,
        observed_at=observed_at,
        evidence_deadline_ms=evidence_deadline_ms,
        evidence_fingerprint=fingerprint,
        registry_url=registry.url,
        registry_auth_method=registry.auth_method,
        registry_auth_token=registry.auth_token,
        residency=residency,
    )
    return GPURetiredProbeResult(
        backend_id, resource_id, membership_epoch, "live_unloaded", proof
    )


async def _delete_gpu_tombstone_from_receipt(
    db: AsyncSession,
    membership: GPUBackendMembership,
    *,
    receipt_fingerprint: str,
    registry_exists: bool,
) -> None:
    if membership.retirement_id is None:
        raise RuntimeError("GPU tombstone retirement identity is missing")
    receipt = json.dumps(
        {
            "backend_id": str(membership.backend_registry_id),
            "resource_id": membership.gpu_resource_id,
            "membership_epoch": str(membership.membership_epoch),
            "retirement_id": str(membership.retirement_id),
            "fingerprint": receipt_fingerprint,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    await db.execute(
        text("SELECT set_config('app.gpu_tombstone_gc_receipt', :receipt, true)"),
        {"receipt": receipt},
    )
    result = await db.execute(
        delete(GPUBackendMembership).where(
            GPUBackendMembership.backend_registry_id == membership.backend_registry_id,
            GPUBackendMembership.gpu_resource_id == membership.gpu_resource_id,
            GPUBackendMembership.membership_epoch == membership.membership_epoch,
            GPUBackendMembership.state == "retiring",
        )
    )
    if result.rowcount != 1:
        raise RuntimeError("GPU tombstone changed before collection")
    remaining = await db.scalar(
        select(func.count())
        .select_from(GPUBackendMembership)
        .where(
            GPUBackendMembership.backend_registry_id == membership.backend_registry_id
        )
    )
    if not registry_exists and remaining == 0:
        await db.execute(
            delete(GPUBackendFence).where(
                GPUBackendFence.backend_registry_id == membership.backend_registry_id
            )
        )


async def collect_gpu_backend_tombstone(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    backend_id: uuid.UUID,
    resource_id: str,
    membership_epoch: int,
    *,
    proof: GPURetiredLiveProof | None,
) -> GPUTombstoneCollectionResult:
    """Finalize an existing Redis receipt or consume new live proof in two stages."""

    async with session_factory() as db:
        async with db.begin():
            locked = await _lock_gpu_resource_proof_domain(db, resource_id)
            membership = next(
                (
                    item
                    for item in locked.memberships
                    if item.backend_registry_id == backend_id
                    and item.membership_epoch == membership_epoch
                    and item.state == "retiring"
                ),
                None,
            )
            if membership is None:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "collected",
                    "tombstone_already_absent",
                    True,
                )
            durable_domain = _gpu_domain_members(locked.memberships)
            receipt = await store.verify_tombstone_gc_receipt(
                resource_id,
                backend_memberships=durable_domain,
                backend_id=str(backend_id),
                membership_epoch=membership_epoch,
                retirement_id=str(membership.retirement_id),
            )
            if receipt is not None:
                await _delete_gpu_tombstone_from_receipt(
                    db,
                    membership,
                    receipt_fingerprint=receipt.fingerprint,
                    registry_exists=backend_id in locked.registries,
                )
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "collected",
                    "redis_receipt_finalized",
                    True,
                )
            if proof is None:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    "redis_receipt_missing",
                )
            registry = locked.registries.get(backend_id)
            if (
                proof.backend_id != backend_id
                or proof.resource_id != resource_id
                or proof.membership_epoch != membership_epoch
            ):
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    "live_proof_membership_mismatch",
                )
            if _GPU_HEALTH_CHALLENGE_RE.fullmatch(proof.challenge) is None:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    "live_proof_challenge_invalid",
                )
            if registry is None:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    "registry_missing_for_live_gc",
                )
            if (
                registry.url != proof.registry_url
                or registry.auth_method != proof.registry_auth_method
                or registry.auth_token != proof.registry_auth_token
            ):
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "stale",
                    "live_probe_route_changed",
                )
            try:
                residency = _validate_retired_live_unloaded(
                    membership,
                    probe_started_at=proof.probe_started_at,
                    observed_at=proof.observed_at,
                    residency_document=proof.residency,
                )
            except _GPUProofInvalid as exc:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    exc.reason,
                )
            observed_at_ms = _datetime_to_epoch_ms(proof.observed_at)
            maximum_deadline_ms = _datetime_to_epoch_ms(
                proof.observed_at + _HEALTH_EVIDENCE_MAX_AGE
            )
            if not (observed_at_ms < proof.evidence_deadline_ms <= maximum_deadline_ms):
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    "live_proof_deadline_invalid",
                )
            if (
                locked.db_now < proof.observed_at
                or locked.db_now - proof.observed_at > _HEALTH_EVIDENCE_MAX_AGE
                or _datetime_to_epoch_ms(locked.db_now) >= proof.evidence_deadline_ms
            ):
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "stale",
                    "live_proof_expired",
                )
            fingerprint = _retired_proof_fingerprint(
                membership,
                challenge=proof.challenge,
                probe_started_at=proof.probe_started_at,
                observed_at=proof.observed_at,
                evidence_deadline_ms=proof.evidence_deadline_ms,
                registry_url=proof.registry_url,
                registry_auth_method=proof.registry_auth_method,
                registry_auth_token=proof.registry_auth_token,
                residency=residency,
            )
            if fingerprint != proof.evidence_fingerprint:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    "live_proof_fingerprint_mismatch",
                )
            try:
                snapshot = await store.snapshot(resource_id)
            except GPUArbiterStoreError as exc:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "blocked",
                    str(exc),
                )
            if snapshot.backend_memberships != durable_domain:
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    "stale",
                    "membership_domain_changed",
                )
            collection = await store.collect_retired_backend(
                resource_id,
                expected_ledger_revision=snapshot.ledger_revision,
                expected_ledger_incarnation=snapshot.ledger_incarnation,
                backend_memberships=durable_domain,
                backend_id=str(backend_id),
                membership_epoch=membership_epoch,
                retirement_id=str(membership.retirement_id),
                vram_budget_mb=membership.vram_budget_mb,
                evidence_deadline_ms=proof.evidence_deadline_ms,
                evidence_fingerprint=proof.evidence_fingerprint,
                collection_id=hashlib.sha256(
                    (
                        proof.evidence_fingerprint
                        + ":"
                        + str(backend_id)
                        + ":"
                        + str(membership_epoch)
                        + ":"
                        + str(membership.retirement_id)
                    ).encode("utf-8")
                ).hexdigest(),
            )
            if collection.status != "collected":
                return GPUTombstoneCollectionResult(
                    backend_id,
                    resource_id,
                    membership_epoch,
                    ("stale" if collection.status == "stale_revision" else "blocked"),
                    collection.reason or collection.status,
                    collection.idempotent,
                )
            receipt = await store.verify_tombstone_gc_receipt(
                resource_id,
                backend_memberships=durable_domain,
                backend_id=str(backend_id),
                membership_epoch=membership_epoch,
                retirement_id=str(membership.retirement_id),
            )
            if receipt is None:
                raise GPUArbiterStoreError(
                    "GPU tombstone receipt disappeared after collection"
                )
            await _delete_gpu_tombstone_from_receipt(
                db,
                membership,
                receipt_fingerprint=receipt.fingerprint,
                registry_exists=True,
            )
            return GPUTombstoneCollectionResult(
                backend_id,
                resource_id,
                membership_epoch,
                "collected",
                "proof_backed_collection_complete",
                collection.idempotent,
            )


@dataclass(frozen=True)
class GPUShadowCandidate:
    """One safe-looking candidate in a P2 snapshot, not an eviction selection."""

    backend_id: str
    vram_budget_mb: int
    eviction_priority: int
    generation: str


@dataclass(frozen=True)
class GPUShadowDecision:
    """Non-authoritative P2 decision emitted for observability only."""

    decision: Literal["would-admit", "would-evict", "would-reject"]
    reason: str
    operation: str
    backend_id: str
    resource_id: str | None
    global_mode: Literal["off", "observe", "enforce"]
    desired_mode: Literal["off", "observe", "enforce"]
    effective_mode: Literal["off", "observe", "enforce"]
    allocatable_mb: int | None
    committed_before_mb: int
    requested_increment_mb: int
    projected_mb: int
    shortfall_mb: int
    candidates: tuple[GPUShadowCandidate, ...] = ()
    uncertain_backend_ids: tuple[str, ...] = ()
    authoritative: bool = False
    candidate_order_authoritative: bool = False
    unmanaged_workload: bool = True


def effective_gpu_arbiter_mode(
    resource_id: str, *, config: Settings = settings
) -> GPUArbiterMode:
    """P2b can make observe effective; enforce stays off until P3/P4 handshakes."""

    desired = config.gpu_arbiter_desired_mode(resource_id)
    if desired is GPUArbiterMode.OBSERVE:
        return GPUArbiterMode.OBSERVE
    return GPUArbiterMode.OFF


def any_gpu_resource_effectively_enforced(*, config: Settings = settings) -> bool:
    """Return whether at least one configured resource is truly enforced."""

    return any(
        effective_gpu_arbiter_mode(resource_id, config=config) is GPUArbiterMode.ENFORCE
        for resource_id in config.gpu_arbiter_resources
    )


def unregistered_gpu_loading_blocked(*, config: Settings = settings) -> bool:
    """Block raw loading URLs once any resource is effectively enforced."""

    return any_gpu_resource_effectively_enforced(config=config)


def gpu_shadow_observation_enabled(
    resource_id: str | None, *, config: Settings = settings
) -> bool:
    """Fast, side-effect-free guard used before opening a shadow DB session."""

    if config.gpu_arbiter_mode is GPUArbiterMode.OFF:
        return False
    if resource_id is None:
        return config.gpu_arbiter_mode is GPUArbiterMode.OBSERVE
    if resource_id not in config.gpu_arbiter_resources:
        # observe 仍需暴露未知/畸形 claim；enforce 下未知资源继续安全回落 off。
        return config.gpu_arbiter_mode is GPUArbiterMode.OBSERVE
    return (
        effective_gpu_arbiter_mode(resource_id, config=config) is GPUArbiterMode.OBSERVE
    )


class GPUClaimConfigurationError(ValueError):
    """A registry claim cannot be represented safely by current resource config."""

    def __init__(self, diagnostics: list[GPUConfigDiagnostic]) -> None:
        self.diagnostics = diagnostics
        message = diagnostics[0].message if diagnostics else "GPU 资源配置无效"
        super().__init__(message)


def _diag(
    code: str,
    level: str,
    message: str,
    *,
    field: str | None = None,
    resource_id: str | None = None,
    backend_id: Any = None,
) -> GPUConfigDiagnostic:
    return GPUConfigDiagnostic(
        code=code,
        level=level,
        message=message,
        field=field,
        resource_id=resource_id,
        backend_id=backend_id,
    )


def _claim_shape_diagnostics(
    gpu_resource_id: str | None,
    vram_budget_mb: int | None,
    *,
    backend_id: Any = None,
) -> list[GPUConfigDiagnostic]:
    diagnostics: list[GPUConfigDiagnostic] = []
    if (gpu_resource_id is None) != (vram_budget_mb is None):
        diagnostics.append(
            _diag(
                "gpu_claim_incomplete",
                "blocker",
                "gpu_resource_id 与 vram_budget_mb 必须同时设置或同时为 null",
                field="gpu_resource_id",
                resource_id=gpu_resource_id,
                backend_id=backend_id,
            )
        )
    if gpu_resource_id is not None:
        try:
            validate_gpu_resource_id(gpu_resource_id)
        except ValueError as exc:
            diagnostics.append(
                _diag(
                    "gpu_resource_id_invalid",
                    "blocker",
                    str(exc),
                    field="gpu_resource_id",
                    resource_id=gpu_resource_id,
                    backend_id=backend_id,
                )
            )
    if vram_budget_mb is not None and (
        isinstance(vram_budget_mb, bool)
        or not isinstance(vram_budget_mb, int)
        or vram_budget_mb <= 0
    ):
        diagnostics.append(
            _diag(
                "vram_budget_invalid",
                "blocker",
                "vram_budget_mb 必须是正整数 MiB",
                field="vram_budget_mb",
                resource_id=gpu_resource_id,
                backend_id=backend_id,
            )
        )
    return diagnostics


def validate_gpu_claim(
    gpu_resource_id: str | None,
    vram_budget_mb: int | None,
    *,
    extra_params: Mapping[str, Any] | None = None,
    config: Settings = settings,
) -> None:
    """Reject only per-backend blockers; aggregate oversubscription stays a warning."""

    diagnostics = _claim_shape_diagnostics(gpu_resource_id, vram_budget_mb)
    if gpu_resource_id is not None and not diagnostics:
        resource = config.gpu_arbiter_resources.get(gpu_resource_id)
        if config.gpu_arbiter_config_errors:
            diagnostics.append(
                _diag(
                    "gpu_resources_config_invalid",
                    "blocker",
                    "GPU_ARBITER_RESOURCES_JSON 无法解析："
                    f"{config.gpu_arbiter_config_errors[0]}",
                    field="gpu_resource_id",
                    resource_id=gpu_resource_id,
                )
            )
        elif resource is None:
            diagnostics.append(
                _diag(
                    "gpu_resource_unknown",
                    "blocker",
                    f"未在 GPU_ARBITER_RESOURCES_JSON 中找到 {gpu_resource_id}",
                    field="gpu_resource_id",
                    resource_id=gpu_resource_id,
                )
            )
        elif vram_budget_mb is not None and vram_budget_mb > resource.allocatable_mb:
            diagnostics.append(
                _diag(
                    "vram_budget_exceeds_allocatable",
                    "blocker",
                    f"预算 {vram_budget_mb} MiB 超过该资源可分配容量 "
                    f"{resource.allocatable_mb} MiB",
                    field="vram_budget_mb",
                    resource_id=gpu_resource_id,
                )
            )
        if extra_params is not None and "max_concurrency" in extra_params:
            raw_limit = extra_params["max_concurrency"]
            valid_limit = (
                isinstance(raw_limit, int)
                and not isinstance(raw_limit, bool)
                and 1 <= raw_limit <= 10000
            ) or (
                isinstance(raw_limit, str)
                and re.fullmatch(r"[1-9][0-9]{0,4}", raw_limit) is not None
                and int(raw_limit) <= 10000
            )
            if not valid_limit:
                diagnostics.append(
                    _diag(
                        "gpu_max_concurrency_invalid",
                        "blocker",
                        "extra_params.max_concurrency 必须是 1 到 10000 的整数",
                        field="extra_params.max_concurrency",
                        resource_id=gpu_resource_id,
                    )
                )
    if diagnostics:
        raise GPUClaimConfigurationError(diagnostics)


def claimed_budget_by_resource(backends: Iterable[Any]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for backend in backends:
        resource_id = getattr(backend, "gpu_resource_id", None)
        budget = getattr(backend, "vram_budget_mb", None)
        if (
            resource_id is not None
            and isinstance(budget, int)
            and not isinstance(budget, bool)
        ):
            totals[resource_id] += budget
    return dict(totals)


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _health_evidence_is_trusted(backend: Any, *, now: datetime | None = None) -> bool:
    if getattr(backend, "state", None) != "connected":
        return False
    checked_at = getattr(backend, "last_checked_at", None)
    if not isinstance(checked_at, datetime) or checked_at.tzinfo is None:
        return False
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    age = current.astimezone(UTC) - checked_at.astimezone(UTC)
    if age > _HEALTH_EVIDENCE_MAX_AGE or age < -_HEALTH_EVIDENCE_FUTURE_SKEW:
        return False
    return True


def _trusted_health_meta(
    backend: Any, *, now: datetime | None = None
) -> Mapping[str, Any]:
    if not _health_evidence_is_trusted(backend, now=now):
        return {}
    return _as_mapping(getattr(backend, "health_meta", None))


def _requires_gpu_claim(health_meta: Mapping[str, Any]) -> bool:
    compute = _as_mapping(health_meta.get("compute"))
    configured = compute.get("configured_device")
    configured = configured.strip().lower() if isinstance(configured, str) else None
    effective = compute.get("effective_device")
    effective = effective.strip().lower() if isinstance(effective, str) else None
    provider = compute.get("effective_provider")
    provider = provider.strip().lower() if isinstance(provider, str) else None
    capabilities = _as_mapping(health_meta.get("capabilities"))
    infra = capabilities.get("infra")
    infra = infra.strip().lower() if isinstance(infra, str) else None
    residency = _as_mapping(health_meta.get("residency"))
    return bool(
        configured == "gpu"
        or (configured and configured.startswith("cuda"))
        or (effective and effective.startswith("cuda"))
        or (provider and ("cuda" in provider or "tensorrt" in provider))
        or infra == "gpu"
        or residency.get("gpu_loaded") is True
    )


def _is_explicit_cpu_backend(
    health_meta: Mapping[str, Any], *, requires_gpu_claim: bool
) -> bool:
    compute = _as_mapping(health_meta.get("compute"))
    configured = compute.get("configured_device")
    return (
        isinstance(configured, str)
        and configured.strip().lower() == "cpu"
        and not requires_gpu_claim
    )


def backend_is_trusted_explicit_cpu(
    backend: Any, *, now: datetime | None = None
) -> bool:
    """Accept a null GPU claim only with fresh, connected explicit-CPU evidence."""

    health_meta = _trusted_health_meta(backend, now=now)
    requires_gpu_claim = _requires_gpu_claim(health_meta)
    return _is_explicit_cpu_backend(
        health_meta,
        requires_gpu_claim=requires_gpu_claim,
    )


def strict_gpu_loaded_evidence(health_meta: Mapping[str, Any]) -> bool | None:
    """Normalize residency without letting malformed ``false`` release capacity."""

    raw_residency = health_meta.get("residency")
    if not isinstance(raw_residency, Mapping):
        return None
    gpu_loaded = raw_residency.get("gpu_loaded")
    if gpu_loaded is True:
        return True
    if gpu_loaded is not False:
        return None
    builders = raw_residency.get("builders")
    borrowers = raw_residency.get("borrowers")
    if (
        isinstance(builders, bool)
        or not isinstance(builders, int)
        or builders != 0
        or isinstance(borrowers, bool)
        or not isinstance(borrowers, int)
        or borrowers != 0
    ):
        return None
    pools = raw_residency.get("pools")
    if not isinstance(pools, Mapping):
        return None
    for pool in pools.values():
        if not isinstance(pool, Mapping) or pool.get("resident") is not False:
            return None
    return False


def _is_strict_zero(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value == 0


def _canonical_generation(value: Any) -> str | None:
    if (
        not isinstance(value, str)
        or _CANONICAL_POSITIVE_INT64_RE.fullmatch(value) is None
    ):
        return None
    if int(value) > _MAX_POSITIVE_INT64:
        return None
    return value


def _safe_shadow_candidate(
    backend: Any,
    health_meta: Mapping[str, Any],
    *,
    resource_id: str,
    requester_priority: int,
) -> GPUShadowCandidate | None:
    residency = health_meta.get("residency")
    if not isinstance(residency, Mapping):
        return None
    generation = _canonical_generation(residency.get("generation"))
    identity = residency.get("identity")
    backend_id = str(getattr(backend, "id", ""))
    if (
        residency.get("state") != "resident"
        or residency.get("gpu_loaded") is not True
        or residency.get("evictable") is not True
        or residency.get("lifecycle_gate") != "enforce"
        or generation is None
        or not isinstance(residency.get("boot_id"), str)
        or not residency.get("boot_id")
        or _canonical_generation(residency.get("control_epoch")) is None
        or not _is_strict_zero(residency.get("active_requests"))
        or not _is_strict_zero(residency.get("builders"))
        or not _is_strict_zero(residency.get("borrowers"))
        or residency.get("draining") is not False
        or not isinstance(identity, Mapping)
        or identity.get("audience") != "aap-gpu-lifecycle"
        or identity.get("backend_registry_id") != backend_id
        or identity.get("gpu_resource_id") != resource_id
    ):
        return None
    priority = getattr(backend, "eviction_priority", 0)
    budget = getattr(backend, "vram_budget_mb", None)
    if (
        isinstance(priority, bool)
        or not isinstance(priority, int)
        or priority > requester_priority
        or isinstance(budget, bool)
        or not isinstance(budget, int)
        or budget <= 0
    ):
        return None
    return GPUShadowCandidate(
        backend_id=backend_id,
        vram_budget_mb=budget,
        eviction_priority=priority,
        generation=generation,
    )


def _shadow_reject_for_claim(
    requester: Any,
    *,
    operation: str,
    reason: str,
    resource_id: str | None,
    global_mode: str,
    desired_mode: str,
    effective_mode: str,
    allocatable_mb: int | None = None,
) -> GPUShadowDecision:
    return GPUShadowDecision(
        decision="would-reject",
        reason=reason,
        operation=operation,
        backend_id=str(getattr(requester, "id", "")),
        resource_id=resource_id,
        global_mode=global_mode,  # type: ignore[arg-type]
        desired_mode=desired_mode,  # type: ignore[arg-type]
        effective_mode=effective_mode,  # type: ignore[arg-type]
        allocatable_mb=allocatable_mb,
        committed_before_mb=0,
        requested_increment_mb=0,
        projected_mb=0,
        shortfall_mb=0,
    )


def evaluate_gpu_shadow_decision(
    requester: Any,
    backends: Iterable[Any],
    *,
    operation: str,
    config: Settings = settings,
    now: datetime | None = None,
) -> GPUShadowDecision | None:
    """Evaluate one observe-mode dispatch without changing business behavior."""

    resource_id = getattr(requester, "gpu_resource_id", None)
    budget = getattr(requester, "vram_budget_mb", None)
    requester_health = _trusted_health_meta(requester, now=now)
    requires_gpu_claim = _requires_gpu_claim(requester_health)

    if resource_id is None and budget is None:
        if config.gpu_arbiter_mode is not GPUArbiterMode.OBSERVE:
            return None
        if _is_explicit_cpu_backend(
            requester_health, requires_gpu_claim=requires_gpu_claim
        ):
            return None
        return _shadow_reject_for_claim(
            requester,
            operation=operation,
            reason="gpu_claim_missing_or_unverified",
            resource_id=None,
            global_mode=config.gpu_arbiter_mode.value,
            desired_mode="off",
            effective_mode="off",
        )

    if (
        not isinstance(resource_id, str)
        or not resource_id
        or (isinstance(budget, bool) or not isinstance(budget, int) or budget <= 0)
    ):
        if config.gpu_arbiter_mode is not GPUArbiterMode.OBSERVE:
            return None
        return _shadow_reject_for_claim(
            requester,
            operation=operation,
            reason="gpu_claim_invalid",
            resource_id=resource_id if isinstance(resource_id, str) else None,
            global_mode=config.gpu_arbiter_mode.value,
            desired_mode="off",
            effective_mode="off",
        )

    resource = config.gpu_arbiter_resources.get(resource_id)
    if resource is None:
        if config.gpu_arbiter_mode is not GPUArbiterMode.OBSERVE:
            return None
        return _shadow_reject_for_claim(
            requester,
            operation=operation,
            reason="gpu_resource_unknown_or_invalid",
            resource_id=resource_id,
            global_mode=config.gpu_arbiter_mode.value,
            desired_mode="off",
            effective_mode="off",
        )

    desired = config.gpu_arbiter_desired_mode(resource_id)
    effective = effective_gpu_arbiter_mode(resource_id, config=config)
    if effective is not GPUArbiterMode.OBSERVE:
        return None
    if budget > resource.allocatable_mb:
        return _shadow_reject_for_claim(
            requester,
            operation=operation,
            reason="vram_budget_exceeds_allocatable",
            resource_id=resource_id,
            global_mode=config.gpu_arbiter_mode.value,
            desired_mode=desired.value,
            effective_mode=effective.value,
            allocatable_mb=resource.allocatable_mb,
        )

    rows_by_id: dict[str, Any] = {
        str(getattr(backend, "id", "")): backend
        for backend in backends
        if getattr(backend, "gpu_resource_id", None) == resource_id
    }
    requester_id = str(getattr(requester, "id", ""))
    rows_by_id[requester_id] = requester
    committed = 0
    uncertain: set[str] = set()
    loaded_by_id: dict[str, bool | None] = {}
    trusted_meta_by_id: dict[str, Mapping[str, Any]] = {}

    for backend_id, backend in rows_by_id.items():
        peer_budget = getattr(backend, "vram_budget_mb", None)
        if (
            isinstance(peer_budget, bool)
            or not isinstance(peer_budget, int)
            or peer_budget <= 0
        ):
            uncertain.add(backend_id)
            continue
        trusted = _health_evidence_is_trusted(backend, now=now)
        health_meta = _trusted_health_meta(backend, now=now)
        loaded = strict_gpu_loaded_evidence(health_meta) if trusted else None
        trusted_meta_by_id[backend_id] = health_meta
        loaded_by_id[backend_id] = loaded
        if loaded is not False:
            committed += peer_budget
        if loaded is None:
            uncertain.add(backend_id)

    requester_loaded = loaded_by_id.get(requester_id)
    requested_increment = budget if requester_loaded is False else 0
    projected = committed + requested_increment
    shortfall = max(0, projected - resource.allocatable_mb)

    base = dict(
        operation=operation,
        backend_id=requester_id,
        resource_id=resource_id,
        global_mode=config.gpu_arbiter_mode.value,
        desired_mode=desired.value,
        effective_mode=effective.value,
        allocatable_mb=resource.allocatable_mb,
        committed_before_mb=committed,
        requested_increment_mb=requested_increment,
        projected_mb=projected,
        shortfall_mb=shortfall,
        uncertain_backend_ids=tuple(sorted(uncertain)),
    )
    if shortfall == 0:
        reason = (
            "requester_already_or_conservatively_committed"
            if requested_increment == 0
            else "capacity_available"
        )
        return GPUShadowDecision(
            decision="would-admit",
            reason=reason,
            **base,
        )

    requester_priority = getattr(requester, "eviction_priority", 0)
    if isinstance(requester_priority, bool) or not isinstance(requester_priority, int):
        requester_priority = 0
    candidates = []
    for backend_id, backend in rows_by_id.items():
        if backend_id == requester_id or loaded_by_id.get(backend_id) is not True:
            continue
        candidate = _safe_shadow_candidate(
            backend,
            trusted_meta_by_id.get(backend_id, {}),
            resource_id=resource_id,
            requester_priority=requester_priority,
        )
        if candidate is not None:
            candidates.append(candidate)
    candidates.sort(key=lambda item: (item.eviction_priority, item.backend_id))
    candidate_tuple = tuple(candidates)
    candidate_capacity = sum(item.vram_budget_mb for item in candidates)
    if candidate_capacity >= shortfall:
        return GPUShadowDecision(
            decision="would-evict",
            reason="eligible_candidate_capacity_sufficient",
            candidates=candidate_tuple,
            **base,
        )
    return GPUShadowDecision(
        decision="would-reject",
        reason="capacity_or_trusted_candidate_unavailable",
        candidates=candidate_tuple,
        **base,
    )


async def record_gpu_shadow_dispatch(
    backend_id: str,
    operation: str,
    session_factory: GPUShadowSessionFactory,
    *,
    config: Settings = settings,
) -> GPUShadowDecision | None:
    """Read a short-lived snapshot and emit a fail-open structured observation."""

    if config.gpu_arbiter_mode is GPUArbiterMode.OFF:
        return None
    async with session_factory() as db:
        try:
            registry_id = uuid.UUID(backend_id)
        except (TypeError, ValueError):
            return None
        requester = await db.get(MLBackendRegistry, registry_id)
        if requester is None:
            return None
        if not gpu_shadow_observation_enabled(requester.gpu_resource_id, config=config):
            return None
        if operation == "unload":
            logger.info(
                "gpu_arbiter_shadow_unload",
                gpu_arbiter={
                    "operation": operation,
                    "backend_id": backend_id,
                    "resource_id": requester.gpu_resource_id,
                    "authoritative": False,
                    "releases_allocation": False,
                    "reason": "legacy_unload_is_not_release_evidence",
                },
            )
            return None
        resource_id = requester.gpu_resource_id
        if isinstance(resource_id, str) and resource_id in config.gpu_arbiter_resources:
            peers = list(
                (
                    await db.execute(
                        select(MLBackendRegistry).where(
                            MLBackendRegistry.gpu_resource_id == resource_id
                        )
                    )
                )
                .scalars()
                .all()
            )
        else:
            # CPU、无 claim 与未知资源的结论只依赖 requester，避免扫描所有 NULL claim。
            peers = [requester]
        decision = evaluate_gpu_shadow_decision(
            requester,
            peers,
            operation=operation,
            config=config,
        )
    if decision is not None:
        logger.info(
            "gpu_arbiter_shadow_decision",
            gpu_arbiter=asdict(decision),
        )
    return decision


def record_unregistered_gpu_shadow_dispatch(
    url: str, operation: str, *, config: Settings = settings
) -> None:
    """Expose a smoke-test bypass without pretending it has a managed claim."""

    if config.gpu_arbiter_mode is not GPUArbiterMode.OBSERVE:
        return
    if operation == "unload":
        logger.warning(
            "gpu_arbiter_shadow_unregistered_unload",
            gpu_arbiter={
                "reason": "unmanaged_unregistered_target",
                "operation": operation,
                "url": url,
                "resource_id": None,
                "authoritative": False,
                "releases_allocation": False,
                "business_request_blocked": False,
            },
        )
        return
    logger.warning(
        "gpu_arbiter_shadow_unregistered_dispatch",
        gpu_arbiter={
            "decision": "would-reject",
            "reason": "unmanaged_unregistered_target",
            "operation": operation,
            "url": url,
            "resource_id": None,
            "authoritative": False,
            "business_request_blocked": False,
        },
    )


def _identity_diagnostic(
    backend: Any,
    physical_token: str,
    health_meta: Mapping[str, Any],
) -> GPUConfigDiagnostic | None:
    gpu_info = _as_mapping(health_meta.get("gpu_info"))
    observed: str | int | None = None
    expected: str | int = physical_token
    if physical_token.startswith("MIG-"):
        observed = gpu_info.get("mig_uuid") or gpu_info.get("physical_device_token")
    elif physical_token.startswith("GPU-"):
        observed = gpu_info.get("device_uuid") or gpu_info.get("physical_device_token")
    elif physical_token.startswith("index:"):
        try:
            expected = int(physical_token.removeprefix("index:"))
        except ValueError:
            return None
        observed = gpu_info.get("device_index")
    if observed is None:
        return _diag(
            "gpu_identity_unverified",
            "warning",
            f"backend 尚未上报可与 {physical_token} 对账的物理设备标识",
            field="gpu_resource_id",
            resource_id=getattr(backend, "gpu_resource_id", None),
            backend_id=getattr(backend, "id", None),
        )
    if observed == expected:
        return None
    return _diag(
        "gpu_identity_mismatch",
        "blocker",
        f"观测到的物理设备 {observed} 与声明 {physical_token} 不一致",
        field="gpu_resource_id",
        resource_id=getattr(backend, "gpu_resource_id", None),
        backend_id=getattr(backend, "id", None),
    )


def build_backend_gpu_config_status(
    backend: Any,
    totals: dict[str, int],
    *,
    config: Settings = settings,
) -> GPUBackendConfigStatus:
    resource_id = getattr(backend, "gpu_resource_id", None)
    budget = getattr(backend, "vram_budget_mb", None)
    backend_id = getattr(backend, "id", None)
    diagnostics = _claim_shape_diagnostics(resource_id, budget, backend_id=backend_id)
    allocatable: int | None = None
    desired_mode = config.gpu_arbiter_desired_mode(resource_id or "").value
    effective_mode = (
        effective_gpu_arbiter_mode(resource_id, config=config).value
        if resource_id
        else GPUArbiterMode.OFF.value
    )
    health_meta = _trusted_health_meta(backend)
    requires_gpu_claim = _requires_gpu_claim(health_meta)

    if resource_id is None and budget is None:
        if requires_gpu_claim:
            diagnostics.append(
                _diag(
                    "gpu_claim_missing",
                    "blocker",
                    "backend 配置使用 GPU，但尚未声明物理资源与显存预算",
                    field="gpu_resource_id",
                    backend_id=backend_id,
                )
            )
        elif _is_explicit_cpu_backend(
            health_meta, requires_gpu_claim=requires_gpu_claim
        ):
            diagnostics.append(
                _diag(
                    "explicit_cpu_backend",
                    "info",
                    "backend 显式配置为 CPU，无需声明 GPU 资源",
                    field="gpu_resource_id",
                    backend_id=backend_id,
                )
            )
        else:
            diagnostics.append(
                _diag(
                    "gpu_claim_unknown",
                    "blocker",
                    "backend 未显式证明为 CPU，必须声明 GPU 资源或先完成设备探测",
                    field="gpu_resource_id",
                    backend_id=backend_id,
                )
            )
    elif resource_id is not None and not diagnostics:
        resource = config.gpu_arbiter_resources.get(resource_id)
        if config.gpu_arbiter_config_errors:
            diagnostics.append(
                _diag(
                    "gpu_resources_config_invalid",
                    "blocker",
                    "GPU_ARBITER_RESOURCES_JSON 无法解析："
                    f"{config.gpu_arbiter_config_errors[0]}",
                    field="gpu_resource_id",
                    resource_id=resource_id,
                    backend_id=backend_id,
                )
            )
        elif resource is None:
            diagnostics.append(
                _diag(
                    "gpu_resource_unknown",
                    "blocker",
                    f"未在 GPU_ARBITER_RESOURCES_JSON 中找到 {resource_id}",
                    field="gpu_resource_id",
                    resource_id=resource_id,
                    backend_id=backend_id,
                )
            )
        else:
            allocatable = resource.allocatable_mb
            if budget is not None and budget > allocatable:
                diagnostics.append(
                    _diag(
                        "vram_budget_exceeds_allocatable",
                        "blocker",
                        f"预算 {budget} MiB 超过该资源可分配容量 {allocatable} MiB",
                        field="vram_budget_mb",
                        resource_id=resource_id,
                        backend_id=backend_id,
                    )
                )
            elif totals.get(resource_id, 0) > allocatable:
                diagnostics.append(
                    _diag(
                        "gpu_resource_oversubscribed",
                        "warning",
                        f"同卡静态预算合计 {totals[resource_id]} MiB 超过可分配容量 "
                        f"{allocatable} MiB；这是允许驱逐的弹性超售",
                        resource_id=resource_id,
                        backend_id=backend_id,
                    )
                )
            identity = _identity_diagnostic(
                backend, resource.physical_device_token, health_meta
            )
            if identity is not None:
                diagnostics.append(identity)
            if desired_mode == "enforce":
                diagnostics.append(
                    _diag(
                        "gpu_arbiter_runtime_not_ready",
                        "blocker",
                        "GPU 仲裁期望模式为 enforce，但账本与 gate 握手尚未就绪；"
                        "实际模式保持 off",
                        resource_id=resource_id,
                        backend_id=backend_id,
                    )
                )

    status = "ok"
    for diagnostic in diagnostics:
        if _LEVEL_ORDER[diagnostic.level] > _LEVEL_ORDER[status]:
            status = diagnostic.level
    return GPUBackendConfigStatus(
        status=status,
        desired_mode=desired_mode,
        effective_mode=effective_mode,
        allocatable_mb=allocatable,
        resource_claimed_budget_mb=totals.get(resource_id) if resource_id else None,
        diagnostics=diagnostics,
    )


def build_resource_summaries(
    backends: Iterable[Any], *, config: Settings = settings
) -> tuple[list[dict[str, Any]], list[GPUConfigDiagnostic]]:
    backend_rows = list(backends)
    totals = claimed_budget_by_resource(backend_rows)
    claim_counts: dict[str, int] = defaultdict(int)
    for backend in backend_rows:
        resource_id = getattr(backend, "gpu_resource_id", None)
        if resource_id:
            claim_counts[resource_id] += 1

    summaries: list[dict[str, Any]] = []
    diagnostics: list[GPUConfigDiagnostic] = [
        _diag(
            "gpu_resources_config_invalid",
            "blocker",
            f"GPU_ARBITER_RESOURCES_JSON 无法解析：{error}",
            field="gpu_arbiter_resources_json",
        )
        for error in config.gpu_arbiter_config_errors
    ]
    for resource_id, resource in sorted(config.gpu_arbiter_resources.items()):
        resource_diagnostics: list[GPUConfigDiagnostic] = []
        total = totals.get(resource_id, 0)
        if total > resource.allocatable_mb:
            resource_diagnostics.append(
                _diag(
                    "gpu_resource_oversubscribed",
                    "warning",
                    f"静态预算合计 {total} MiB 超过可分配容量 "
                    f"{resource.allocatable_mb} MiB",
                    resource_id=resource_id,
                )
            )
        if config.gpu_arbiter_mode.value != "off" and resource.mode is None:
            resource_diagnostics.append(
                _diag(
                    "gpu_resource_mode_missing",
                    "info",
                    "资源未显式声明 mode，有效模式安全保持 off",
                    resource_id=resource_id,
                )
            )
        desired_mode = config.gpu_arbiter_desired_mode(resource_id).value
        effective_mode = effective_gpu_arbiter_mode(resource_id, config=config).value
        if desired_mode == "enforce":
            resource_diagnostics.append(
                _diag(
                    "gpu_arbiter_runtime_not_ready",
                    "blocker",
                    "GPU 仲裁期望模式为 enforce，但账本与 gate 握手尚未就绪；"
                    "实际模式保持 off",
                    resource_id=resource_id,
                )
            )
        status = "ok"
        for diagnostic in resource_diagnostics:
            if _LEVEL_ORDER[diagnostic.level] > _LEVEL_ORDER[status]:
                status = diagnostic.level
        diagnostics.extend(resource_diagnostics)
        summaries.append(
            {
                "gpu_resource_id": resource_id,
                "node_id": resource.node_id,
                "physical_device_token": resource.physical_device_token,
                "allocatable_mb": resource.allocatable_mb,
                "configured_mode": resource.mode.value if resource.mode else None,
                "desired_mode": desired_mode,
                "effective_mode": effective_mode,
                "claimed_budget_mb": total,
                "claimed_backend_count": claim_counts.get(resource_id, 0),
                "status": status,
                "diagnostics": resource_diagnostics,
            }
        )

    for backend in backend_rows:
        status = build_backend_gpu_config_status(backend, totals, config=config)
        diagnostics.extend(
            diagnostic
            for diagnostic in status.diagnostics
            if diagnostic.code != "gpu_resource_oversubscribed"
        )
    return summaries, diagnostics
