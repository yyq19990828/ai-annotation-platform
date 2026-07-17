"""Compatibility facade for the GPU arbitration Redis ledger.

The implementation has moved to :mod:`app.services.gpu_arbitration.ledger` (types,
keys, validation, Lua scripts and the ``GPUArbiterStore`` client) as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy ``from app.services.gpu_arbiter_store
import ...`` paths keep working.

This is a pure re-export facade: it declares no logic and uses no ``import *``.
"""

from __future__ import annotations

from app.services.gpu_arbitration.ledger.keys import GPUArbiterKeys, gpu_arbiter_keys
from app.services.gpu_arbitration.ledger.store import GPUArbiterStore
from app.services.gpu_arbitration.ledger.types import (
    GPU_COLD_ADMISSION_OPERATION,
    GPU_EVICTION_OPERATION,
    GPUAdmissionResult,
    GPUAllocation,
    GPUAllocationState,
    GPUArbiterStoreError,
    GPUBackendDomainEvolutionResult,
    GPUBackendDomainMember,
    GPUBackendMembershipState,
    GPUCardSnapshot,
    GPUEvictionBranchResult,
    GPUIdleEvictionResult,
    GPULeaseMutationResult,
    GPUProofResetCAS,
    GPUProofResetContext,
    GPUQueueResult,
    GPUQueueTicket,
    GPUReconcileLeaseCleanup,
    GPUReconcileResult,
    GPURequestLease,
    GPURequestLeaseState,
    GPUTombstoneGCReceipt,
    GPUTombstoneGCResult,
    GPUTransitionOwnerResult,
    GPUTransitionResult,
)
from app.services.gpu_arbitration.ledger.validation import (
    normalize_gpu_backend_max_concurrency,
)

__all__ = [
    "GPU_COLD_ADMISSION_OPERATION",
    "GPU_EVICTION_OPERATION",
    "GPUAdmissionResult",
    "GPUAllocation",
    "GPUAllocationState",
    "GPUArbiterKeys",
    "GPUArbiterStore",
    "GPUArbiterStoreError",
    "GPUBackendDomainEvolutionResult",
    "GPUBackendDomainMember",
    "GPUBackendMembershipState",
    "GPUCardSnapshot",
    "GPUEvictionBranchResult",
    "GPUIdleEvictionResult",
    "GPULeaseMutationResult",
    "GPUProofResetCAS",
    "GPUProofResetContext",
    "GPUQueueResult",
    "GPUQueueTicket",
    "GPUReconcileLeaseCleanup",
    "GPUReconcileResult",
    "GPURequestLease",
    "GPURequestLeaseState",
    "GPUTombstoneGCReceipt",
    "GPUTombstoneGCResult",
    "GPUTransitionOwnerResult",
    "GPUTransitionResult",
    "gpu_arbiter_keys",
    "normalize_gpu_backend_max_concurrency",
]
