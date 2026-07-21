"""Legacy ack and rollout control preparation for durable GPU memberships.

Moved verbatim from the legacy aggregate ``gpu_arbiter.py``. This module owns the
boot-scoped legacy-ack evidence validation and preparation, the reset/mode rollout
control evidence validation and preparation, and their shared durable/runtime
helpers (_canonical_gpu_backend_endpoint, _fresh_challenge_bound_boot_id,
_lock_gpu_membership_promotion_barrier, _validate_gpu_membership_aliases).

Depends on contracts, fences, proofs, config DB models and SQLAlchemy. Must not
depend on ml_client, dispatch, membership_activation, rollout_control or retirement.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field as dataclass_field
from datetime import UTC, datetime, timedelta
import ipaddress
import posixpath
import re
import socket
import uuid
from typing import Literal

import httpx
import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.gpu_arbiter_rollout import GPUArbiterRollout
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.services.gpu_arbitration.fences import (
    GPUFenceSessionFactory,
    _activate_gpu_backend_membership_in_transaction,
    _advance_gpu_backend_fence_in_transaction,
)
from app.services.gpu_arbitration.policy import (
    _HEALTH_EVIDENCE_MAX_AGE,
    _MAX_POSITIVE_INT64,
)
from app.services.gpu_arbitration.proofs import (
    GPU_LEGACY_MODE_TOKEN_TTL_SECONDS,
    _GPUProofInvalid,
    _GPUProofResidency,
    _PROOF_RESET_MAX_WINDOW,
    _health_managed_lifecycle_sha256,
    _lock_gpu_resource_proof_domain,
    _parse_gpu_proof_probe,
    _parse_gpu_proof_residency,
    _registry_gpu_max_concurrency,
    _snapshot_gpu_mode_backend,
    _strict_nonnegative_int64,
    _validate_stable_legacy_residency,
)
from app.utils.gpu_resource import validate_gpu_resource_id


logger = structlog.get_logger(__name__)

_GPU_HEALTH_CHALLENGE_RE = re.compile(r"[0-9a-f]{64}\\Z")
_SHA256_HEX_RE = re.compile(r"[0-9a-f]{64}\\Z")

GPUReadinessDemoter = Callable[[str], Awaitable[None]]
GPUFenceCounter = Literal["generation", "control_epoch"]


class GPULegacyAckBlockedError(RuntimeError):
    """Cached evidence cannot authorize a legacy-mode membership handshake."""

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


GPURolloutControlOperation = Literal["reset", "mode_enforce", "mode_legacy"]


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
