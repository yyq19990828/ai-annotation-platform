"""ADR-0049 GPU claims, durable fences, proof recovery, and shadow arbitration.

P2b evaluates non-authoritative ``would-*`` decisions from a fresh DB snapshot;
P3a/P3c add durable fencing, exact membership, token-expiry high-water marks, and
the database-locked consumer for Redis proof reset.  Backend network probes remain
outside every database lock in this module.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field as dataclass_field
from datetime import UTC, datetime, timedelta
import hashlib
import json
import re
import secrets
from typing import Any, Literal
import uuid

import structlog
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import GPUArbiterMode, Settings, settings
from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.schemas.ml_backend import GPUBackendConfigStatus, GPUConfigDiagnostic
from app.services.gpu_arbitration.ledger import (
    GPUAllocation,
    GPUAllocationState,
    GPUArbiterStore,
    GPUArbiterStoreError,
    GPUBackendDomainMember,
    GPUCardSnapshot,
    GPUProofResetContext,
    GPUReconcileResult,
)
from app.utils.gpu_resource import validate_gpu_resource_id

# The following symbols now live in gpu_arbitration.contracts / .policy (extracted to
# break the gpu_arbiter <-> ml_client cycle). They are re-exported here so existing
# ``from app.services.gpu_arbiter import ...`` call sites keep working; the ``noqa`` is
# intentional for these backward-compat re-exports.
from app.services.gpu_arbitration.contracts import (  # noqa: F401
    GPUDispatchContextFactory,
    GPUDispatchGrant,
    GPUDispatchOperation,
    GPUDispatchOutcome,
    GPUDispatchOutcomeChannel,
    GPUDispatchOutcomeKind,
    GPUDispatchRequest,
    GPUDispatchUncertainReason,
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUShadowSessionFactory,
    _GPU_ARBITER_DISPATCH_ERROR_STATUS,
    _GPU_ARBITER_RETRY_AFTER_REQUIRED,
)
from app.services.gpu_arbitration.policy import (  # noqa: F401
    GPUClaimConfigurationError,
    GPUShadowCandidate,
    GPUShadowDecision,
    _CANONICAL_POSITIVE_INT64_RE,
    _HEALTH_EVIDENCE_FUTURE_SKEW,
    _HEALTH_EVIDENCE_MAX_AGE,
    _MAX_POSITIVE_INT64,
    _as_mapping,
    _canonical_generation,
    _claim_shape_diagnostics,
    _diag,
    _health_evidence_is_trusted,
    _is_explicit_cpu_backend,
    _is_strict_zero,
    _requires_gpu_claim,
    _safe_shadow_candidate,
    _shadow_reject_for_claim,
    _trusted_health_meta,
    any_gpu_resource_effectively_enforced,
    backend_is_trusted_explicit_cpu,
    effective_gpu_arbiter_mode,
    evaluate_gpu_shadow_decision,
    gpu_shadow_observation_enabled,
    record_gpu_shadow_dispatch,
    strict_gpu_loaded_evidence,
    validate_gpu_claim,
)


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
_GPU_HEALTH_CHALLENGE_RE = re.compile(r"[0-9a-f]{64}\Z")
_SHA256_HEX_RE = re.compile(r"[0-9a-f]{64}\Z")


# Fence type aliases now live in gpu_arbitration.fences (moved in v0.23.1 P2).
# Re-exported here so existing ``from app.services.gpu_arbiter import`` call sites
# keep working; the ``noqa`` is intentional for these backward-compat re-exports.
from app.services.gpu_arbitration.fences import (  # noqa: F401,E402
    GPUFenceCounter,
    GPUFenceExhaustedError,
    GPUFenceMembershipError,
    GPUFenceSessionFactory,
    _activate_gpu_backend_membership_in_transaction,
    _advance_gpu_backend_fence_in_transaction,
    _lock_gpu_backend_membership,
    _raise_fence_update_failure,
    _record_gpu_backend_token_expiry_in_transaction,
    _validate_token_expiry,
    activate_gpu_backend_membership,
    advance_gpu_backend_fence,
    read_gpu_backend_fence,
    record_gpu_backend_token_expiry,
)

# Dispatch failure record helpers moved to gpu_arbitration.contracts (v0.23.1 P2).
from app.services.gpu_arbitration.contracts import (  # noqa: F401,E402
    gpu_arbiter_failure_record,
    summarize_gpu_arbiter_failures,
)

# Proof schema, runtime subjects, terminal commits and shared proof primitives
# moved to gpu_arbitration.proofs (v0.23.1 P3). Re-exported for backward compat.
from app.services.gpu_arbitration.proofs import (  # noqa: F401,E402
    GPUBusyEvictionRuntimeSubjectError,
    GPUColdRuntimeSubject,
    GPUColdRuntimeSubjectError,
    GPUColdTerminalCommitResult,
    GPUEvictionCancelRuntimeSubjectError,
    GPUEvictionCommitResult,
    GPUEvictionDrainHealth,
    GPUIdleEvictionRuntimeSubject,
    GPUIdleEvictionRuntimeSubjectError,
    GPUPreparedColdRuntimeSubject,
    GPUPreparedEvictionCancelRuntimeSubject,
    GPUPreparedIdleEvictionRuntimeSubject,
    GPUResidentRuntimeSubject,
    GPUResidentRuntimeSubjectError,
    _GPUProofEvaluation,
    _GPUProofInvalid,
    _GPUProofResidency,
    _LockedGPUProofDomain,
    _canonical_proof_timestamp,
    _datetime_to_epoch_ms,
    _gpu_domain_members,
    _health_managed_lifecycle_sha256,
    _lock_gpu_resource_proof_domain,
    _optional_datetime_document,
    _parse_gpu_proof_probe,
    _parse_gpu_proof_residency,
    _PROOF_RESET_MAX_WINDOW,
    _registry_gpu_max_concurrency,
    _snapshot_gpu_mode_backend,
    _strict_nonnegative_int64,
    _validate_stable_legacy_residency,
    GPU_LEGACY_MODE_TOKEN_TTL_SECONDS,
    commit_gpu_cold_terminal_from_health,
    commit_gpu_eviction_cancel_from_health,
    commit_gpu_eviction_phase_from_health,
    prepare_gpu_cold_runtime_generation,
    prepare_gpu_eviction_cancel_runtime_generation,
    prepare_gpu_idle_eviction_runtime_generation,
    read_gpu_busy_eviction_runtime_subject,
    read_gpu_cold_runtime_subject,
    read_gpu_eviction_cancel_runtime_subject,
    read_gpu_eviction_drain_health,
    read_gpu_idle_eviction_runtime_subject,
    read_gpu_resident_runtime_subject,
    record_gpu_resident_runtime_token_expiry,
)

# Legacy ack + rollout control preparation moved to
# gpu_arbitration.control_preparation (v0.23.1 P4). Re-exported for backward compat.
from app.services.gpu_arbitration.control_preparation import (  # noqa: F401,E402
    GPULegacyAckBlockedError,
    GPULegacyAckPreparation,
    GPUReadinessDemoter,
    GPURolloutControlBlockedError,
    GPURolloutControlPreparation,
    prepare_gpu_backend_legacy_ack,
    prepare_gpu_backend_rollout_control,
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


def unregistered_gpu_loading_blocked(*, config: Settings = settings) -> bool:
    """Block raw loading URLs once any resource is effectively enforced."""

    return any_gpu_resource_effectively_enforced(config=config)


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
