"""ADR-0049 GPU claims, durable fences, proof recovery, and shadow arbitration.

P2b evaluates non-authoritative ``would-*`` decisions from a fresh DB snapshot;
P3a/P3c add durable fencing, exact membership, token-expiry high-water marks, and
the database-locked consumer for Redis proof reset.  Backend network probes remain
outside every database lock in this module.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import asdict, dataclass, field as dataclass_field
from datetime import UTC, datetime, timedelta
from enum import Enum
import hashlib
import ipaddress
import json
import posixpath
import re
import secrets
import socket
from typing import Any, Literal, NoReturn
import uuid

import httpx
import structlog
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    managed_lifecycle_capability_sha256,
    validate_canonical_positive_int64,
)
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import GPUArbiterMode, Settings, settings
from app.db.models.gpu_backend_cancel_intent import GPUBackendCancelIntent
from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.gpu_arbiter_rollout import GPUArbiterRollout
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.schemas.ml_backend import GPUBackendConfigStatus, GPUConfigDiagnostic
from app.services.gpu_arbitration.ledger import (
    GPU_EVICTION_OPERATION,
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
_SHA256_HEX_RE = re.compile(r"[0-9a-f]{64}\Z")
_MAX_POSITIVE_INT64 = 9_223_372_036_854_775_807
GPU_LEGACY_MODE_TOKEN_TTL_SECONDS = 30

GPUShadowSessionFactory = Callable[[], AsyncSession]
GPUFenceSessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]
GPUReadinessDemoter = Callable[[str], Awaitable[None]]
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


def gpu_arbiter_failure_record(exc: BaseException) -> dict[str, Any] | None:
    """Return the stable JSON-safe worker record for an arbitration rejection."""

    if not isinstance(exc, GPUArbiterDispatchError):
        return None
    message = exc.detail.get("message")
    if not isinstance(message, str) or not message:
        message = exc.error_code
    return {
        "error_code": exc.error_code,
        "status_code": exc.status_code,
        "retry_after_s": exc.retry_after_s,
        "message": message,
    }


def summarize_gpu_arbiter_failures(
    failures: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Aggregate dispatch attempts by stable code into a bounded job summary."""

    buckets: dict[str, dict[str, Any]] = {}
    for failure in failures:
        error_code = failure.get("error_code")
        if not isinstance(error_code, str) or not error_code:
            continue
        count = failure.get("count", 1)
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            count = 1
        retry_after_s = failure.get("retry_after_s")
        bucket = buckets.setdefault(
            error_code,
            {
                "error_code": error_code,
                "status_code": failure.get("status_code"),
                "retry_after_s": retry_after_s,
                "count": 0,
            },
        )
        bucket["count"] += count
        if isinstance(retry_after_s, int) and not isinstance(retry_after_s, bool):
            current = bucket["retry_after_s"]
            if current is None or retry_after_s > current:
                bucket["retry_after_s"] = retry_after_s
    return [buckets[error_code] for error_code in sorted(buckets)]


GPUDispatchOperation = Literal[
    "predict",
    "predict_interactive",
    "warmup",
    "reload",
    "unload",
]
GPUDispatchOutcomeKind = Literal["response_received", "uncertain"]
GPUDispatchUncertainReason = Literal["request_aborted", "response_not_reported"]


@dataclass(frozen=True)
class GPUDispatchRequest:
    """Exact client metadata passed to the authoritative dispatch context."""

    backend_id: str
    gpu_resource_id: str
    operation: GPUDispatchOperation
    scope: AdmissionScope


@dataclass(frozen=True)
class GPUDispatchOutcome:
    """One explicit transport outcome; it is not a residency assertion."""

    kind: GPUDispatchOutcomeKind
    status_code: int | None = None
    reason: GPUDispatchUncertainReason | None = None


class GPUDispatchOutcomeChannel:
    """Mutable one-shot outcome channel owned by an immutable dispatch grant."""

    def __init__(self) -> None:
        self._outcome: GPUDispatchOutcome | None = None

    @property
    def outcome(self) -> GPUDispatchOutcome | None:
        return self._outcome

    def report_response(self, status_code: int) -> bool:
        if (
            not isinstance(status_code, int)
            or isinstance(status_code, bool)
            or not 100 <= status_code <= 599
        ):
            raise ValueError("status_code must be a valid HTTP status")
        if self._outcome is not None:
            return False
        self._outcome = GPUDispatchOutcome(
            kind="response_received",
            status_code=status_code,
        )
        return True

    def report_uncertain_if_missing(
        self,
        reason: GPUDispatchUncertainReason,
    ) -> bool:
        if self._outcome is not None:
            return False
        self._outcome = GPUDispatchOutcome(kind="uncertain", reason=reason)
        return True


@dataclass(frozen=True)
class GPUDispatchGrant:
    """Managed lifecycle headers produced after authoritative admission."""

    generation: str
    admission_token: str
    outcome_channel: GPUDispatchOutcomeChannel = dataclass_field(
        default_factory=GPUDispatchOutcomeChannel,
        init=False,
        repr=False,
        compare=False,
    )

    def __post_init__(self) -> None:
        validate_canonical_positive_int64(self.generation)
        if (
            not self.admission_token
            or self.admission_token.strip() != self.admission_token
        ):
            raise ValueError("admission_token must be non-empty and canonical")

    @property
    def outcome(self) -> GPUDispatchOutcome | None:
        return self.outcome_channel.outcome

    def report_response(self, status_code: int) -> bool:
        return self.outcome_channel.report_response(status_code)

    def report_uncertain_if_missing(
        self,
        reason: GPUDispatchUncertainReason,
    ) -> bool:
        return self.outcome_channel.report_uncertain_if_missing(reason)


GPUDispatchContextFactory = Callable[
    [GPUDispatchRequest], AbstractAsyncContextManager[GPUDispatchGrant]
]


class GPUFenceExhaustedError(RuntimeError):
    """A durable positive-int64 fencing sequence cannot advance safely."""


class GPUFenceMembershipError(RuntimeError):
    """Fence issuance did not match one active durable resource membership."""


class GPULegacyAckBlockedError(RuntimeError):
    """Cached evidence cannot authorize a legacy-mode membership handshake."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class GPUResidentRuntimeSubjectError(RuntimeError):
    """Durable/runtime evidence cannot authorize one Resident-only workload."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class GPUColdRuntimeSubjectError(RuntimeError):
    """Durable/runtime evidence cannot authorize one cold workload generation."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class GPUIdleEvictionRuntimeSubjectError(RuntimeError):
    """Durable/runtime evidence cannot authorize one idle victim eviction."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class GPUBusyEvictionRuntimeSubjectError(RuntimeError):
    """Durable/runtime evidence cannot authorize one busy-capable victim."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class GPUEvictionCancelRuntimeSubjectError(RuntimeError):
    """Durable state cannot authorize one exact busy-drain cancellation."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class GPULegacyAckPreparation:
    """Durable result returned before signing one boot-scoped mode capability."""

    action: Literal["issue", "acknowledged"]
    backend: MLBackendRegistry = dataclass_field(repr=False)
    backend_id: uuid.UUID
    resource_id: str
    membership_epoch: int
    boot_id: str
    runtime_epoch: str
    control_epoch: str
    token_expires_at: datetime | None
    proof_ready: bool


GPURolloutControlOperation = Literal["reset", "mode_enforce", "mode_legacy"]


class GPURolloutControlBlockedError(RuntimeError):
    """Fresh durable/runtime evidence cannot advance one rollout control step."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class GPURolloutControlPreparation:
    """Exact reset/mode intent returned before signing or backend HTTP."""

    action: Literal["issue", "acknowledged", "awaiting_health"]
    operation: GPURolloutControlOperation
    target_gate: Literal["legacy", "enforce"]
    backend: MLBackendRegistry = dataclass_field(repr=False)
    backend_id: uuid.UUID
    resource_id: str
    membership_epoch: int
    transition_id: uuid.UUID
    boot_id: str
    control_epoch: str
    token_expires_at: datetime
    reason: str


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
    managed_lifecycle_sha256: str | None


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
    pool_ids: tuple[str, ...]
    pool_residencies: tuple[bool | None, ...]
    boot_id: str
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


@dataclass(frozen=True)
class GPUResidentRuntimeSubject:
    """Exact durable and live identity used for one Resident-only admission."""

    backend_registry_id: uuid.UUID
    gpu_resource_id: str
    membership_epoch: int
    budget_mb: int
    eviction_priority: int
    max_concurrency: int
    boot_id: str
    generation: str
    control_epoch: str
    runtime_epoch: str
    db_now: datetime


@dataclass(frozen=True)
class GPUColdRuntimeSubject:
    """Exact idle-unloaded identity used to reserve one new GPU generation."""

    backend_registry_id: uuid.UUID
    gpu_resource_id: str
    membership_epoch: int
    budget_mb: int
    eviction_priority: int
    max_concurrency: int
    boot_id: str
    observed_generation: str | None
    generation_high_water: int
    control_epoch: str
    runtime_epoch: str
    db_now: datetime


@dataclass(frozen=True)
class GPUPreparedColdRuntimeSubject:
    """Cold subject whose new generation and token horizon are durable."""

    backend_registry_id: uuid.UUID
    gpu_resource_id: str
    membership_epoch: int
    budget_mb: int
    eviction_priority: int
    max_concurrency: int
    boot_id: str
    observed_generation: str | None
    generation: str
    control_epoch: str
    runtime_epoch: str
    token_expires_at: datetime
    db_now: datetime


@dataclass(frozen=True)
class GPUIdleEvictionRuntimeSubject:
    """Exact Resident identity eligible for one idle or busy eviction."""

    backend: MLBackendRegistry = dataclass_field(repr=False, compare=False)
    backend_registry_id: uuid.UUID
    gpu_resource_id: str
    membership_epoch: int
    budget_mb: int
    eviction_priority: int
    max_concurrency: int
    boot_id: str
    generation: str
    generation_high_water: int
    pool_ids: tuple[str, ...]
    control_epoch: str
    runtime_epoch: str
    challenge: str
    require_idle: bool
    db_now: datetime


@dataclass(frozen=True)
class GPUPreparedIdleEvictionRuntimeSubject:
    """Victim whose drain generation and token horizon are durable."""

    backend: MLBackendRegistry = dataclass_field(repr=False, compare=False)
    backend_registry_id: uuid.UUID
    gpu_resource_id: str
    membership_epoch: int
    budget_mb: int
    eviction_priority: int
    max_concurrency: int
    boot_id: str
    source_generation: str
    generation: str
    pool_ids: tuple[str, ...]
    control_epoch: str
    runtime_epoch: str
    token_expires_at: datetime
    require_idle: bool
    db_now: datetime


@dataclass(frozen=True)
class GPUPreparedEvictionCancelRuntimeSubject:
    """Exact newer generation durably reserved for one drain cancellation."""

    backend: MLBackendRegistry = dataclass_field(repr=False, compare=False)
    backend_registry_id: uuid.UUID
    gpu_resource_id: str
    membership_epoch: int
    budget_mb: int
    eviction_priority: int
    max_concurrency: int
    boot_id: str
    source_generation: str
    drain_generation: str
    generation: str
    pool_ids: tuple[str, ...]
    control_epoch: str
    runtime_epoch: str
    owner_id: str
    operation: str
    owner_hard_deadline_ms: int
    drain_token_expires_at: datetime
    token_expires_at: datetime
    jti: str
    idempotent: bool
    db_now: datetime


@dataclass(frozen=True)
class GPUColdTerminalCommitResult:
    """Result of classifying and committing one exposed cold generation."""

    status: Literal["finalized", "stale", "rejected"]
    state: GPUAllocationState
    reason: str
    idempotent: bool = False


@dataclass(frozen=True)
class GPUEvictionCommitResult:
    """Result of committing one health-proven eviction phase."""

    status: Literal["finalized", "stale", "rejected"]
    state: GPUAllocationState
    reason: str
    idempotent: bool = False


@dataclass(frozen=True)
class GPUEvictionDrainHealth:
    """Trusted read-only classification of one exact draining residency."""

    status: Literal["draining_busy", "ready_to_unload", "uncertain"]
    reason: str
    active_requests: int | None = None
    builders: int | None = None
    borrowers: int | None = None


_GPU_PROBE_KEYS = frozenset(
    {
        "protocol_version",
        "challenge",
        "backend_registry_id",
        "gpu_resource_id",
        "membership_epoch",
        "membership_state",
        "managed_lifecycle_sha256",
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
    managed_lifecycle_sha256 = value["managed_lifecycle_sha256"]
    if managed_lifecycle_sha256 is not None and (
        type(managed_lifecycle_sha256) is not str
        or _SHA256_HEX_RE.fullmatch(managed_lifecycle_sha256) is None
    ):
        raise _GPUProofInvalid("probe_managed_lifecycle_sha256_invalid")
    probe_started_at = _parse_canonical_proof_timestamp(value["probe_started_at"])
    observed_at = _parse_canonical_proof_timestamp(value["observed_at"])
    if probe_started_at >= observed_at:
        raise _GPUProofInvalid("probe_clock_order_invalid")
    return _GPUProofProbe(
        raw=dict(value),
        probe_started_at=probe_started_at,
        observed_at=observed_at,
        managed_lifecycle_sha256=managed_lifecycle_sha256,
    )


def _health_managed_lifecycle_sha256(raw_health: Any) -> str | None:
    if type(raw_health) is not dict:
        return None
    raw_capabilities = raw_health.get("capabilities")
    if raw_capabilities is None:
        return None
    if type(raw_capabilities) is not dict:
        raise _GPUProofInvalid("managed_lifecycle_capabilities_invalid")
    raw_managed_lifecycle = raw_capabilities.get("managed_lifecycle")
    if raw_managed_lifecycle is None:
        return None
    try:
        return managed_lifecycle_capability_sha256(raw_managed_lifecycle)
    except (TypeError, ValueError) as exc:
        raise _GPUProofInvalid("managed_lifecycle_capability_invalid") from exc


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
        pool_ids=tuple(sorted(pools)),
        pool_residencies=tuple(pool_residencies),
        boot_id=boot_id,
        lifecycle_gate=lifecycle_gate,
        control_epoch=control_epoch,
        identity=identity,
    )


def _validate_gpu_resident_runtime_subject(
    membership: GPUBackendMembership,
    fence: GPUBackendFence,
    registry: MLBackendRegistry,
    *,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> GPUResidentRuntimeSubject:
    membership_epoch = _strict_nonnegative_int64(
        membership.membership_epoch,
        reason="membership_epoch_invalid",
    )
    if membership.state != "active" or membership_epoch == 0:
        raise _GPUProofInvalid("membership_not_active")
    generation_high_water = _strict_nonnegative_int64(
        fence.generation_high_water,
        reason="generation_high_water_invalid",
    )
    control_epoch_high_water = _strict_nonnegative_int64(
        fence.control_epoch_high_water,
        reason="control_epoch_high_water_invalid",
    )
    runtime_epoch_high_water = _strict_nonnegative_int64(
        fence.runtime_epoch_high_water,
        reason="runtime_epoch_high_water_invalid",
    )
    runtime_epoch_baseline = _strict_nonnegative_int64(
        membership.runtime_epoch_baseline,
        reason="runtime_epoch_baseline_invalid",
    )
    if runtime_epoch_high_water <= runtime_epoch_baseline:
        raise _GPUProofInvalid("active_runtime_epoch_invalid")
    horizon = fence.token_expiry_high_water
    if horizon is None:
        raise _GPUProofInvalid("token_horizon_missing")
    if horizon.tzinfo is None or horizon.utcoffset() is None:
        raise _GPUProofInvalid("token_horizon_invalid")

    if (
        registry.state != "connected"
        or registry.gpu_resource_id != membership.gpu_resource_id
        or registry.vram_budget_mb != membership.vram_budget_mb
        or registry.eviction_priority != membership.eviction_priority
        or _registry_gpu_max_concurrency(registry.extra_params)
        != membership.max_concurrency
    ):
        raise _GPUProofInvalid("registry_claim_mismatch")

    raw_health = registry.health_meta
    raw_probe = (
        raw_health.get("gpu_arbiter_probe") if type(raw_health) is dict else None
    )
    raw_residency = raw_health.get("residency") if type(raw_health) is dict else None
    probe = _parse_gpu_proof_probe(raw_probe)
    capability_sha256 = _health_managed_lifecycle_sha256(raw_health)
    if (
        capability_sha256 is None
        or probe.managed_lifecycle_sha256 is None
        or capability_sha256 != probe.managed_lifecycle_sha256
    ):
        raise _GPUProofInvalid("managed_lifecycle_capability_mismatch")
    if (
        probe.raw["backend_registry_id"] != str(membership.backend_registry_id)
        or probe.raw["gpu_resource_id"] != membership.gpu_resource_id
        or probe.raw["membership_epoch"] != str(membership_epoch)
        or probe.raw["membership_state"] != "active"
    ):
        raise _GPUProofInvalid("probe_membership_mismatch")
    if (
        registry.last_checked_at is None
        or registry.last_checked_at.tzinfo is None
        or registry.last_checked_at.utcoffset() is None
        or registry.last_checked_at.astimezone(UTC) != probe.observed_at
    ):
        raise _GPUProofInvalid("probe_registry_clock_mismatch")
    db_now_utc = db_now.astimezone(UTC)
    if probe.observed_at > db_now_utc:
        raise _GPUProofInvalid("probe_from_future")
    if db_now_utc - probe.observed_at > evidence_ttl:
        raise _GPUProofInvalid("probe_expired")

    residency = _parse_gpu_proof_residency(raw_residency)
    identity = residency.identity
    if (
        residency.state != "resident"
        or residency.gpu_loaded is not True
        or residency.lifecycle_gate != "enforce"
        or residency.draining
        or residency.generation is None
        or residency.control_epoch is None
        or identity is None
        or any(item is None for item in residency.pool_residencies)
        or not any(item is True for item in residency.pool_residencies)
    ):
        raise _GPUProofInvalid("resident_runtime_not_ready")
    if (
        identity["backend_registry_id"] != str(membership.backend_registry_id)
        or identity["gpu_resource_id"] != membership.gpu_resource_id
    ):
        raise _GPUProofInvalid("residency_identity_mismatch")
    if int(residency.generation) > generation_high_water:
        raise _GPUProofInvalid("residency_generation_ahead")
    if int(residency.control_epoch) != control_epoch_high_water:
        raise _GPUProofInvalid("residency_control_epoch_mismatch")

    return GPUResidentRuntimeSubject(
        backend_registry_id=membership.backend_registry_id,
        gpu_resource_id=membership.gpu_resource_id,
        membership_epoch=membership_epoch,
        budget_mb=membership.vram_budget_mb,
        eviction_priority=membership.eviction_priority,
        max_concurrency=membership.max_concurrency,
        boot_id=residency.boot_id,
        generation=residency.generation,
        control_epoch=residency.control_epoch,
        runtime_epoch=str(runtime_epoch_high_water),
        db_now=db_now,
    )


def _validate_gpu_idle_eviction_runtime_subject(
    membership: GPUBackendMembership,
    fence: GPUBackendFence,
    registry: MLBackendRegistry,
    *,
    db_now: datetime,
    evidence_ttl: timedelta,
    expected_generation: str,
    challenge: str,
    require_idle: bool = True,
) -> GPUIdleEvictionRuntimeSubject:
    resident = _validate_gpu_resident_runtime_subject(
        membership,
        fence,
        registry,
        db_now=db_now,
        evidence_ttl=evidence_ttl,
    )
    raw_health = registry.health_meta
    raw_probe = (
        raw_health.get("gpu_arbiter_probe") if type(raw_health) is dict else None
    )
    raw_residency = raw_health.get("residency") if type(raw_health) is dict else None
    probe = _parse_gpu_proof_probe(raw_probe)
    residency = _parse_gpu_proof_residency(raw_residency)
    reason_prefix = "idle_eviction" if require_idle else "busy_eviction"
    if probe.raw["challenge"] != challenge:
        raise _GPUProofInvalid(f"{reason_prefix}_challenge_mismatch")
    if residency.generation != expected_generation:
        raise _GPUProofInvalid(f"{reason_prefix}_generation_mismatch")
    if not residency.evictable or (
        require_idle
        and (
            residency.active_requests != 0
            or residency.builders != 0
            or residency.borrowers != 0
        )
    ):
        raise _GPUProofInvalid(f"{reason_prefix}_runtime_not_ready")
    generation_high_water = _strict_nonnegative_int64(
        fence.generation_high_water,
        reason="generation_high_water_invalid",
    )
    return GPUIdleEvictionRuntimeSubject(
        backend=_snapshot_gpu_mode_backend(registry),
        backend_registry_id=resident.backend_registry_id,
        gpu_resource_id=resident.gpu_resource_id,
        membership_epoch=resident.membership_epoch,
        budget_mb=resident.budget_mb,
        eviction_priority=resident.eviction_priority,
        max_concurrency=resident.max_concurrency,
        boot_id=resident.boot_id,
        generation=resident.generation,
        generation_high_water=generation_high_water,
        pool_ids=residency.pool_ids,
        control_epoch=resident.control_epoch,
        runtime_epoch=resident.runtime_epoch,
        challenge=challenge,
        require_idle=require_idle,
        db_now=resident.db_now,
    )


def _runtime_subject_identity(subject: GPUResidentRuntimeSubject) -> tuple[Any, ...]:
    return (
        subject.backend_registry_id,
        subject.gpu_resource_id,
        subject.membership_epoch,
        subject.budget_mb,
        subject.eviction_priority,
        subject.max_concurrency,
        subject.boot_id,
        subject.generation,
        subject.control_epoch,
        subject.runtime_epoch,
    )


def _idle_eviction_runtime_subject_identity(
    subject: GPUIdleEvictionRuntimeSubject,
) -> tuple[Any, ...]:
    return (
        subject.backend_registry_id,
        subject.backend.url,
        subject.backend.auth_method,
        subject.backend.auth_token,
        subject.gpu_resource_id,
        subject.membership_epoch,
        subject.budget_mb,
        subject.eviction_priority,
        subject.max_concurrency,
        subject.boot_id,
        subject.generation,
        subject.generation_high_water,
        subject.pool_ids,
        subject.control_epoch,
        subject.runtime_epoch,
        subject.challenge,
        subject.require_idle,
    )


def _validate_gpu_cold_runtime_subject(
    membership: GPUBackendMembership,
    fence: GPUBackendFence,
    registry: MLBackendRegistry,
    *,
    db_now: datetime,
    evidence_ttl: timedelta,
    expected_challenge: str | None = None,
) -> GPUColdRuntimeSubject:
    membership_epoch = _strict_nonnegative_int64(
        membership.membership_epoch,
        reason="membership_epoch_invalid",
    )
    if membership.state != "active" or membership_epoch == 0:
        raise _GPUProofInvalid("membership_not_active")
    generation_high_water = _strict_nonnegative_int64(
        fence.generation_high_water,
        reason="generation_high_water_invalid",
    )
    control_epoch_high_water = _strict_nonnegative_int64(
        fence.control_epoch_high_water,
        reason="control_epoch_high_water_invalid",
    )
    runtime_epoch_high_water = _strict_nonnegative_int64(
        fence.runtime_epoch_high_water,
        reason="runtime_epoch_high_water_invalid",
    )
    runtime_epoch_baseline = _strict_nonnegative_int64(
        membership.runtime_epoch_baseline,
        reason="runtime_epoch_baseline_invalid",
    )
    if runtime_epoch_high_water <= runtime_epoch_baseline:
        raise _GPUProofInvalid("active_runtime_epoch_invalid")
    horizon = fence.token_expiry_high_water
    if horizon is None:
        raise _GPUProofInvalid("token_horizon_missing")
    if horizon.tzinfo is None or horizon.utcoffset() is None:
        raise _GPUProofInvalid("token_horizon_invalid")

    if (
        registry.state != "connected"
        or registry.gpu_resource_id != membership.gpu_resource_id
        or registry.vram_budget_mb != membership.vram_budget_mb
        or registry.eviction_priority != membership.eviction_priority
        or _registry_gpu_max_concurrency(registry.extra_params)
        != membership.max_concurrency
    ):
        raise _GPUProofInvalid("registry_claim_mismatch")

    raw_health = registry.health_meta
    raw_probe = (
        raw_health.get("gpu_arbiter_probe") if type(raw_health) is dict else None
    )
    raw_residency = raw_health.get("residency") if type(raw_health) is dict else None
    probe = _parse_gpu_proof_probe(raw_probe)
    if expected_challenge is not None and probe.raw["challenge"] != expected_challenge:
        raise _GPUProofInvalid("cold_runtime_challenge_mismatch")
    capability_sha256 = _health_managed_lifecycle_sha256(raw_health)
    if (
        capability_sha256 is None
        or probe.managed_lifecycle_sha256 is None
        or capability_sha256 != probe.managed_lifecycle_sha256
    ):
        raise _GPUProofInvalid("managed_lifecycle_capability_mismatch")
    if (
        probe.raw["backend_registry_id"] != str(membership.backend_registry_id)
        or probe.raw["gpu_resource_id"] != membership.gpu_resource_id
        or probe.raw["membership_epoch"] != str(membership_epoch)
        or probe.raw["membership_state"] != "active"
    ):
        raise _GPUProofInvalid("probe_membership_mismatch")
    if (
        registry.last_checked_at is None
        or registry.last_checked_at.tzinfo is None
        or registry.last_checked_at.utcoffset() is None
        or registry.last_checked_at.astimezone(UTC) != probe.observed_at
    ):
        raise _GPUProofInvalid("probe_registry_clock_mismatch")
    db_now_utc = db_now.astimezone(UTC)
    if probe.observed_at > db_now_utc:
        raise _GPUProofInvalid("probe_from_future")
    if db_now_utc - probe.observed_at > evidence_ttl:
        raise _GPUProofInvalid("probe_expired")
    residency = _parse_gpu_proof_residency(raw_residency)
    identity = residency.identity
    if (
        residency.state not in {"unloaded", "resident"}
        or residency.gpu_loaded is not False
        or residency.lifecycle_gate != "enforce"
        or residency.draining
        or residency.evictable
        or residency.active_requests != 0
        or residency.builders != 0
        or residency.borrowers != 0
        or residency.control_epoch is None
        or identity is None
        or any(item is not False for item in residency.pool_residencies)
    ):
        raise _GPUProofInvalid("cold_runtime_not_ready")
    if (
        identity["backend_registry_id"] != str(membership.backend_registry_id)
        or identity["gpu_resource_id"] != membership.gpu_resource_id
    ):
        raise _GPUProofInvalid("residency_identity_mismatch")
    if (
        residency.generation is not None
        and int(residency.generation) > generation_high_water
    ):
        raise _GPUProofInvalid("residency_generation_ahead")
    if int(residency.control_epoch) != control_epoch_high_water:
        raise _GPUProofInvalid("residency_control_epoch_mismatch")

    return GPUColdRuntimeSubject(
        backend_registry_id=membership.backend_registry_id,
        gpu_resource_id=membership.gpu_resource_id,
        membership_epoch=membership_epoch,
        budget_mb=membership.vram_budget_mb,
        eviction_priority=membership.eviction_priority,
        max_concurrency=membership.max_concurrency,
        boot_id=residency.boot_id,
        observed_generation=residency.generation,
        generation_high_water=generation_high_water,
        control_epoch=residency.control_epoch,
        runtime_epoch=str(runtime_epoch_high_water),
        db_now=db_now,
    )


def _cold_runtime_subject_identity(subject: GPUColdRuntimeSubject) -> tuple[Any, ...]:
    return (
        subject.backend_registry_id,
        subject.gpu_resource_id,
        subject.membership_epoch,
        subject.budget_mb,
        subject.eviction_priority,
        subject.max_concurrency,
        subject.boot_id,
        subject.observed_generation,
        subject.generation_high_water,
        subject.control_epoch,
        subject.runtime_epoch,
    )


def _validate_runtime_subject_evidence_ttl(evidence_ttl: timedelta) -> None:
    if evidence_ttl <= timedelta(0) or evidence_ttl > _PROOF_RESET_MAX_WINDOW:
        raise ValueError(
            "evidence_ttl must be positive and no greater than five minutes"
        )


def _validate_runtime_subject_inputs(
    backend_id: str,
    gpu_resource_id: str,
    evidence_ttl: timedelta,
    *,
    error_type: type[GPUResidentRuntimeSubjectError]
    | type[GPUColdRuntimeSubjectError]
    | type[GPUIdleEvictionRuntimeSubjectError]
    | type[GPUBusyEvictionRuntimeSubjectError]
    | type[GPUEvictionCancelRuntimeSubjectError] = GPUResidentRuntimeSubjectError,
) -> uuid.UUID:
    try:
        backend_registry_id = uuid.UUID(backend_id)
    except (AttributeError, TypeError, ValueError) as exc:
        raise error_type("backend_identity_invalid") from exc
    if str(backend_registry_id) != backend_id:
        raise error_type("backend_identity_invalid")
    try:
        validate_gpu_resource_id(gpu_resource_id)
    except (TypeError, ValueError) as exc:
        raise error_type("gpu_resource_id_invalid") from exc
    _validate_runtime_subject_evidence_ttl(evidence_ttl)
    return backend_registry_id


async def read_gpu_resident_runtime_subject(
    db: AsyncSession,
    *,
    backend_id: str,
    gpu_resource_id: str,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUResidentRuntimeSubject:
    """Read one strict, non-idle Resident runtime subject from one MVCC snapshot."""

    backend_registry_id = _validate_runtime_subject_inputs(
        backend_id,
        gpu_resource_id,
        evidence_ttl,
    )
    row = (
        await db.execute(
            select(
                GPUBackendMembership,
                GPUBackendFence,
                MLBackendRegistry,
                func.clock_timestamp(),
            )
            .join(
                GPUBackendFence,
                GPUBackendFence.backend_registry_id
                == GPUBackendMembership.backend_registry_id,
            )
            .join(
                MLBackendRegistry,
                MLBackendRegistry.id == GPUBackendMembership.backend_registry_id,
            )
            .where(
                GPUBackendMembership.backend_registry_id == backend_registry_id,
                GPUBackendMembership.gpu_resource_id == gpu_resource_id,
                GPUBackendMembership.state == "active",
            )
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if row is None:
        raise GPUResidentRuntimeSubjectError("membership_not_active")
    membership, fence, registry, db_now = row
    if (
        not isinstance(db_now, datetime)
        or db_now.tzinfo is None
        or db_now.utcoffset() is None
    ):
        raise RuntimeError("PostgreSQL returned an invalid runtime proof clock")
    try:
        return _validate_gpu_resident_runtime_subject(
            membership,
            fence,
            registry,
            db_now=db_now,
            evidence_ttl=evidence_ttl,
        )
    except _GPUProofInvalid as exc:
        raise GPUResidentRuntimeSubjectError(exc.reason) from None


async def _read_gpu_eviction_runtime_subject(
    db: AsyncSession,
    *,
    backend_id: str,
    gpu_resource_id: str,
    expected_generation: str,
    challenge: str,
    evidence_ttl: timedelta,
    require_idle: bool,
    error_type: type[GPUIdleEvictionRuntimeSubjectError]
    | type[GPUBusyEvictionRuntimeSubjectError],
) -> GPUIdleEvictionRuntimeSubject:
    reason_prefix = "idle_eviction" if require_idle else "busy_eviction"
    backend_registry_id = _validate_runtime_subject_inputs(
        backend_id,
        gpu_resource_id,
        evidence_ttl,
        error_type=error_type,
    )
    try:
        validate_canonical_positive_int64(expected_generation)
    except (TypeError, ValueError) as exc:
        raise error_type(f"{reason_prefix}_generation_invalid") from exc
    if (
        not isinstance(challenge, str)
        or _GPU_HEALTH_CHALLENGE_RE.fullmatch(challenge) is None
    ):
        raise error_type(f"{reason_prefix}_challenge_invalid")
    row = (
        await db.execute(
            select(
                GPUBackendMembership,
                GPUBackendFence,
                MLBackendRegistry,
                func.clock_timestamp(),
            )
            .join(
                GPUBackendFence,
                GPUBackendFence.backend_registry_id
                == GPUBackendMembership.backend_registry_id,
            )
            .join(
                MLBackendRegistry,
                MLBackendRegistry.id == GPUBackendMembership.backend_registry_id,
            )
            .where(
                GPUBackendMembership.backend_registry_id == backend_registry_id,
                GPUBackendMembership.gpu_resource_id == gpu_resource_id,
                GPUBackendMembership.state == "active",
            )
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if row is None:
        raise error_type("membership_not_active")
    membership, fence, registry, db_now = row
    if (
        not isinstance(db_now, datetime)
        or db_now.tzinfo is None
        or db_now.utcoffset() is None
    ):
        raise RuntimeError("PostgreSQL returned an invalid runtime proof clock")
    try:
        return _validate_gpu_idle_eviction_runtime_subject(
            membership,
            fence,
            registry,
            db_now=db_now,
            evidence_ttl=evidence_ttl,
            expected_generation=expected_generation,
            challenge=challenge,
            require_idle=require_idle,
        )
    except _GPUProofInvalid as exc:
        raise error_type(exc.reason) from None


async def read_gpu_idle_eviction_runtime_subject(
    db: AsyncSession,
    *,
    backend_id: str,
    gpu_resource_id: str,
    expected_generation: str,
    challenge: str,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUIdleEvictionRuntimeSubject:
    """Read one strict idle Resident victim from one MVCC snapshot."""

    return await _read_gpu_eviction_runtime_subject(
        db,
        backend_id=backend_id,
        gpu_resource_id=gpu_resource_id,
        expected_generation=expected_generation,
        challenge=challenge,
        evidence_ttl=evidence_ttl,
        require_idle=True,
        error_type=GPUIdleEvictionRuntimeSubjectError,
    )


async def read_gpu_busy_eviction_runtime_subject(
    db: AsyncSession,
    *,
    backend_id: str,
    gpu_resource_id: str,
    expected_generation: str,
    challenge: str,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUIdleEvictionRuntimeSubject:
    """Read one strict Resident victim while allowing live work to drain."""

    return await _read_gpu_eviction_runtime_subject(
        db,
        backend_id=backend_id,
        gpu_resource_id=gpu_resource_id,
        expected_generation=expected_generation,
        challenge=challenge,
        evidence_ttl=evidence_ttl,
        require_idle=False,
        error_type=GPUBusyEvictionRuntimeSubjectError,
    )


async def read_gpu_cold_runtime_subject(
    db: AsyncSession,
    *,
    backend_id: str,
    gpu_resource_id: str,
    expected_challenge: str | None = None,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUColdRuntimeSubject:
    """Read one strict idle-unloaded subject for a fenced cold generation."""

    backend_registry_id = _validate_runtime_subject_inputs(
        backend_id,
        gpu_resource_id,
        evidence_ttl,
        error_type=GPUColdRuntimeSubjectError,
    )
    if expected_challenge is not None and (
        not isinstance(expected_challenge, str)
        or _GPU_HEALTH_CHALLENGE_RE.fullmatch(expected_challenge) is None
    ):
        raise GPUColdRuntimeSubjectError("cold_runtime_challenge_invalid")
    row = (
        await db.execute(
            select(
                GPUBackendMembership,
                GPUBackendFence,
                MLBackendRegistry,
                func.clock_timestamp(),
            )
            .join(
                GPUBackendFence,
                GPUBackendFence.backend_registry_id
                == GPUBackendMembership.backend_registry_id,
            )
            .join(
                MLBackendRegistry,
                MLBackendRegistry.id == GPUBackendMembership.backend_registry_id,
            )
            .where(
                GPUBackendMembership.backend_registry_id == backend_registry_id,
                GPUBackendMembership.gpu_resource_id == gpu_resource_id,
                GPUBackendMembership.state == "active",
            )
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if row is None:
        raise GPUColdRuntimeSubjectError("membership_not_active")
    membership, fence, registry, db_now = row
    if (
        not isinstance(db_now, datetime)
        or db_now.tzinfo is None
        or db_now.utcoffset() is None
    ):
        raise RuntimeError("PostgreSQL returned an invalid runtime proof clock")
    try:
        return _validate_gpu_cold_runtime_subject(
            membership,
            fence,
            registry,
            db_now=db_now,
            evidence_ttl=evidence_ttl,
            expected_challenge=expected_challenge,
        )
    except _GPUProofInvalid as exc:
        raise GPUColdRuntimeSubjectError(exc.reason) from None


async def _lock_gpu_idle_eviction_runtime_subject(
    db: AsyncSession,
    expected_subject: GPUIdleEvictionRuntimeSubject,
    *,
    evidence_ttl: timedelta,
) -> GPUIdleEvictionRuntimeSubject:
    error_type = (
        GPUIdleEvictionRuntimeSubjectError
        if expected_subject.require_idle
        else GPUBusyEvictionRuntimeSubjectError
    )
    locked = await _lock_gpu_resource_proof_domain(
        db,
        expected_subject.gpu_resource_id,
    )
    membership = next(
        (
            item
            for item in locked.memberships
            if item.backend_registry_id == expected_subject.backend_registry_id
            and item.membership_epoch == expected_subject.membership_epoch
            and item.state == "active"
        ),
        None,
    )
    fence = locked.fences.get(expected_subject.backend_registry_id)
    registry = locked.registries.get(expected_subject.backend_registry_id)
    if membership is None or fence is None or registry is None:
        raise error_type("runtime_subject_missing")
    try:
        current_subject = _validate_gpu_idle_eviction_runtime_subject(
            membership,
            fence,
            registry,
            db_now=locked.db_now,
            evidence_ttl=evidence_ttl,
            expected_generation=expected_subject.generation,
            challenge=expected_subject.challenge,
            require_idle=expected_subject.require_idle,
        )
    except _GPUProofInvalid as exc:
        raise error_type(exc.reason) from None
    if _idle_eviction_runtime_subject_identity(
        current_subject
    ) != _idle_eviction_runtime_subject_identity(expected_subject):
        raise error_type("runtime_subject_changed")
    return current_subject


async def prepare_gpu_idle_eviction_runtime_generation(
    session_factory: GPUFenceSessionFactory,
    expected_subject: GPUIdleEvictionRuntimeSubject,
    *,
    token_expires_at: datetime,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUPreparedIdleEvictionRuntimeSubject:
    """Atomically advance one exact victim generation and token horizon."""

    _validate_token_expiry(token_expires_at)
    _validate_runtime_subject_evidence_ttl(evidence_ttl)
    async with session_factory() as db:
        async with db.begin():
            current_subject = await _lock_gpu_idle_eviction_runtime_subject(
                db,
                expected_subject,
                evidence_ttl=evidence_ttl,
            )
            if token_expires_at <= current_subject.db_now:
                error_type = (
                    GPUIdleEvictionRuntimeSubjectError
                    if current_subject.require_idle
                    else GPUBusyEvictionRuntimeSubjectError
                )
                raise error_type("token_expiry_not_in_future")
            generation = await _advance_gpu_backend_fence_in_transaction(
                db,
                expected_subject.backend_registry_id,
                "generation",
                gpu_resource_id=expected_subject.gpu_resource_id,
                membership_epoch=expected_subject.membership_epoch,
                token_expires_at=token_expires_at,
            )
    return GPUPreparedIdleEvictionRuntimeSubject(
        backend=current_subject.backend,
        backend_registry_id=current_subject.backend_registry_id,
        gpu_resource_id=current_subject.gpu_resource_id,
        membership_epoch=current_subject.membership_epoch,
        budget_mb=current_subject.budget_mb,
        eviction_priority=current_subject.eviction_priority,
        max_concurrency=current_subject.max_concurrency,
        boot_id=current_subject.boot_id,
        source_generation=current_subject.generation,
        generation=str(generation),
        pool_ids=current_subject.pool_ids,
        control_epoch=current_subject.control_epoch,
        runtime_epoch=current_subject.runtime_epoch,
        token_expires_at=token_expires_at,
        require_idle=current_subject.require_idle,
        db_now=current_subject.db_now,
    )


def _eviction_cancel_source_fingerprint(
    subject: GPUPreparedIdleEvictionRuntimeSubject,
) -> str:
    payload = {
        "backend_registry_id": str(subject.backend_registry_id),
        "backend_url": subject.backend.url,
        "backend_auth_method": subject.backend.auth_method,
        "backend_auth_token": subject.backend.auth_token,
        "gpu_resource_id": subject.gpu_resource_id,
        "membership_epoch": subject.membership_epoch,
        "budget_mb": subject.budget_mb,
        "eviction_priority": subject.eviction_priority,
        "max_concurrency": subject.max_concurrency,
        "boot_id": subject.boot_id,
        "source_generation": subject.source_generation,
        "drain_generation": subject.generation,
        "pool_ids": list(subject.pool_ids),
        "control_epoch": subject.control_epoch,
        "runtime_epoch": subject.runtime_epoch,
        "token_expires_at": _canonical_proof_timestamp(subject.token_expires_at),
        "require_idle": subject.require_idle,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validated_eviction_cancel_intent_pool_ids(
    intent: GPUBackendCancelIntent,
) -> tuple[str, ...]:
    value = intent.pool_ids
    if (
        type(value) is not list
        or not value
        or any(
            type(pool_id) is not str or not pool_id or pool_id.strip() != pool_id
            for pool_id in value
        )
    ):
        raise _GPUProofInvalid("cancel_intent_pool_ids_invalid")
    pool_ids = tuple(value)
    if pool_ids != tuple(sorted(set(pool_ids))):
        raise _GPUProofInvalid("cancel_intent_pool_ids_invalid")
    return pool_ids


def _validate_eviction_cancel_intent_durable_state(
    intent: GPUBackendCancelIntent,
    fence: GPUBackendFence,
    *,
    db_now: datetime,
) -> tuple[str, ...]:
    try:
        source_generation = _strict_nonnegative_int64(
            intent.source_generation,
            reason="cancel_intent_generation_invalid",
        )
        drain_generation = _strict_nonnegative_int64(
            intent.drain_generation,
            reason="cancel_intent_generation_invalid",
        )
        generation = _strict_nonnegative_int64(
            intent.generation,
            reason="cancel_intent_generation_invalid",
        )
        membership_epoch = _strict_nonnegative_int64(
            intent.membership_epoch,
            reason="cancel_intent_membership_invalid",
        )
        control_epoch = _strict_nonnegative_int64(
            intent.control_epoch,
            reason="cancel_intent_epoch_invalid",
        )
        runtime_epoch = _strict_nonnegative_int64(
            intent.runtime_epoch,
            reason="cancel_intent_epoch_invalid",
        )
        durable_generation = _strict_nonnegative_int64(
            fence.generation_high_water,
            reason="generation_high_water_invalid",
        )
        durable_control_epoch = _strict_nonnegative_int64(
            fence.control_epoch_high_water,
            reason="control_epoch_high_water_invalid",
        )
        durable_runtime_epoch = _strict_nonnegative_int64(
            fence.runtime_epoch_high_water,
            reason="runtime_epoch_high_water_invalid",
        )
    except _GPUProofInvalid:
        raise
    if (
        source_generation <= 0
        or drain_generation <= source_generation
        or generation <= drain_generation
        or membership_epoch <= 0
        or control_epoch <= 0
        or runtime_epoch <= 0
    ):
        raise _GPUProofInvalid("cancel_intent_generation_invalid")
    if (
        durable_generation != generation
        or durable_control_epoch != control_epoch
        or durable_runtime_epoch != runtime_epoch
    ):
        raise _GPUProofInvalid("cancel_intent_fence_changed")
    if (
        intent.operation != GPU_EVICTION_OPERATION
        or not isinstance(intent.owner_id, str)
        or not intent.owner_id
        or len(intent.owner_id) > 256
        or not isinstance(intent.jti, str)
        or not intent.jti.startswith("transition:")
        or len(intent.jti) > 256
        or not isinstance(intent.boot_id, str)
        or not intent.boot_id
        or len(intent.boot_id) > 128
        or not isinstance(intent.subject_fingerprint, str)
        or _SHA256_HEX_RE.fullmatch(intent.subject_fingerprint) is None
    ):
        raise _GPUProofInvalid("cancel_intent_identity_invalid")
    try:
        validate_gpu_resource_id(intent.gpu_resource_id)
    except (TypeError, ValueError) as exc:
        raise _GPUProofInvalid("cancel_intent_identity_invalid") from exc
    if (
        intent.drain_token_expires_at.tzinfo is None
        or intent.drain_token_expires_at.utcoffset() is None
        or intent.token_expires_at.tzinfo is None
        or intent.token_expires_at.utcoffset() is None
    ):
        raise _GPUProofInvalid("cancel_intent_token_horizon_invalid")
    try:
        owner_hard_deadline = datetime.fromtimestamp(
            intent.owner_hard_deadline_ms / 1000,
            UTC,
        )
    except (OSError, OverflowError, TypeError, ValueError) as exc:
        raise _GPUProofInvalid("cancel_intent_owner_deadline_invalid") from exc
    if (
        isinstance(intent.owner_hard_deadline_ms, bool)
        or not isinstance(intent.owner_hard_deadline_ms, int)
        or intent.owner_hard_deadline_ms <= 0
        or owner_hard_deadline <= db_now
        or intent.token_expires_at.astimezone(UTC) > owner_hard_deadline
    ):
        raise _GPUProofInvalid("cancel_intent_owner_deadline_invalid")
    if intent.token_expires_at.astimezone(UTC) <= db_now.astimezone(UTC):
        raise _GPUProofInvalid("cancel_intent_expired")
    horizon = fence.token_expiry_high_water
    if (
        horizon is None
        or horizon.tzinfo is None
        or horizon.utcoffset() is None
        or horizon.astimezone(UTC)
        < max(
            intent.drain_token_expires_at.astimezone(UTC),
            intent.token_expires_at.astimezone(UTC),
        )
    ):
        raise _GPUProofInvalid("cancel_intent_token_horizon_invalid")
    return _validated_eviction_cancel_intent_pool_ids(intent)


def _prepared_eviction_cancel_subject(
    source: GPUPreparedIdleEvictionRuntimeSubject,
    intent: GPUBackendCancelIntent,
    *,
    db_now: datetime,
    idempotent: bool,
) -> GPUPreparedEvictionCancelRuntimeSubject:
    return GPUPreparedEvictionCancelRuntimeSubject(
        backend=source.backend,
        backend_registry_id=source.backend_registry_id,
        gpu_resource_id=source.gpu_resource_id,
        membership_epoch=source.membership_epoch,
        budget_mb=source.budget_mb,
        eviction_priority=source.eviction_priority,
        max_concurrency=source.max_concurrency,
        boot_id=source.boot_id,
        source_generation=str(intent.source_generation),
        drain_generation=str(intent.drain_generation),
        generation=str(intent.generation),
        pool_ids=_validated_eviction_cancel_intent_pool_ids(intent),
        control_epoch=source.control_epoch,
        runtime_epoch=source.runtime_epoch,
        owner_id=intent.owner_id,
        operation=intent.operation,
        owner_hard_deadline_ms=intent.owner_hard_deadline_ms,
        drain_token_expires_at=intent.drain_token_expires_at,
        token_expires_at=intent.token_expires_at,
        jti=intent.jti,
        idempotent=idempotent,
        db_now=db_now,
    )


async def prepare_gpu_eviction_cancel_runtime_generation(
    session_factory: GPUFenceSessionFactory,
    expected_subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    owner_id: str,
    owner_hard_deadline_ms: int,
    token_expires_at: datetime,
) -> GPUPreparedEvictionCancelRuntimeSubject:
    """Persist or exactly replay one newer busy-drain cancellation generation."""

    if expected_subject.require_idle:
        raise GPUEvictionCancelRuntimeSubjectError("busy_cancel_required")
    if not isinstance(owner_id, str) or not owner_id or len(owner_id) > 256:
        raise ValueError("owner_id must be a non-empty string up to 256 chars")
    if (
        isinstance(owner_hard_deadline_ms, bool)
        or not isinstance(owner_hard_deadline_ms, int)
        or owner_hard_deadline_ms <= 0
        or owner_hard_deadline_ms > _MAX_POSITIVE_INT64
    ):
        raise ValueError("owner_hard_deadline_ms must be a positive int64")
    _validate_token_expiry(token_expires_at)
    fingerprint = _eviction_cancel_source_fingerprint(expected_subject)

    async with session_factory() as db:
        async with db.begin():
            locked = await _lock_gpu_resource_proof_domain(
                db,
                expected_subject.gpu_resource_id,
            )
            membership = next(
                (
                    item
                    for item in locked.memberships
                    if item.backend_registry_id == expected_subject.backend_registry_id
                    and item.membership_epoch == expected_subject.membership_epoch
                    and item.state == "active"
                ),
                None,
            )
            fence = locked.fences.get(expected_subject.backend_registry_id)
            registry = locked.registries.get(expected_subject.backend_registry_id)
            if membership is None or fence is None or registry is None:
                raise GPUEvictionCancelRuntimeSubjectError("runtime_subject_missing")
            try:
                durable_reason = _eviction_terminal_durable_reason(
                    membership,
                    fence,
                    registry,
                    expected_subject,
                )
            except _GPUProofInvalid as exc:
                durable_reason = exc.reason
            if durable_reason is not None:
                raise GPUEvictionCancelRuntimeSubjectError(durable_reason)
            if token_expires_at <= locked.db_now:
                raise GPUEvictionCancelRuntimeSubjectError("token_expiry_not_in_future")
            try:
                owner_hard_deadline = datetime.fromtimestamp(
                    owner_hard_deadline_ms / 1000,
                    UTC,
                )
            except (OSError, OverflowError, ValueError) as exc:
                raise ValueError(
                    "owner_hard_deadline_ms must fit a UTC datetime"
                ) from exc
            if owner_hard_deadline <= locked.db_now:
                raise GPUEvictionCancelRuntimeSubjectError(
                    "transition_owner_deadline_expired"
                )
            if token_expires_at.astimezone(UTC) > owner_hard_deadline:
                raise GPUEvictionCancelRuntimeSubjectError(
                    "token_expiry_exceeds_owner_deadline"
                )

            intent = await db.scalar(
                select(GPUBackendCancelIntent)
                .where(
                    GPUBackendCancelIntent.backend_registry_id
                    == expected_subject.backend_registry_id
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            durable_generation = _strict_nonnegative_int64(
                fence.generation_high_water,
                reason="generation_high_water_invalid",
            )
            expected_drain_generation = int(expected_subject.generation)
            if (
                intent is not None
                and intent.drain_generation == expected_drain_generation
            ):
                try:
                    intent_pool_ids = _validate_eviction_cancel_intent_durable_state(
                        intent,
                        fence,
                        db_now=locked.db_now,
                    )
                except _GPUProofInvalid as exc:
                    raise GPUEvictionCancelRuntimeSubjectError(exc.reason) from None
                exact = (
                    intent.gpu_resource_id == expected_subject.gpu_resource_id
                    and intent.membership_epoch == expected_subject.membership_epoch
                    and intent.boot_id == expected_subject.boot_id
                    and intent.control_epoch == int(expected_subject.control_epoch)
                    and intent.runtime_epoch == int(expected_subject.runtime_epoch)
                    and intent.source_generation
                    == int(expected_subject.source_generation)
                    and intent.owner_id == owner_id
                    and intent.operation == GPU_EVICTION_OPERATION
                    and intent.owner_hard_deadline_ms == owner_hard_deadline_ms
                    and intent.drain_token_expires_at.astimezone(UTC)
                    == expected_subject.token_expires_at.astimezone(UTC)
                    and intent.token_expires_at.astimezone(UTC)
                    == token_expires_at.astimezone(UTC)
                    and intent_pool_ids == expected_subject.pool_ids
                    and intent.subject_fingerprint == fingerprint
                )
                if not exact:
                    raise GPUEvictionCancelRuntimeSubjectError("cancel_intent_conflict")
                return _prepared_eviction_cancel_subject(
                    expected_subject,
                    intent,
                    db_now=locked.db_now,
                    idempotent=True,
                )

            if durable_generation < expected_drain_generation:
                raise GPUEvictionCancelRuntimeSubjectError("generation_changed")
            if intent is not None and intent.generation >= expected_drain_generation:
                raise GPUEvictionCancelRuntimeSubjectError("cancel_intent_corrupt")
            generation = await _advance_gpu_backend_fence_in_transaction(
                db,
                expected_subject.backend_registry_id,
                "generation",
                gpu_resource_id=expected_subject.gpu_resource_id,
                membership_epoch=expected_subject.membership_epoch,
                token_expires_at=token_expires_at,
            )
            values = {
                "gpu_resource_id": expected_subject.gpu_resource_id,
                "membership_epoch": expected_subject.membership_epoch,
                "boot_id": expected_subject.boot_id,
                "control_epoch": int(expected_subject.control_epoch),
                "runtime_epoch": int(expected_subject.runtime_epoch),
                "source_generation": int(expected_subject.source_generation),
                "drain_generation": expected_drain_generation,
                "generation": generation,
                "owner_id": owner_id,
                "operation": GPU_EVICTION_OPERATION,
                "owner_hard_deadline_ms": owner_hard_deadline_ms,
                "drain_token_expires_at": expected_subject.token_expires_at,
                "token_expires_at": token_expires_at,
                "jti": f"transition:{uuid.uuid4()}",
                "pool_ids": list(expected_subject.pool_ids),
                "subject_fingerprint": fingerprint,
            }
            if intent is None:
                intent = GPUBackendCancelIntent(
                    backend_registry_id=expected_subject.backend_registry_id,
                    **values,
                )
                db.add(intent)
            else:
                for field, value in values.items():
                    setattr(intent, field, value)
                intent.updated_at = func.now()
            await db.flush()
            return _prepared_eviction_cancel_subject(
                expected_subject,
                intent,
                db_now=locked.db_now,
                idempotent=False,
            )


async def read_gpu_eviction_cancel_runtime_subject(
    session_factory: GPUFenceSessionFactory,
    *,
    backend_id: str,
    gpu_resource_id: str,
    owner_id: str,
) -> GPUPreparedEvictionCancelRuntimeSubject:
    """Recover one still-live exact cancel intent without its in-memory source."""

    backend_registry_id = _validate_runtime_subject_inputs(
        backend_id,
        gpu_resource_id,
        _HEALTH_EVIDENCE_MAX_AGE,
        error_type=GPUEvictionCancelRuntimeSubjectError,
    )
    if not isinstance(owner_id, str) or not owner_id or len(owner_id) > 256:
        raise ValueError("owner_id must be a non-empty string up to 256 chars")
    async with session_factory() as db:
        async with db.begin():
            locked = await _lock_gpu_resource_proof_domain(db, gpu_resource_id)
            membership = next(
                (
                    item
                    for item in locked.memberships
                    if item.backend_registry_id == backend_registry_id
                    and item.state == "active"
                ),
                None,
            )
            fence = locked.fences.get(backend_registry_id)
            registry = locked.registries.get(backend_registry_id)
            intent = await db.scalar(
                select(GPUBackendCancelIntent)
                .where(
                    GPUBackendCancelIntent.backend_registry_id == backend_registry_id
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if (
                membership is None
                or fence is None
                or registry is None
                or intent is None
            ):
                raise GPUEvictionCancelRuntimeSubjectError("cancel_intent_missing")
            try:
                pool_ids = _validate_eviction_cancel_intent_durable_state(
                    intent,
                    fence,
                    db_now=locked.db_now,
                )
            except _GPUProofInvalid as exc:
                raise GPUEvictionCancelRuntimeSubjectError(exc.reason) from None
            if (
                intent.gpu_resource_id != gpu_resource_id
                or intent.membership_epoch != membership.membership_epoch
                or intent.owner_id != owner_id
            ):
                raise GPUEvictionCancelRuntimeSubjectError(
                    "cancel_intent_identity_changed"
                )
            source = GPUPreparedIdleEvictionRuntimeSubject(
                backend=_snapshot_gpu_mode_backend(registry),
                backend_registry_id=backend_registry_id,
                gpu_resource_id=gpu_resource_id,
                membership_epoch=membership.membership_epoch,
                budget_mb=membership.vram_budget_mb,
                eviction_priority=membership.eviction_priority,
                max_concurrency=membership.max_concurrency,
                boot_id=intent.boot_id,
                source_generation=str(intent.source_generation),
                generation=str(intent.drain_generation),
                pool_ids=pool_ids,
                control_epoch=str(intent.control_epoch),
                runtime_epoch=str(intent.runtime_epoch),
                token_expires_at=intent.drain_token_expires_at,
                require_idle=False,
                db_now=locked.db_now,
            )
            try:
                durable_reason = _eviction_terminal_durable_reason(
                    membership,
                    fence,
                    registry,
                    source,
                )
            except _GPUProofInvalid as exc:
                durable_reason = exc.reason
            if durable_reason is not None:
                raise GPUEvictionCancelRuntimeSubjectError(durable_reason)
            if (
                _eviction_cancel_source_fingerprint(source)
                != intent.subject_fingerprint
            ):
                raise GPUEvictionCancelRuntimeSubjectError(
                    "cancel_intent_source_changed"
                )
            return _prepared_eviction_cancel_subject(
                source,
                intent,
                db_now=locked.db_now,
                idempotent=True,
            )


async def _lock_gpu_cold_runtime_subject(
    db: AsyncSession,
    expected_subject: GPUColdRuntimeSubject,
    *,
    evidence_ttl: timedelta,
) -> GPUColdRuntimeSubject:
    membership = await db.scalar(
        select(GPUBackendMembership)
        .where(
            GPUBackendMembership.backend_registry_id
            == expected_subject.backend_registry_id,
            GPUBackendMembership.gpu_resource_id == expected_subject.gpu_resource_id,
            GPUBackendMembership.membership_epoch == expected_subject.membership_epoch,
            GPUBackendMembership.state == "active",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if membership is None:
        raise GPUColdRuntimeSubjectError("membership_changed")
    fence = await db.scalar(
        select(GPUBackendFence)
        .where(
            GPUBackendFence.backend_registry_id == expected_subject.backend_registry_id
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    registry = await db.scalar(
        select(MLBackendRegistry)
        .where(MLBackendRegistry.id == expected_subject.backend_registry_id)
        .execution_options(populate_existing=True)
    )
    db_now = await db.scalar(select(func.clock_timestamp()))
    if fence is None or registry is None:
        raise GPUColdRuntimeSubjectError("runtime_subject_missing")
    if (
        not isinstance(db_now, datetime)
        or db_now.tzinfo is None
        or db_now.utcoffset() is None
    ):
        raise RuntimeError("PostgreSQL returned an invalid runtime proof clock")
    try:
        current_subject = _validate_gpu_cold_runtime_subject(
            membership,
            fence,
            registry,
            db_now=db_now,
            evidence_ttl=evidence_ttl,
        )
    except _GPUProofInvalid as exc:
        raise GPUColdRuntimeSubjectError(exc.reason) from None
    if _cold_runtime_subject_identity(
        current_subject
    ) != _cold_runtime_subject_identity(expected_subject):
        raise GPUColdRuntimeSubjectError("runtime_subject_changed")
    return current_subject


async def prepare_gpu_cold_runtime_generation(
    session_factory: GPUFenceSessionFactory,
    expected_subject: GPUColdRuntimeSubject,
    *,
    token_expires_at: datetime,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUPreparedColdRuntimeSubject:
    """Atomically reserve one cold generation and its token horizon."""

    _validate_token_expiry(token_expires_at)
    _validate_runtime_subject_evidence_ttl(evidence_ttl)
    async with session_factory() as db:
        async with db.begin():
            current_subject = await _lock_gpu_cold_runtime_subject(
                db,
                expected_subject,
                evidence_ttl=evidence_ttl,
            )
            if token_expires_at <= current_subject.db_now:
                raise GPUColdRuntimeSubjectError("token_expiry_not_in_future")
            generation = await _advance_gpu_backend_fence_in_transaction(
                db,
                expected_subject.backend_registry_id,
                "generation",
                gpu_resource_id=expected_subject.gpu_resource_id,
                membership_epoch=expected_subject.membership_epoch,
                token_expires_at=token_expires_at,
            )
    return GPUPreparedColdRuntimeSubject(
        backend_registry_id=current_subject.backend_registry_id,
        gpu_resource_id=current_subject.gpu_resource_id,
        membership_epoch=current_subject.membership_epoch,
        budget_mb=current_subject.budget_mb,
        eviction_priority=current_subject.eviction_priority,
        max_concurrency=current_subject.max_concurrency,
        boot_id=current_subject.boot_id,
        observed_generation=current_subject.observed_generation,
        generation=str(generation),
        control_epoch=current_subject.control_epoch,
        runtime_epoch=current_subject.runtime_epoch,
        token_expires_at=token_expires_at,
        db_now=current_subject.db_now,
    )


async def record_gpu_resident_runtime_token_expiry(
    session_factory: GPUFenceSessionFactory,
    expected_subject: GPUResidentRuntimeSubject,
    *,
    token_expires_at: datetime,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> datetime:
    """Revalidate one subject under ordered locks and commit its token horizon."""

    _validate_token_expiry(token_expires_at)
    async with session_factory() as db:
        async with db.begin():
            membership = await db.scalar(
                select(GPUBackendMembership)
                .where(
                    GPUBackendMembership.backend_registry_id
                    == expected_subject.backend_registry_id,
                    GPUBackendMembership.gpu_resource_id
                    == expected_subject.gpu_resource_id,
                    GPUBackendMembership.membership_epoch
                    == expected_subject.membership_epoch,
                    GPUBackendMembership.state == "active",
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if membership is None:
                raise GPUResidentRuntimeSubjectError("membership_changed")
            fence = await db.scalar(
                select(GPUBackendFence)
                .where(
                    GPUBackendFence.backend_registry_id
                    == expected_subject.backend_registry_id
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            registry = await db.scalar(
                select(MLBackendRegistry)
                .where(MLBackendRegistry.id == expected_subject.backend_registry_id)
                .execution_options(populate_existing=True)
            )
            db_now = await db.scalar(select(func.clock_timestamp()))
            if fence is None or registry is None:
                raise GPUResidentRuntimeSubjectError("runtime_subject_missing")
            if (
                not isinstance(db_now, datetime)
                or db_now.tzinfo is None
                or db_now.utcoffset() is None
            ):
                raise RuntimeError("PostgreSQL returned an invalid runtime proof clock")
            try:
                current_subject = _validate_gpu_resident_runtime_subject(
                    membership,
                    fence,
                    registry,
                    db_now=db_now,
                    evidence_ttl=evidence_ttl,
                )
            except _GPUProofInvalid as exc:
                raise GPUResidentRuntimeSubjectError(exc.reason) from None
            if _runtime_subject_identity(current_subject) != _runtime_subject_identity(
                expected_subject
            ):
                raise GPUResidentRuntimeSubjectError("runtime_subject_changed")
            if token_expires_at <= db_now:
                raise GPUResidentRuntimeSubjectError("token_expiry_not_in_future")
            return await _record_gpu_backend_token_expiry_in_transaction(
                db,
                expected_subject.backend_registry_id,
                gpu_resource_id=expected_subject.gpu_resource_id,
                membership_epoch=expected_subject.membership_epoch,
                token_expires_at=token_expires_at,
            )


async def _lock_gpu_resource_proof_domain(
    db: AsyncSession,
    resource_id: str,
    *,
    wait_for_lock: bool = True,
) -> _LockedGPUProofDomain:
    lock_function = (
        "pg_advisory_xact_lock" if wait_for_lock else "pg_try_advisory_xact_lock"
    )
    acquired = await db.scalar(
        text(
            f"SELECT {lock_function}("  # noqa: S608 - fixed internal function name
            "hashtextextended('aap:gpu-resource:' || :resource_id, 0))"
        ),
        {"resource_id": resource_id},
    )
    if not wait_for_lock and acquired is not True:
        raise _GPUProofInvalid("gpu_resource_busy")
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


def _eviction_terminal_durable_reason(
    membership: GPUBackendMembership,
    fence: GPUBackendFence,
    registry: MLBackendRegistry,
    expected_subject: (
        GPUPreparedIdleEvictionRuntimeSubject | GPUPreparedEvictionCancelRuntimeSubject
    ),
) -> str | None:
    try:
        generation = _strict_nonnegative_int64(
            fence.generation_high_water,
            reason="generation_high_water_invalid",
        )
        control_epoch = _strict_nonnegative_int64(
            fence.control_epoch_high_water,
            reason="control_epoch_high_water_invalid",
        )
        runtime_epoch = _strict_nonnegative_int64(
            fence.runtime_epoch_high_water,
            reason="runtime_epoch_high_water_invalid",
        )
    except _GPUProofInvalid as exc:
        return exc.reason
    if (
        membership.state != "active"
        or membership.backend_registry_id != expected_subject.backend_registry_id
        or membership.gpu_resource_id != expected_subject.gpu_resource_id
        or membership.membership_epoch != expected_subject.membership_epoch
        or membership.vram_budget_mb != expected_subject.budget_mb
        or membership.eviction_priority != expected_subject.eviction_priority
        or membership.max_concurrency != expected_subject.max_concurrency
    ):
        return "membership_changed"
    # A concurrently prepared but never exposed generation may legitimately leave
    # a gap above this owner.  Exact Redis owner/generation and fresh health still
    # fence the active transition; only a regressed durable high-water is stale.
    if generation < int(expected_subject.generation):
        return "generation_changed"
    if control_epoch != int(expected_subject.control_epoch):
        return "control_epoch_changed"
    if runtime_epoch != int(expected_subject.runtime_epoch):
        return "runtime_epoch_changed"
    horizon = fence.token_expiry_high_water
    if (
        horizon is None
        or horizon.tzinfo is None
        or horizon.utcoffset() is None
        or horizon.astimezone(UTC) < expected_subject.token_expires_at.astimezone(UTC)
    ):
        return "token_horizon_changed"
    if (
        registry.url != expected_subject.backend.url
        or registry.auth_method != expected_subject.backend.auth_method
        or registry.auth_token != expected_subject.backend.auth_token
        or registry.gpu_resource_id != expected_subject.gpu_resource_id
        or registry.vram_budget_mb != expected_subject.budget_mb
        or registry.eviction_priority != expected_subject.eviction_priority
        or _registry_gpu_max_concurrency(registry.extra_params)
        != expected_subject.max_concurrency
    ):
        return "registry_claim_changed"
    return None


def _read_exact_gpu_eviction_residency(
    membership: GPUBackendMembership,
    registry: MLBackendRegistry,
    expected_subject: (
        GPUPreparedIdleEvictionRuntimeSubject | GPUPreparedEvictionCancelRuntimeSubject
    ),
    *,
    challenge: str,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> _GPUProofResidency:
    if registry.state != "connected" or type(registry.health_meta) is not dict:
        raise _GPUProofInvalid("eviction_health_unavailable")
    raw_health = registry.health_meta
    probe = _parse_gpu_proof_probe(raw_health.get("gpu_arbiter_probe"))
    if probe.raw["challenge"] != challenge:
        raise _GPUProofInvalid("eviction_challenge_mismatch")
    capability_sha256 = _health_managed_lifecycle_sha256(raw_health)
    if (
        capability_sha256 is None
        or probe.managed_lifecycle_sha256 is None
        or capability_sha256 != probe.managed_lifecycle_sha256
    ):
        raise _GPUProofInvalid("managed_lifecycle_capability_mismatch")
    if (
        probe.raw["backend_registry_id"] != str(membership.backend_registry_id)
        or probe.raw["gpu_resource_id"] != membership.gpu_resource_id
        or probe.raw["membership_epoch"] != str(membership.membership_epoch)
        or probe.raw["membership_state"] != "active"
    ):
        raise _GPUProofInvalid("probe_membership_mismatch")
    if (
        registry.last_checked_at is None
        or registry.last_checked_at.tzinfo is None
        or registry.last_checked_at.utcoffset() is None
        or registry.last_checked_at.astimezone(UTC) != probe.observed_at
    ):
        raise _GPUProofInvalid("probe_registry_clock_mismatch")
    db_now_utc = db_now.astimezone(UTC)
    if probe.observed_at > db_now_utc:
        raise _GPUProofInvalid("probe_from_future")
    if db_now_utc - probe.observed_at > evidence_ttl:
        raise _GPUProofInvalid("probe_expired")

    residency = _parse_gpu_proof_residency(raw_health.get("residency"))
    identity = residency.identity
    if (
        residency.lifecycle_gate != "enforce"
        or residency.boot_id != expected_subject.boot_id
        or residency.generation != expected_subject.generation
        or residency.pool_ids != expected_subject.pool_ids
        or residency.control_epoch != expected_subject.control_epoch
        or identity is None
        or identity["backend_registry_id"] != str(expected_subject.backend_registry_id)
        or identity["gpu_resource_id"] != expected_subject.gpu_resource_id
    ):
        raise _GPUProofInvalid("eviction_residency_identity_mismatch")
    return residency


def _eviction_cancel_durable_reason(
    membership: GPUBackendMembership,
    fence: GPUBackendFence,
    registry: MLBackendRegistry,
    intent: GPUBackendCancelIntent | None,
    expected_subject: GPUPreparedEvictionCancelRuntimeSubject,
    *,
    db_now: datetime,
) -> str | None:
    durable_reason = _eviction_terminal_durable_reason(
        membership,
        fence,
        registry,
        expected_subject,
    )
    if durable_reason is not None:
        return durable_reason
    if intent is None:
        return "cancel_intent_missing"
    try:
        pool_ids = _validate_eviction_cancel_intent_durable_state(
            intent,
            fence,
            db_now=db_now,
        )
    except _GPUProofInvalid as exc:
        return exc.reason
    if (
        intent.gpu_resource_id != expected_subject.gpu_resource_id
        or intent.membership_epoch != expected_subject.membership_epoch
        or intent.boot_id != expected_subject.boot_id
        or intent.control_epoch != int(expected_subject.control_epoch)
        or intent.runtime_epoch != int(expected_subject.runtime_epoch)
        or intent.source_generation != int(expected_subject.source_generation)
        or intent.drain_generation != int(expected_subject.drain_generation)
        or intent.generation != int(expected_subject.generation)
        or intent.owner_id != expected_subject.owner_id
        or intent.operation != expected_subject.operation
        or intent.owner_hard_deadline_ms != expected_subject.owner_hard_deadline_ms
        or intent.drain_token_expires_at.astimezone(UTC)
        != expected_subject.drain_token_expires_at.astimezone(UTC)
        or intent.token_expires_at.astimezone(UTC)
        != expected_subject.token_expires_at.astimezone(UTC)
        or intent.jti != expected_subject.jti
        or pool_ids != expected_subject.pool_ids
    ):
        return "cancel_intent_changed"
    source = GPUPreparedIdleEvictionRuntimeSubject(
        backend=expected_subject.backend,
        backend_registry_id=expected_subject.backend_registry_id,
        gpu_resource_id=expected_subject.gpu_resource_id,
        membership_epoch=expected_subject.membership_epoch,
        budget_mb=expected_subject.budget_mb,
        eviction_priority=expected_subject.eviction_priority,
        max_concurrency=expected_subject.max_concurrency,
        boot_id=expected_subject.boot_id,
        source_generation=expected_subject.source_generation,
        generation=expected_subject.drain_generation,
        pool_ids=expected_subject.pool_ids,
        control_epoch=expected_subject.control_epoch,
        runtime_epoch=expected_subject.runtime_epoch,
        token_expires_at=expected_subject.drain_token_expires_at,
        require_idle=False,
        db_now=db_now,
    )
    if _eviction_cancel_source_fingerprint(source) != intent.subject_fingerprint:
        return "cancel_intent_source_changed"
    return None


def _classify_gpu_eviction_cancel(
    membership: GPUBackendMembership,
    registry: MLBackendRegistry,
    expected_subject: GPUPreparedEvictionCancelRuntimeSubject,
    *,
    challenge: str,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> tuple[GPUAllocationState, str]:
    residency = _read_exact_gpu_eviction_residency(
        membership,
        registry,
        expected_subject,
        challenge=challenge,
        db_now=db_now,
        evidence_ttl=evidence_ttl,
    )
    if (
        residency.state == "resident"
        and residency.gpu_loaded is True
        and not residency.draining
        and residency.evictable
        and all(item is not None for item in residency.pool_residencies)
        and any(item is True for item in residency.pool_residencies)
    ):
        return GPUAllocationState.RESIDENT, "cancelled_resident"
    raise _GPUProofInvalid("cancel_residency_unknown")


def _gpu_draining_residency_ready(residency: _GPUProofResidency) -> bool:
    if not (
        residency.state == "draining"
        and residency.gpu_loaded is True
        and residency.draining
        and not residency.evictable
        and all(item is not None for item in residency.pool_residencies)
        and any(item is True for item in residency.pool_residencies)
    ):
        raise _GPUProofInvalid("drain_residency_not_ready")
    return (
        residency.active_requests == 0
        and residency.builders == 0
        and residency.borrowers == 0
    )


def _classify_gpu_eviction_phase(
    membership: GPUBackendMembership,
    registry: MLBackendRegistry,
    expected_subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    phase: Literal["drain", "unload"],
    challenge: str,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> tuple[GPUAllocationState, str]:
    residency = _read_exact_gpu_eviction_residency(
        membership,
        registry,
        expected_subject,
        challenge=challenge,
        db_now=db_now,
        evidence_ttl=evidence_ttl,
    )

    if phase == "drain":
        if _gpu_draining_residency_ready(residency):
            return GPUAllocationState.UNLOADING, "ready_to_unload"
        raise _GPUProofInvalid("eviction_residency_identity_mismatch")
    if phase == "unload":
        if (
            residency.state == "unloaded"
            and residency.gpu_loaded is False
            and not residency.draining
            and not residency.evictable
            and residency.active_requests == 0
            and residency.builders == 0
            and residency.borrowers == 0
            and all(item is False for item in residency.pool_residencies)
        ):
            return GPUAllocationState.UNLOADED, "unloaded"
        raise _GPUProofInvalid("unload_residency_unknown")
    raise ValueError("phase must be drain or unload")


async def read_gpu_eviction_drain_health(
    db: AsyncSession,
    expected_subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    challenge: str,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUEvictionDrainHealth:
    """Classify one fresh draining health receipt without mutating durable state."""

    if (
        not isinstance(challenge, str)
        or _GPU_HEALTH_CHALLENGE_RE.fullmatch(challenge) is None
    ):
        raise ValueError("challenge must be 64 lowercase hexadecimal characters")
    _validate_runtime_subject_evidence_ttl(evidence_ttl)
    row = (
        await db.execute(
            select(
                GPUBackendMembership,
                GPUBackendFence,
                MLBackendRegistry,
                func.clock_timestamp(),
            )
            .join(
                GPUBackendFence,
                GPUBackendFence.backend_registry_id
                == GPUBackendMembership.backend_registry_id,
            )
            .join(
                MLBackendRegistry,
                MLBackendRegistry.id == GPUBackendMembership.backend_registry_id,
            )
            .where(
                GPUBackendMembership.backend_registry_id
                == expected_subject.backend_registry_id,
                GPUBackendMembership.gpu_resource_id
                == expected_subject.gpu_resource_id,
                GPUBackendMembership.state == "active",
            )
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if row is None:
        return GPUEvictionDrainHealth(
            status="uncertain",
            reason="runtime_subject_missing",
        )
    membership, fence, registry, db_now = row
    if (
        not isinstance(db_now, datetime)
        or db_now.tzinfo is None
        or db_now.utcoffset() is None
    ):
        raise RuntimeError("PostgreSQL returned an invalid runtime proof clock")
    try:
        durable_reason = _eviction_terminal_durable_reason(
            membership,
            fence,
            registry,
            expected_subject,
        )
    except _GPUProofInvalid as exc:
        durable_reason = exc.reason
    if durable_reason is not None:
        return GPUEvictionDrainHealth(
            status="uncertain",
            reason=durable_reason,
        )
    try:
        residency = _read_exact_gpu_eviction_residency(
            membership,
            registry,
            expected_subject,
            challenge=challenge,
            db_now=db_now,
            evidence_ttl=evidence_ttl,
        )
        ready = _gpu_draining_residency_ready(residency)
    except _GPUProofInvalid as exc:
        return GPUEvictionDrainHealth(
            status="uncertain",
            reason=exc.reason,
        )
    return GPUEvictionDrainHealth(
        status="ready_to_unload" if ready else "draining_busy",
        reason="ready_to_unload" if ready else "draining_busy",
        active_requests=residency.active_requests,
        builders=residency.builders,
        borrowers=residency.borrowers,
    )


async def commit_gpu_eviction_phase_from_health(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    expected_subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    phase: Literal["drain", "unload"],
    challenge: str | None,
    owner_id: str,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUEvictionCommitResult:
    """Commit a drain/unload phase; untrusted health conservatively becomes Unknown."""

    if phase not in {"drain", "unload"}:
        raise ValueError("phase must be drain or unload")
    if challenge is not None and _GPU_HEALTH_CHALLENGE_RE.fullmatch(challenge) is None:
        raise ValueError("challenge must be 64 lowercase hexadecimal characters")
    _validate_runtime_subject_evidence_ttl(evidence_ttl)
    async with session_factory() as db:
        async with db.begin():
            locked = await _lock_gpu_resource_proof_domain(
                db,
                expected_subject.gpu_resource_id,
            )
            membership = next(
                (
                    item
                    for item in locked.memberships
                    if item.backend_registry_id == expected_subject.backend_registry_id
                    and item.membership_epoch == expected_subject.membership_epoch
                    and item.state == "active"
                ),
                None,
            )
            fence = locked.fences.get(expected_subject.backend_registry_id)
            registry = locked.registries.get(expected_subject.backend_registry_id)
            if membership is None or fence is None or registry is None:
                return GPUEvictionCommitResult(
                    status="stale",
                    state=GPUAllocationState.UNKNOWN,
                    reason="runtime_subject_missing",
                )
            durable_reason = _eviction_terminal_durable_reason(
                membership,
                fence,
                registry,
                expected_subject,
            )
            if durable_reason is not None:
                return GPUEvictionCommitResult(
                    status="stale",
                    state=GPUAllocationState.UNKNOWN,
                    reason=durable_reason,
                )
            try:
                if challenge is None:
                    raise _GPUProofInvalid("eviction_response_uncertain")
                target_state, reason = _classify_gpu_eviction_phase(
                    membership,
                    registry,
                    expected_subject,
                    phase=phase,
                    challenge=challenge,
                    db_now=locked.db_now,
                    evidence_ttl=evidence_ttl,
                )
            except _GPUProofInvalid as exc:
                target_state = GPUAllocationState.UNKNOWN
                reason = exc.reason
            expected_state = (
                GPUAllocationState.DRAINING
                if phase == "drain"
                else GPUAllocationState.UNLOADING
            )
            transition_kwargs = {
                "backend_id": str(expected_subject.backend_registry_id),
                "expected_state": expected_state,
                "expected_generation": expected_subject.generation,
                "target_state": target_state,
                "transition_owner_id": owner_id,
            }
            try:
                transition = await store.transition_eviction_allocation(
                    expected_subject.gpu_resource_id,
                    **transition_kwargs,
                )
            except Exception:  # noqa: BLE001 - exact idempotent response-loss retry
                transition = await store.transition_eviction_allocation(
                    expected_subject.gpu_resource_id,
                    **transition_kwargs,
                )
            if transition.status != "transitioned":
                return GPUEvictionCommitResult(
                    status="rejected",
                    state=target_state,
                    reason=f"redis_{transition.status}",
                )
            return GPUEvictionCommitResult(
                status="finalized",
                state=target_state,
                reason=reason,
                idempotent=transition.idempotent,
            )


async def commit_gpu_eviction_cancel_from_health(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    expected_subject: GPUPreparedEvictionCancelRuntimeSubject,
    *,
    ack_confirmed: bool,
    challenge: str | None,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUEvictionCommitResult:
    """Commit one passive cancel proof; uncertainty can only tighten to Unknown.

    This helper deliberately does not send RESUME or choose between cancel and
    unload.  The authority must install a Redis branch fence before either active
    branch is wired.
    """

    if not isinstance(ack_confirmed, bool):
        raise ValueError("ack_confirmed must be a boolean")
    if challenge is not None and _GPU_HEALTH_CHALLENGE_RE.fullmatch(challenge) is None:
        raise ValueError("challenge must be 64 lowercase hexadecimal characters")
    _validate_runtime_subject_evidence_ttl(evidence_ttl)
    async with session_factory() as db:
        async with db.begin():
            locked = await _lock_gpu_resource_proof_domain(
                db,
                expected_subject.gpu_resource_id,
            )
            membership = next(
                (
                    item
                    for item in locked.memberships
                    if item.backend_registry_id == expected_subject.backend_registry_id
                    and item.membership_epoch == expected_subject.membership_epoch
                    and item.state == "active"
                ),
                None,
            )
            fence = locked.fences.get(expected_subject.backend_registry_id)
            registry = locked.registries.get(expected_subject.backend_registry_id)
            intent = await db.scalar(
                select(GPUBackendCancelIntent)
                .where(
                    GPUBackendCancelIntent.backend_registry_id
                    == expected_subject.backend_registry_id
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if membership is None or fence is None or registry is None:
                return GPUEvictionCommitResult(
                    status="stale",
                    state=GPUAllocationState.UNKNOWN,
                    reason="runtime_subject_missing",
                )
            durable_reason = _eviction_cancel_durable_reason(
                membership,
                fence,
                registry,
                intent,
                expected_subject,
                db_now=locked.db_now,
            )
            if durable_reason is not None:
                return GPUEvictionCommitResult(
                    status="stale",
                    state=GPUAllocationState.UNKNOWN,
                    reason=durable_reason,
                )
            try:
                if not ack_confirmed:
                    raise _GPUProofInvalid("cancel_ack_uncertain")
                if challenge is None:
                    raise _GPUProofInvalid("cancel_health_uncertain")
                target_state, reason = _classify_gpu_eviction_cancel(
                    membership,
                    registry,
                    expected_subject,
                    challenge=challenge,
                    db_now=locked.db_now,
                    evidence_ttl=evidence_ttl,
                )
            except _GPUProofInvalid as exc:
                target_state = GPUAllocationState.UNKNOWN
                reason = exc.reason
            transition_kwargs = {
                "backend_id": str(expected_subject.backend_registry_id),
                "expected_state": GPUAllocationState.DRAINING,
                "expected_generation": expected_subject.drain_generation,
                "target_state": target_state,
                "transition_owner_id": expected_subject.owner_id,
                "next_generation": (
                    expected_subject.generation
                    if target_state is GPUAllocationState.RESIDENT
                    else None
                ),
            }
            try:
                transition = await store.transition_eviction_allocation(
                    expected_subject.gpu_resource_id,
                    **transition_kwargs,
                )
            except Exception:  # noqa: BLE001 - exact idempotent response-loss retry
                transition = await store.transition_eviction_allocation(
                    expected_subject.gpu_resource_id,
                    **transition_kwargs,
                )
            if transition.status != "transitioned":
                return GPUEvictionCommitResult(
                    status="rejected",
                    state=target_state,
                    reason=f"redis_{transition.status}",
                )
            return GPUEvictionCommitResult(
                status="finalized",
                state=target_state,
                reason=reason,
                idempotent=transition.idempotent,
            )


def _cold_terminal_durable_reason(
    membership: GPUBackendMembership,
    fence: GPUBackendFence,
    registry: MLBackendRegistry,
    expected_subject: GPUPreparedColdRuntimeSubject,
) -> str | None:
    try:
        generation = _strict_nonnegative_int64(
            fence.generation_high_water,
            reason="generation_high_water_invalid",
        )
        control_epoch = _strict_nonnegative_int64(
            fence.control_epoch_high_water,
            reason="control_epoch_high_water_invalid",
        )
        runtime_epoch = _strict_nonnegative_int64(
            fence.runtime_epoch_high_water,
            reason="runtime_epoch_high_water_invalid",
        )
    except _GPUProofInvalid as exc:
        return exc.reason
    if (
        membership.state != "active"
        or membership.backend_registry_id != expected_subject.backend_registry_id
        or membership.gpu_resource_id != expected_subject.gpu_resource_id
        or membership.membership_epoch != expected_subject.membership_epoch
        or membership.vram_budget_mb != expected_subject.budget_mb
        or membership.eviction_priority != expected_subject.eviction_priority
        or membership.max_concurrency != expected_subject.max_concurrency
    ):
        return "membership_changed"
    if generation != int(expected_subject.generation):
        return "generation_changed"
    if control_epoch != int(expected_subject.control_epoch):
        return "control_epoch_changed"
    if runtime_epoch != int(expected_subject.runtime_epoch):
        return "runtime_epoch_changed"
    horizon = fence.token_expiry_high_water
    if (
        horizon is None
        or horizon.tzinfo is None
        or horizon.utcoffset() is None
        or horizon.astimezone(UTC) < expected_subject.token_expires_at.astimezone(UTC)
    ):
        return "token_horizon_changed"
    if (
        registry.gpu_resource_id != expected_subject.gpu_resource_id
        or registry.vram_budget_mb != expected_subject.budget_mb
        or registry.eviction_priority != expected_subject.eviction_priority
        or _registry_gpu_max_concurrency(registry.extra_params)
        != expected_subject.max_concurrency
    ):
        return "registry_claim_changed"
    return None


def _cold_terminal_cpu_fallback(raw_health: dict[str, Any]) -> bool:
    compute = raw_health.get("compute")
    if type(compute) is not dict or compute.get("cpu_fallback_supported") is not True:
        return False
    effective_device = compute.get("effective_device")
    effective_provider = compute.get("effective_provider")
    return (
        type(effective_device) is str and effective_device.strip().lower() == "cpu"
    ) or (
        type(effective_provider) is str
        and effective_provider.strip().lower() == "cpuexecutionprovider"
    )


def _classify_gpu_cold_terminal(
    membership: GPUBackendMembership,
    registry: MLBackendRegistry,
    expected_subject: GPUPreparedColdRuntimeSubject,
    *,
    challenge: str,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> tuple[GPUAllocationState, str]:
    if registry.state != "connected" or type(registry.health_meta) is not dict:
        raise _GPUProofInvalid("terminal_health_unavailable")
    raw_health = registry.health_meta
    probe = _parse_gpu_proof_probe(raw_health.get("gpu_arbiter_probe"))
    if probe.raw["challenge"] != challenge:
        raise _GPUProofInvalid("terminal_challenge_mismatch")
    capability_sha256 = _health_managed_lifecycle_sha256(raw_health)
    if (
        capability_sha256 is None
        or probe.managed_lifecycle_sha256 is None
        or capability_sha256 != probe.managed_lifecycle_sha256
    ):
        raise _GPUProofInvalid("managed_lifecycle_capability_mismatch")
    if (
        probe.raw["backend_registry_id"] != str(membership.backend_registry_id)
        or probe.raw["gpu_resource_id"] != membership.gpu_resource_id
        or probe.raw["membership_epoch"] != str(membership.membership_epoch)
        or probe.raw["membership_state"] != "active"
    ):
        raise _GPUProofInvalid("probe_membership_mismatch")
    if (
        registry.last_checked_at is None
        or registry.last_checked_at.tzinfo is None
        or registry.last_checked_at.utcoffset() is None
        or registry.last_checked_at.astimezone(UTC) != probe.observed_at
    ):
        raise _GPUProofInvalid("probe_registry_clock_mismatch")
    db_now_utc = db_now.astimezone(UTC)
    if probe.observed_at > db_now_utc:
        raise _GPUProofInvalid("probe_from_future")
    if db_now_utc - probe.observed_at > evidence_ttl:
        raise _GPUProofInvalid("probe_expired")

    residency = _parse_gpu_proof_residency(raw_health.get("residency"))
    identity = residency.identity
    if (
        residency.lifecycle_gate != "enforce"
        or residency.boot_id != expected_subject.boot_id
        or residency.control_epoch != expected_subject.control_epoch
        or identity is None
        or identity["backend_registry_id"] != str(expected_subject.backend_registry_id)
        or identity["gpu_resource_id"] != expected_subject.gpu_resource_id
        or residency.active_requests != 0
        or residency.builders != 0
        or residency.borrowers != 0
        or residency.draining
    ):
        raise _GPUProofInvalid("terminal_residency_identity_mismatch")

    if (
        residency.state == "resident"
        and residency.gpu_loaded is True
        and residency.evictable
        and residency.generation == expected_subject.generation
        and all(item is not None for item in residency.pool_residencies)
        and any(item is True for item in residency.pool_residencies)
    ):
        return GPUAllocationState.RESIDENT, "resident"
    if (
        residency.state == "resident"
        and residency.gpu_loaded is False
        and not residency.evictable
        and residency.generation == expected_subject.generation
        and all(item is False for item in residency.pool_residencies)
        and _cold_terminal_cpu_fallback(raw_health)
    ):
        return GPUAllocationState.CPU_FALLBACK, "cpu_fallback"
    if (
        residency.state == "unloaded"
        and residency.gpu_loaded is False
        and not residency.evictable
        and all(item is False for item in residency.pool_residencies)
        and (
            residency.generation is None
            or int(residency.generation) <= int(expected_subject.generation)
        )
    ):
        return GPUAllocationState.UNLOADED, "unloaded"
    raise _GPUProofInvalid("terminal_residency_unknown")


async def commit_gpu_cold_terminal_from_health(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    expected_subject: GPUPreparedColdRuntimeSubject,
    *,
    challenge: str | None,
    lease_id: str,
    owner_id: str,
    resident_cooldown_ms: int,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
) -> GPUColdTerminalCommitResult:
    """Commit one exposed cold terminal; no response proof forces Unknown."""

    if challenge is not None and _GPU_HEALTH_CHALLENGE_RE.fullmatch(challenge) is None:
        raise ValueError("challenge must be 64 lowercase hexadecimal characters")
    if (
        isinstance(resident_cooldown_ms, bool)
        or not isinstance(resident_cooldown_ms, int)
        or resident_cooldown_ms <= 0
        or resident_cooldown_ms > 3_600_000
    ):
        raise ValueError("resident_cooldown_ms must be between 1 and 3600000")
    _validate_runtime_subject_evidence_ttl(evidence_ttl)
    async with session_factory() as db:
        async with db.begin():
            locked = await _lock_gpu_resource_proof_domain(
                db,
                expected_subject.gpu_resource_id,
            )
            membership = next(
                (
                    item
                    for item in locked.memberships
                    if item.backend_registry_id == expected_subject.backend_registry_id
                    and item.membership_epoch == expected_subject.membership_epoch
                    and item.state == "active"
                ),
                None,
            )
            fence = locked.fences.get(expected_subject.backend_registry_id)
            registry = locked.registries.get(expected_subject.backend_registry_id)
            if membership is None or fence is None or registry is None:
                return GPUColdTerminalCommitResult(
                    status="stale",
                    state=GPUAllocationState.UNKNOWN,
                    reason="runtime_subject_missing",
                )
            durable_reason = _cold_terminal_durable_reason(
                membership,
                fence,
                registry,
                expected_subject,
            )
            if durable_reason is not None:
                return GPUColdTerminalCommitResult(
                    status="stale",
                    state=GPUAllocationState.UNKNOWN,
                    reason=durable_reason,
                )
            try:
                if challenge is None:
                    raise _GPUProofInvalid("terminal_response_uncertain")
                target_state, reason = _classify_gpu_cold_terminal(
                    membership,
                    registry,
                    expected_subject,
                    challenge=challenge,
                    db_now=locked.db_now,
                    evidence_ttl=evidence_ttl,
                )
            except _GPUProofInvalid as exc:
                target_state = GPUAllocationState.UNKNOWN
                reason = exc.reason
            finalize_kwargs = {
                "backend_id": str(expected_subject.backend_registry_id),
                "expected_generation": expected_subject.generation,
                "request_lease_id": lease_id,
                "request_owner_id": owner_id,
                "target_state": target_state,
                "target_evictable": target_state is GPUAllocationState.RESIDENT,
                "resident_cooldown_ms": (
                    resident_cooldown_ms
                    if target_state is GPUAllocationState.RESIDENT
                    else 0
                ),
            }
            try:
                transition = await store.finalize_cold_allocation(
                    expected_subject.gpu_resource_id,
                    **finalize_kwargs,
                )
            except Exception:  # noqa: BLE001 - exact idempotent response-loss retry
                transition = await store.finalize_cold_allocation(
                    expected_subject.gpu_resource_id,
                    **finalize_kwargs,
                )
            if transition.status != "transitioned":
                return GPUColdTerminalCommitResult(
                    status="rejected",
                    state=target_state,
                    reason=f"redis_{transition.status}",
                )
            return GPUColdTerminalCommitResult(
                status="finalized",
                state=target_state,
                reason=reason,
                idempotent=transition.idempotent,
            )


@dataclass(frozen=True)
class _GPULegacyAckEvidence:
    boot_id: str
    acknowledged_control_epoch: str | None
    probe_started_at: datetime
    proof_ready: bool


def _canonical_gpu_backend_endpoint(url: str) -> str | None:
    if not isinstance(url, str) or not url or url.strip() != url:
        return None
    try:
        parsed = httpx.URL(url if "://" in url else f"http://{url}")
    except (TypeError, ValueError):
        return None
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        return None
    raw_host = parsed.host.lower().rstrip(".")
    if not raw_host:
        return None
    try:
        host = ipaddress.ip_address(raw_host).compressed
    except ValueError:
        try:
            host = str(ipaddress.IPv4Address(socket.inet_aton(raw_host)))
        except OSError:
            host = raw_host
    port = parsed.port
    if port is None:
        port = 443 if scheme == "https" else 80
    authority = f"[{host}]" if ":" in host else host
    authority = f"{authority}:{port}"
    # httpx applies its request URL normalization first.  Decode the request
    # path, collapse repeated separators, then remove encoded dot segments so
    # aliases such as /a/../backend and /%62ackend cannot evade comparison.
    path = posixpath.normpath(re.sub(r"/+", "/", parsed.path))
    if path == "/":
        path = ""
    else:
        path = path.rstrip("/")
    return f"{scheme}://{authority}{path}"


def _fresh_challenge_bound_boot_id(
    membership: GPUBackendMembership,
    registry: MLBackendRegistry | None,
    *,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> str | None:
    if (
        membership.state not in {"pending", "active"}
        or registry is None
        or registry.state != "connected"
        or registry.gpu_resource_id != membership.gpu_resource_id
        or type(registry.health_meta) is not dict
    ):
        return None
    raw_probe = registry.health_meta.get("gpu_arbiter_probe")
    raw_residency = registry.health_meta.get("residency")
    try:
        probe = _parse_gpu_proof_probe(raw_probe)
    except _GPUProofInvalid:
        return None
    if (
        probe.raw["backend_registry_id"] != str(membership.backend_registry_id)
        or probe.raw["gpu_resource_id"] != membership.gpu_resource_id
        or probe.raw["membership_epoch"] != str(membership.membership_epoch)
        or probe.raw["membership_state"] != membership.state
        or registry.last_checked_at is None
        or registry.last_checked_at.tzinfo is None
        or registry.last_checked_at.utcoffset() is None
        or registry.last_checked_at.astimezone(UTC) != probe.observed_at
        or probe.observed_at > db_now.astimezone(UTC)
        or db_now.astimezone(UTC) - probe.observed_at > evidence_ttl
        or type(raw_residency) is not dict
    ):
        return None
    boot_id = raw_residency.get("boot_id")
    if type(boot_id) is not str or not boot_id or len(boot_id) > 128:
        return None
    return boot_id


async def _lock_gpu_membership_promotion_barrier(
    db: AsyncSession,
    *,
    wait_for_lock: bool = True,
) -> None:
    """Serialize short cross-card alias checks without covering backend HTTP."""

    lock_function = (
        "pg_advisory_xact_lock" if wait_for_lock else "pg_try_advisory_xact_lock"
    )
    acquired = await db.scalar(
        text(
            f"SELECT {lock_function}("  # noqa: S608 - fixed internal function name
            "hashtextextended('aap:gpu-membership-promotion', 0))"
        )
    )
    if not wait_for_lock and acquired is not True:
        raise _GPUProofInvalid("gpu_promotion_barrier_busy")


async def _validate_gpu_membership_aliases(
    db: AsyncSession,
    membership: GPUBackendMembership,
    registry: MLBackendRegistry,
    evidence: _GPULegacyAckEvidence,
    *,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> None:
    current_memberships = tuple(
        (
            await db.execute(
                select(GPUBackendMembership)
                .where(GPUBackendMembership.state.in_(("pending", "active")))
                .order_by(
                    GPUBackendMembership.gpu_resource_id,
                    GPUBackendMembership.backend_registry_id,
                )
            )
        )
        .scalars()
        .all()
    )
    backend_ids = [item.backend_registry_id for item in current_memberships]
    current_registries: tuple[MLBackendRegistry, ...] = ()
    if backend_ids:
        current_registries = tuple(
            (
                await db.execute(
                    select(MLBackendRegistry)
                    .where(MLBackendRegistry.id.in_(backend_ids))
                    .order_by(MLBackendRegistry.id)
                )
            )
            .scalars()
            .all()
        )
    registries = {item.id: item for item in current_registries}
    target_endpoint = _canonical_gpu_backend_endpoint(registry.url)
    if target_endpoint is None:
        raise _GPUProofInvalid("registry_endpoint_invalid")

    for other in current_memberships:
        if other.backend_registry_id == membership.backend_registry_id:
            continue
        other_registry = registries.get(other.backend_registry_id)
        if (
            other_registry is not None
            and _canonical_gpu_backend_endpoint(other_registry.url) == target_endpoint
        ):
            raise _GPUProofInvalid("lifecycle_endpoint_aliased")
        if (
            _fresh_challenge_bound_boot_id(
                other,
                other_registry,
                db_now=db_now,
                evidence_ttl=evidence_ttl,
            )
            == evidence.boot_id
        ):
            raise _GPUProofInvalid("lifecycle_boot_id_aliased")


def _snapshot_gpu_mode_backend(registry: MLBackendRegistry) -> MLBackendRegistry:
    """Detach only endpoint fields needed by the post-commit control client."""

    return MLBackendRegistry(
        id=registry.id,
        name=registry.name,
        url=registry.url,
        state=registry.state,
        auth_method=registry.auth_method,
        auth_token=registry.auth_token,
        extra_params=dict(registry.extra_params),
        gpu_resource_id=registry.gpu_resource_id,
        vram_budget_mb=registry.vram_budget_mb,
        eviction_priority=registry.eviction_priority,
    )


def _validate_stable_legacy_residency(residency: _GPUProofResidency) -> None:
    idle = (
        residency.active_requests == 0
        and residency.builders == 0
        and residency.borrowers == 0
        and not residency.draining
    )
    pools_complete = all(item is not None for item in residency.pool_residencies)
    if (
        residency.lifecycle_gate != "legacy"
        or residency.generation is not None
        or residency.evictable
        or not idle
        or residency.state not in {"unloaded", "resident"}
        or residency.gpu_loaded is None
        or not pools_complete
    ):
        raise _GPUProofInvalid("legacy_residency_not_stably_idle")
    if residency.gpu_loaded is True and (
        residency.state != "resident"
        or not any(item is True for item in residency.pool_residencies)
    ):
        raise _GPUProofInvalid("legacy_residency_loaded_inconsistent")


def _validate_gpu_legacy_ack_evidence(
    membership: GPUBackendMembership,
    fence: GPUBackendFence | None,
    registry: MLBackendRegistry | None,
    *,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> _GPULegacyAckEvidence:
    if membership.state not in {"pending", "active"}:
        raise _GPUProofInvalid("membership_state_invalid")
    if fence is None:
        raise _GPUProofInvalid("fence_missing")
    if registry is None:
        raise _GPUProofInvalid("registry_missing")

    _strict_nonnegative_int64(
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
    if membership.state == "pending":
        if runtime_epoch_high_water != runtime_epoch_baseline:
            raise _GPUProofInvalid("pending_runtime_epoch_mismatch")
    elif runtime_epoch_high_water <= runtime_epoch_baseline:
        raise _GPUProofInvalid("active_runtime_epoch_invalid")

    if (
        registry.state != "connected"
        or registry.gpu_resource_id != membership.gpu_resource_id
        or registry.vram_budget_mb != membership.vram_budget_mb
        or registry.eviction_priority != membership.eviction_priority
        or _registry_gpu_max_concurrency(registry.extra_params)
        != membership.max_concurrency
    ):
        raise _GPUProofInvalid("registry_claim_mismatch")

    raw_health = registry.health_meta
    raw_probe = (
        raw_health.get("gpu_arbiter_probe") if type(raw_health) is dict else None
    )
    raw_residency = raw_health.get("residency") if type(raw_health) is dict else None
    probe = _parse_gpu_proof_probe(raw_probe)
    actual_capability_sha256 = _health_managed_lifecycle_sha256(raw_health)
    if (
        probe.managed_lifecycle_sha256 is None
        or actual_capability_sha256 is None
        or actual_capability_sha256 != probe.managed_lifecycle_sha256
    ):
        raise _GPUProofInvalid("managed_lifecycle_capability_mismatch")
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
    db_now_utc = db_now.astimezone(UTC)
    if probe.observed_at > db_now_utc:
        raise _GPUProofInvalid("probe_from_future")
    if db_now_utc - probe.observed_at > evidence_ttl:
        raise _GPUProofInvalid("probe_expired")

    horizon = fence.token_expiry_high_water
    if horizon is not None and (horizon.tzinfo is None or horizon.utcoffset() is None):
        raise _GPUProofInvalid("token_horizon_invalid")

    residency = _parse_gpu_proof_residency(raw_residency)
    _validate_stable_legacy_residency(residency)
    identity = residency.identity
    acknowledged_control_epoch: str | None = None
    proof_ready = False
    if membership.state == "pending":
        if identity is not None or residency.control_epoch is not None:
            raise _GPUProofInvalid("pending_lifecycle_identity_already_bound")
    elif identity is None and residency.control_epoch is None:
        pass
    elif identity is None or residency.control_epoch is None:
        raise _GPUProofInvalid("active_lifecycle_identity_incomplete")
    else:
        if (
            identity["backend_registry_id"] != str(membership.backend_registry_id)
            or identity["gpu_resource_id"] != membership.gpu_resource_id
        ):
            raise _GPUProofInvalid("residency_identity_mismatch")
        if int(residency.control_epoch) > control_epoch_high_water:
            raise _GPUProofInvalid("residency_control_epoch_ahead")
        if horizon is None:
            raise _GPUProofInvalid("token_horizon_missing")
        if int(residency.control_epoch) == control_epoch_high_water:
            acknowledged_control_epoch = residency.control_epoch
            proof_ready = (
                probe.probe_started_at > horizon.astimezone(UTC)
                and residency.gpu_loaded is False
                and all(item is False for item in residency.pool_residencies)
            )

    return _GPULegacyAckEvidence(
        boot_id=residency.boot_id,
        acknowledged_control_epoch=acknowledged_control_epoch,
        probe_started_at=probe.probe_started_at,
        proof_ready=proof_ready,
    )


async def prepare_gpu_backend_legacy_ack(
    session_factory: GPUFenceSessionFactory,
    backend_registry_id: uuid.UUID,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
    token_ttl_seconds: int = GPU_LEGACY_MODE_TOKEN_TTL_SECONDS,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
    readiness_demoter: GPUReadinessDemoter | None = None,
) -> GPULegacyAckPreparation:
    """Validate live proof and durably reserve one signed legacy-mode operation.

    The transaction locks the complete physical-resource domain, then activates a
    pending member and advances its control epoch plus token horizon atomically.
    Signing and backend HTTP deliberately happen only after this function commits.
    """

    validate_gpu_resource_id(gpu_resource_id)
    if (
        not isinstance(membership_epoch, int)
        or isinstance(membership_epoch, bool)
        or membership_epoch <= 0
        or membership_epoch > _MAX_POSITIVE_INT64
    ):
        raise ValueError("membership_epoch must be a positive int64")
    if (
        not isinstance(token_ttl_seconds, int)
        or isinstance(token_ttl_seconds, bool)
        or token_ttl_seconds <= 0
        or token_ttl_seconds > 300
    ):
        raise ValueError("token_ttl_seconds must be between 1 and 300")
    if evidence_ttl <= timedelta(0) or evidence_ttl > _PROOF_RESET_MAX_WINDOW:
        raise ValueError(
            "evidence_ttl must be positive and no greater than five minutes"
        )

    readiness_demoted = False

    async def ensure_not_ready(*, required: bool) -> None:
        nonlocal readiness_demoted
        if readiness_demoted:
            return
        if readiness_demoter is None:
            if required:
                raise _GPUProofInvalid("readiness_demotion_unavailable")
            return
        await readiness_demoter(gpu_resource_id)
        readiness_demoted = True

    try:
        async with session_factory() as db:
            async with db.begin():
                locked = await _lock_gpu_resource_proof_domain(
                    db,
                    gpu_resource_id,
                    wait_for_lock=False,
                )
                membership = next(
                    (
                        item
                        for item in locked.memberships
                        if item.backend_registry_id == backend_registry_id
                        and item.membership_epoch == membership_epoch
                    ),
                    None,
                )
                if membership is None:
                    raise _GPUProofInvalid("membership_changed")
                fence = locked.fences.get(backend_registry_id)
                registry = locked.registries.get(backend_registry_id)
                evidence = _validate_gpu_legacy_ack_evidence(
                    membership,
                    fence,
                    registry,
                    db_now=locked.db_now,
                    evidence_ttl=evidence_ttl,
                )
                assert fence is not None
                assert registry is not None
                backend_snapshot = _snapshot_gpu_mode_backend(registry)

                # Redis must be fail-closed before this transaction can advance a
                # durable epoch/horizon.  Keep only the target resource lock while
                # awaiting Redis so another card never waits behind this I/O.
                if not evidence.proof_ready:
                    await ensure_not_ready(required=True)

                # Every alias writer takes its resource lock before this global
                # barrier.  Promotion therefore tries the target resource first,
                # then serializes only the short cross-card scan and PG mutation.
                await _lock_gpu_membership_promotion_barrier(
                    db,
                    wait_for_lock=False,
                )
                await _validate_gpu_membership_aliases(
                    db,
                    membership,
                    registry,
                    evidence,
                    db_now=locked.db_now,
                    evidence_ttl=evidence_ttl,
                )

                if evidence.acknowledged_control_epoch is not None:
                    return GPULegacyAckPreparation(
                        action="acknowledged",
                        backend=backend_snapshot,
                        backend_id=backend_registry_id,
                        resource_id=gpu_resource_id,
                        membership_epoch=membership_epoch,
                        boot_id=evidence.boot_id,
                        runtime_epoch=str(fence.runtime_epoch_high_water),
                        control_epoch=evidence.acknowledged_control_epoch,
                        token_expires_at=None,
                        proof_ready=evidence.proof_ready,
                    )

                horizon = fence.token_expiry_high_water
                if horizon is not None and (
                    evidence.probe_started_at <= horizon.astimezone(UTC)
                ):
                    raise _GPUProofInvalid("probe_not_after_token_horizon")

                token_exp = int(locked.db_now.timestamp()) + token_ttl_seconds
                token_expires_at = datetime.fromtimestamp(token_exp, tz=UTC)
                if membership.state == "pending":
                    runtime_epoch = (
                        await _activate_gpu_backend_membership_in_transaction(
                            db,
                            backend_registry_id,
                            gpu_resource_id=gpu_resource_id,
                            membership_epoch=membership_epoch,
                        )
                    )
                else:
                    runtime_epoch = fence.runtime_epoch_high_water
                control_epoch = await _advance_gpu_backend_fence_in_transaction(
                    db,
                    backend_registry_id,
                    "control_epoch",
                    gpu_resource_id=gpu_resource_id,
                    membership_epoch=membership_epoch,
                    token_expires_at=token_expires_at,
                )
                return GPULegacyAckPreparation(
                    action="issue",
                    backend=backend_snapshot,
                    backend_id=backend_registry_id,
                    resource_id=gpu_resource_id,
                    membership_epoch=membership_epoch,
                    boot_id=evidence.boot_id,
                    runtime_epoch=str(runtime_epoch),
                    control_epoch=str(control_epoch),
                    token_expires_at=token_expires_at,
                    proof_ready=False,
                )
    except _GPUProofInvalid as exc:
        await ensure_not_ready(required=False)
        raise GPULegacyAckBlockedError(exc.reason) from None


@dataclass(frozen=True)
class _GPURolloutControlEvidence:
    probe_started_at: datetime
    residency: _GPUProofResidency


def _validate_gpu_rollout_control_evidence(
    membership: GPUBackendMembership,
    fence: GPUBackendFence | None,
    registry: MLBackendRegistry | None,
    *,
    db_now: datetime,
    evidence_ttl: timedelta,
) -> _GPURolloutControlEvidence:
    if membership.state != "active":
        raise _GPUProofInvalid("membership_not_active")
    if fence is None:
        raise _GPUProofInvalid("fence_missing")
    if registry is None:
        raise _GPUProofInvalid("registry_missing")

    control_epoch_high_water = _strict_nonnegative_int64(
        fence.control_epoch_high_water,
        reason="control_epoch_high_water_invalid",
    )
    runtime_epoch_high_water = _strict_nonnegative_int64(
        fence.runtime_epoch_high_water,
        reason="runtime_epoch_high_water_invalid",
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
        or _registry_gpu_max_concurrency(registry.extra_params)
        != membership.max_concurrency
    ):
        raise _GPUProofInvalid("registry_claim_mismatch")

    raw_health = registry.health_meta
    raw_probe = (
        raw_health.get("gpu_arbiter_probe") if type(raw_health) is dict else None
    )
    raw_residency = raw_health.get("residency") if type(raw_health) is dict else None
    probe = _parse_gpu_proof_probe(raw_probe)
    actual_capability_sha256 = _health_managed_lifecycle_sha256(raw_health)
    if (
        probe.managed_lifecycle_sha256 is None
        or actual_capability_sha256 is None
        or actual_capability_sha256 != probe.managed_lifecycle_sha256
    ):
        raise _GPUProofInvalid("managed_lifecycle_capability_mismatch")
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
    db_now_utc = db_now.astimezone(UTC)
    if probe.observed_at > db_now_utc:
        raise _GPUProofInvalid("probe_from_future")
    if db_now_utc - probe.observed_at > evidence_ttl:
        raise _GPUProofInvalid("probe_expired")

    residency = _parse_gpu_proof_residency(raw_residency)
    identity = residency.identity
    if identity is None or residency.control_epoch is None:
        raise _GPUProofInvalid("residency_control_identity_missing")
    if (
        identity["backend_registry_id"] != str(membership.backend_registry_id)
        or identity["gpu_resource_id"] != membership.gpu_resource_id
    ):
        raise _GPUProofInvalid("residency_identity_mismatch")
    if int(residency.control_epoch) > control_epoch_high_water:
        raise _GPUProofInvalid("residency_control_epoch_ahead")
    if (
        residency.active_requests != 0
        or residency.builders != 0
        or residency.borrowers != 0
        or residency.draining
        or residency.state not in {"unloaded", "resident"}
        or residency.gpu_loaded is None
        or not all(item is not None for item in residency.pool_residencies)
    ):
        raise _GPUProofInvalid("rollout_control_residency_not_stably_idle")
    if residency.gpu_loaded is True and (
        residency.state != "resident"
        or not any(item is True for item in residency.pool_residencies)
    ):
        raise _GPUProofInvalid("rollout_control_residency_loaded_inconsistent")
    if residency.gpu_loaded is False and any(
        item is not False for item in residency.pool_residencies
    ):
        raise _GPUProofInvalid("rollout_control_residency_unloaded_inconsistent")
    return _GPURolloutControlEvidence(
        probe_started_at=probe.probe_started_at,
        residency=residency,
    )


def _rollout_control_intent_matches(
    fence: GPUBackendFence,
    membership: GPUBackendMembership,
    transition_id: uuid.UUID,
    operation: GPURolloutControlOperation,
    evidence: _GPURolloutControlEvidence,
) -> bool:
    return bool(
        fence.rollout_control_operation == operation
        and fence.rollout_control_transition_id == transition_id
        and fence.rollout_control_epoch == fence.control_epoch_high_water
        and fence.rollout_control_membership_epoch == membership.membership_epoch
        and fence.rollout_control_boot_id == evidence.residency.boot_id
        and fence.rollout_control_token_expires_at is not None
    )


def _rollout_control_acknowledged(
    fence: GPUBackendFence,
    operation: GPURolloutControlOperation,
    evidence: _GPURolloutControlEvidence,
) -> bool:
    token_expires_at = fence.rollout_control_token_expires_at
    control_epoch = fence.rollout_control_epoch
    if (
        token_expires_at is None
        or token_expires_at.tzinfo is None
        or control_epoch is None
        or evidence.probe_started_at <= token_expires_at.astimezone(UTC)
        or evidence.residency.control_epoch != str(control_epoch)
    ):
        return False
    residency = evidence.residency
    trusted_empty = (
        residency.state in {"unloaded", "resident"}
        and residency.gpu_loaded is False
        and all(item is False for item in residency.pool_residencies)
        and residency.generation is None
        and not residency.evictable
    )
    if operation == "reset":
        return residency.lifecycle_gate == "legacy" and trusted_empty
    if operation == "mode_enforce":
        return residency.lifecycle_gate == "enforce" and trusted_empty
    return residency.lifecycle_gate == "legacy" and not residency.evictable


async def prepare_gpu_backend_rollout_control(
    session_factory: GPUFenceSessionFactory,
    backend_registry_id: uuid.UUID,
    *,
    gpu_resource_id: str,
    membership_epoch: int,
    transition_id: uuid.UUID,
    target_gate: Literal["legacy", "enforce"],
    token_ttl_seconds: int = GPU_LEGACY_MODE_TOKEN_TTL_SECONDS,
    evidence_ttl: timedelta = _HEALTH_EVIDENCE_MAX_AGE,
    readiness_demoter: GPUReadinessDemoter | None = None,
) -> GPURolloutControlPreparation:
    """Prepare or replay one rollout-bound reset/mode control operation."""

    validate_gpu_resource_id(gpu_resource_id)
    if (
        not isinstance(membership_epoch, int)
        or isinstance(membership_epoch, bool)
        or membership_epoch <= 0
        or membership_epoch > _MAX_POSITIVE_INT64
    ):
        raise ValueError("membership_epoch must be a positive int64")
    if not isinstance(transition_id, uuid.UUID):
        raise ValueError("transition_id must be a UUID")
    if target_gate not in {"legacy", "enforce"}:
        raise ValueError("target_gate must be legacy or enforce")
    if (
        not isinstance(token_ttl_seconds, int)
        or isinstance(token_ttl_seconds, bool)
        or token_ttl_seconds <= 0
        or token_ttl_seconds > 300
    ):
        raise ValueError("token_ttl_seconds must be between 1 and 300")
    if evidence_ttl <= timedelta(0) or evidence_ttl > _PROOF_RESET_MAX_WINDOW:
        raise ValueError(
            "evidence_ttl must be positive and no greater than five minutes"
        )

    readiness_demoted = False

    async def ensure_not_ready(*, required: bool) -> None:
        nonlocal readiness_demoted
        if readiness_demoted:
            return
        if readiness_demoter is None:
            if required:
                raise _GPUProofInvalid("readiness_demotion_unavailable")
            return
        await readiness_demoter(gpu_resource_id)
        readiness_demoted = True

    try:
        async with session_factory() as db:
            async with db.begin():
                locked = await _lock_gpu_resource_proof_domain(
                    db,
                    gpu_resource_id,
                    wait_for_lock=False,
                )
                membership = next(
                    (
                        item
                        for item in locked.memberships
                        if item.backend_registry_id == backend_registry_id
                        and item.membership_epoch == membership_epoch
                    ),
                    None,
                )
                if membership is None:
                    raise _GPUProofInvalid("membership_changed")
                fence = locked.fences.get(backend_registry_id)
                registry = locked.registries.get(backend_registry_id)
                evidence = _validate_gpu_rollout_control_evidence(
                    membership,
                    fence,
                    registry,
                    db_now=locked.db_now,
                    evidence_ttl=evidence_ttl,
                )
                assert fence is not None
                assert registry is not None
                rollout = await db.scalar(
                    select(GPUArbiterRollout)
                    .where(GPUArbiterRollout.gpu_resource_id == gpu_resource_id)
                    .with_for_update()
                )
                expected_state = "promoting" if target_gate == "enforce" else "demoting"
                if (
                    rollout is None
                    or rollout.state != expected_state
                    or rollout.transition_id != transition_id
                    or (target_gate == "enforce" and rollout.target_mode != "enforce")
                    or (
                        target_gate == "legacy"
                        and rollout.target_mode not in {"off", "observe"}
                    )
                ):
                    raise _GPUProofInvalid("rollout_transition_changed")

                existing_operation = fence.rollout_control_operation
                existing_exact_reset = _rollout_control_intent_matches(
                    fence,
                    membership,
                    transition_id,
                    "reset",
                    evidence,
                )
                reset_acknowledged = existing_exact_reset and (
                    _rollout_control_acknowledged(fence, "reset", evidence)
                )
                if target_gate == "legacy":
                    operation: GPURolloutControlOperation = "mode_legacy"
                elif (
                    existing_operation == "mode_enforce"
                    and _rollout_control_intent_matches(
                        fence,
                        membership,
                        transition_id,
                        "mode_enforce",
                        evidence,
                    )
                ):
                    operation = "mode_enforce"
                elif (
                    reset_acknowledged or evidence.residency.lifecycle_gate == "enforce"
                ):
                    operation = "mode_enforce"
                else:
                    operation = "reset"

                intent_matches = _rollout_control_intent_matches(
                    fence,
                    membership,
                    transition_id,
                    operation,
                    evidence,
                )
                if intent_matches and _rollout_control_acknowledged(
                    fence,
                    operation,
                    evidence,
                ):
                    assert fence.rollout_control_epoch is not None
                    assert fence.rollout_control_token_expires_at is not None
                    return GPURolloutControlPreparation(
                        action="acknowledged",
                        operation=operation,
                        target_gate=target_gate,
                        backend=_snapshot_gpu_mode_backend(registry),
                        backend_id=backend_registry_id,
                        resource_id=gpu_resource_id,
                        membership_epoch=membership_epoch,
                        transition_id=transition_id,
                        boot_id=evidence.residency.boot_id,
                        control_epoch=str(fence.rollout_control_epoch),
                        token_expires_at=fence.rollout_control_token_expires_at,
                        reason="fresh_health_acknowledged",
                    )

                if intent_matches:
                    assert fence.rollout_control_epoch is not None
                    assert fence.rollout_control_token_expires_at is not None
                    expires_at = fence.rollout_control_token_expires_at
                    if locked.db_now.astimezone(UTC) <= expires_at.astimezone(UTC):
                        return GPURolloutControlPreparation(
                            action="issue",
                            operation=operation,
                            target_gate=target_gate,
                            backend=_snapshot_gpu_mode_backend(registry),
                            backend_id=backend_registry_id,
                            resource_id=gpu_resource_id,
                            membership_epoch=membership_epoch,
                            transition_id=transition_id,
                            boot_id=evidence.residency.boot_id,
                            control_epoch=str(fence.rollout_control_epoch),
                            token_expires_at=expires_at,
                            reason="control_intent_replay",
                        )
                    if evidence.probe_started_at <= expires_at.astimezone(UTC):
                        return GPURolloutControlPreparation(
                            action="awaiting_health",
                            operation=operation,
                            target_gate=target_gate,
                            backend=_snapshot_gpu_mode_backend(registry),
                            backend_id=backend_registry_id,
                            resource_id=gpu_resource_id,
                            membership_epoch=membership_epoch,
                            transition_id=transition_id,
                            boot_id=evidence.residency.boot_id,
                            control_epoch=str(fence.rollout_control_epoch),
                            token_expires_at=expires_at,
                            reason="control_health_not_after_token_horizon",
                        )

                residency = evidence.residency
                trusted_empty = (
                    residency.gpu_loaded is False
                    and all(item is False for item in residency.pool_residencies)
                    and residency.generation is None
                    and not residency.evictable
                )
                if operation == "reset":
                    if residency.lifecycle_gate != "legacy" or residency.evictable:
                        raise _GPUProofInvalid("reset_requires_legacy_gate")
                elif operation == "mode_enforce":
                    if not trusted_empty:
                        raise _GPUProofInvalid("enforce_mode_requires_reset_empty")
                    if residency.lifecycle_gate == "legacy" and not reset_acknowledged:
                        raise _GPUProofInvalid("enforce_mode_requires_reset_ack")
                elif residency.lifecycle_gate not in {"enforce", "legacy"}:
                    raise _GPUProofInvalid("legacy_mode_source_gate_invalid")

                horizon = fence.token_expiry_high_water
                if horizon is None:
                    raise _GPUProofInvalid("token_horizon_missing")
                if horizon.tzinfo is None or horizon.utcoffset() is None:
                    raise _GPUProofInvalid("token_horizon_invalid")
                if evidence.probe_started_at <= horizon.astimezone(UTC):
                    return GPURolloutControlPreparation(
                        action="awaiting_health",
                        operation=operation,
                        target_gate=target_gate,
                        backend=_snapshot_gpu_mode_backend(registry),
                        backend_id=backend_registry_id,
                        resource_id=gpu_resource_id,
                        membership_epoch=membership_epoch,
                        transition_id=transition_id,
                        boot_id=evidence.residency.boot_id,
                        control_epoch=str(fence.control_epoch_high_water),
                        token_expires_at=horizon,
                        reason="control_health_not_after_token_horizon",
                    )
                await ensure_not_ready(required=True)
                token_exp = int(locked.db_now.timestamp()) + token_ttl_seconds
                token_expires_at = datetime.fromtimestamp(token_exp, tz=UTC)
                control_epoch = await _advance_gpu_backend_fence_in_transaction(
                    db,
                    backend_registry_id,
                    "control_epoch",
                    gpu_resource_id=gpu_resource_id,
                    membership_epoch=membership_epoch,
                    token_expires_at=token_expires_at,
                )
                fence.rollout_control_operation = operation
                fence.rollout_control_transition_id = transition_id
                fence.rollout_control_epoch = control_epoch
                fence.rollout_control_membership_epoch = membership_epoch
                fence.rollout_control_boot_id = evidence.residency.boot_id
                fence.rollout_control_token_expires_at = token_expires_at
                await db.flush()
                return GPURolloutControlPreparation(
                    action="issue",
                    operation=operation,
                    target_gate=target_gate,
                    backend=_snapshot_gpu_mode_backend(registry),
                    backend_id=backend_registry_id,
                    resource_id=gpu_resource_id,
                    membership_epoch=membership_epoch,
                    transition_id=transition_id,
                    boot_id=evidence.residency.boot_id,
                    control_epoch=str(control_epoch),
                    token_expires_at=token_expires_at,
                    reason="control_intent_created",
                )
    except _GPUProofInvalid as exc:
        await ensure_not_ready(required=False)
        raise GPURolloutControlBlockedError(exc.reason) from None


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
        not_evict_before_ms=0,
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
    residency_cooldown_ms: int,
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
        actual_capability_sha256 = _health_managed_lifecycle_sha256(raw_health)
        if probe.managed_lifecycle_sha256 is None or actual_capability_sha256 is None:
            raise _GPUProofInvalid("managed_lifecycle_capability_missing")
        if actual_capability_sha256 != probe.managed_lifecycle_sha256:
            raise _GPUProofInvalid("managed_lifecycle_capability_mismatch")
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
        if horizon is None:
            raise _GPUProofInvalid("token_horizon_missing")
        if horizon.tzinfo is None or horizon.utcoffset() is None:
            raise _GPUProofInvalid("token_horizon_invalid")
        if probe.probe_started_at <= horizon.astimezone(UTC):
            raise _GPUProofInvalid("probe_not_after_token_horizon")

        residency = _parse_gpu_proof_residency(raw_residency)
        if residency.lifecycle_gate != "enforce":
            raise _GPUProofInvalid("lifecycle_gate_not_enforced")
        identity = residency.identity
        if identity is None:
            raise _GPUProofInvalid("residency_identity_missing")
        if (
            identity["backend_registry_id"] != str(membership.backend_registry_id)
            or identity["gpu_resource_id"] != membership.gpu_resource_id
        ):
            raise _GPUProofInvalid("residency_identity_mismatch")
        if residency.control_epoch is None:
            raise _GPUProofInvalid("residency_control_epoch_missing")
        if (
            residency.generation is not None
            and int(residency.generation) > generation_high_water
        ):
            raise _GPUProofInvalid("residency_generation_ahead")
        residency_control_epoch = int(residency.control_epoch)
        if residency_control_epoch > control_epoch_high_water:
            raise _GPUProofInvalid("residency_control_epoch_ahead")
        if residency_control_epoch < control_epoch_high_water:
            raise _GPUProofInvalid("residency_control_epoch_stale")

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
                    # The capability is challenge-bound, but declaration alone
                    # does not prove activation or signer-key acceptance.  Keep
                    # proof recovery non-evictable until signed promotion.
                    evictable=False,
                    max_concurrency=membership.max_concurrency,
                    reservation_lease_id=None,
                    reservation_owner_id=None,
                    last_used_at_ms=observed_at_ms,
                    not_evict_before_ms=(
                        context.prepared_at_ms + residency_cooldown_ms
                    ),
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
        "not_evict_before_ms": allocation.not_evict_before_ms,
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
    readiness_blocker: str | None = None,
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
    if readiness_blocker is not None and (
        not isinstance(readiness_blocker, str)
        or not readiness_blocker
        or len(readiness_blocker) > 256
    ):
        raise ValueError("readiness_blocker must be a non-empty short string")

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
                    residency_cooldown_ms=(
                        config.gpu_arbiter_residency_cooldown_seconds * 1000
                    ),
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
                readiness_blocker is None
                and domain_matches
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
    force_proof_reset: bool = False,
    readiness_blocker: str | None = None,
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
    if not isinstance(force_proof_reset, bool):
        raise ValueError("force_proof_reset must be a boolean")
    if readiness_blocker is not None and (
        not isinstance(readiness_blocker, str)
        or not readiness_blocker
        or len(readiness_blocker) > 256
    ):
        raise ValueError("readiness_blocker must be a non-empty short string")

    context = await store.prepared_proof_reset(resource_id)
    action: Literal["already_ready", "bootstrap", "repair", "resume_prepared"] = (
        "resume_prepared" if context is not None else "repair"
    )
    begin_result: GPUReconcileResult | None = None

    if context is None and readiness_blocker is not None:
        blocked = await store.mark_card_not_ready(
            resource_id,
            allocatable_mb,
            reason=readiness_blocker,
        )
        return GPUResourceRepairResult(
            resource_id=resource_id,
            action="repair",
            status=blocked.status,
            ready=False,
            reason=blocked.reason,
            ledger_revision=blocked.ledger_revision,
            ledger_incarnation=blocked.ledger_incarnation,
            committed_mb=blocked.committed_mb,
        )

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
                        not force_proof_reset
                        and snapshot.ready
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
        readiness_blocker=readiness_blocker,
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
