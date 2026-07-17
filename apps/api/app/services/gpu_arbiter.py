"""Compatibility facade for the GPU arbitration domain.

The implementation has been split into focused modules under
:mod:`app.services.gpu_arbitration`:

- :mod:`gpu_arbitration.contracts` — dispatch request/grant/error, failure records
- :mod:`gpu_arbitration.policy` — mode, claim, shadow decision, DB-backed record
- :mod:`gpu_arbitration.fences` — durable fence primitives and high-water marks
- :mod:`gpu_arbitration.proofs` — proof schema, runtime subjects, terminal commits
- :mod:`gpu_arbitration.control_preparation` — legacy ack + rollout control prep
- :mod:`gpu_arbitration.reconciliation` — proof reset, repair, runtime observation
- :mod:`gpu_arbitration.retirement` — retired probe, tombstone GC collection
- :mod:`gpu_arbitration.diagnostics` — unregistered logging, config/resource diag
- :mod:`gpu_arbitration.ledger` — Redis ledger (unchanged since v0.23.0)

This module re-exports every public symbol so existing
``from app.services.gpu_arbiter import ...`` call sites keep working unchanged.
"""

from __future__ import annotations

# Cycle-safe contracts / policy (extracted in v0.23.0).
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
    gpu_arbiter_failure_record,
    summarize_gpu_arbiter_failures,
    _GPU_ARBITER_DISPATCH_ERROR_STATUS,
    _GPU_ARBITER_RETRY_AFTER_REQUIRED,
)
from app.services.gpu_arbitration.policy import (  # noqa: F401
    GPUClaimConfigurationError,
    GPUShadowCandidate,
    GPUShadowDecision,
    any_gpu_resource_effectively_enforced,
    backend_is_trusted_explicit_cpu,
    effective_gpu_arbiter_mode,
    evaluate_gpu_shadow_decision,
    gpu_shadow_observation_enabled,
    record_gpu_shadow_dispatch,
    strict_gpu_loaded_evidence,
    validate_gpu_claim,
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
    _CANONICAL_POSITIVE_INT64_RE,
    _HEALTH_EVIDENCE_FUTURE_SKEW,
    _HEALTH_EVIDENCE_MAX_AGE,
    _MAX_POSITIVE_INT64,
)

# Fence primitives (v0.23.1 P2).
from app.services.gpu_arbitration.fences import (  # noqa: F401
    GPUFenceCounter,
    GPUFenceExhaustedError,
    GPUFenceMembershipError,
    GPUFenceSessionFactory,
    GPUReadinessDemoter,
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

# Proof schema, runtime subjects, terminal commits (v0.23.1 P3).
from app.services.gpu_arbitration.proofs import (  # noqa: F401
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
    GPU_LEGACY_MODE_TOKEN_TTL_SECONDS,
    _GPUProofEvaluation,
    _GPUProofInvalid,
    _GPUProofResidency,
    _LockedGPUProofDomain,
    _PROOF_RESET_MAX_WINDOW,
    _canonical_proof_timestamp,
    _datetime_to_epoch_ms,
    _gpu_domain_members,
    _health_managed_lifecycle_sha256,
    _lock_gpu_resource_proof_domain,
    _optional_datetime_document,
    _parse_gpu_proof_probe,
    _parse_gpu_proof_residency,
    _registry_gpu_max_concurrency,
    _snapshot_gpu_mode_backend,
    _strict_nonnegative_int64,
    _validate_stable_legacy_residency,
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

# Legacy ack + rollout control preparation (v0.23.1 P4).
from app.services.gpu_arbitration.control_preparation import (  # noqa: F401
    GPULegacyAckBlockedError,
    GPULegacyAckPreparation,
    GPURolloutControlBlockedError,
    GPURolloutControlPreparation,
    prepare_gpu_backend_legacy_ack,
    prepare_gpu_backend_rollout_control,
)

# Reconciliation: proof reset, repair, runtime observation (v0.23.1 P5).
from app.services.gpu_arbitration.reconciliation import (  # noqa: F401
    GPUResourceRepairResult,
    GPUResourceRuntimeObservation,
    commit_gpu_proof_reset_from_health,
    disabled_gpu_resource_runtime_observation,
    observe_gpu_resource_runtime,
    repair_gpu_resource,
)

# Retirement: retired probe, tombstone GC (v0.23.1 P5).
from app.services.gpu_arbitration.retirement import (  # noqa: F401
    GPURetiredLiveProof,
    GPURetiredProbeResult,
    GPUTombstoneCollectionResult,
    collect_gpu_backend_tombstone,
    probe_retired_gpu_membership,
)

# Diagnostics: unregistered logging, config/resource summaries (v0.23.1 P5).
from app.services.gpu_arbitration.diagnostics import (  # noqa: F401
    build_backend_gpu_config_status,
    build_resource_summaries,
    claimed_budget_by_resource,
    record_unregistered_gpu_shadow_dispatch,
    unregistered_gpu_loading_blocked,
)
