"""Compatibility facade for the durable GPU rollout state.

The implementation moved to :mod:`app.services.gpu_arbitration.rollout_state`. This
module re-exports the frozen public symbols so existing callers keep importing
``app.services.gpu_arbiter_rollout`` unchanged.
"""

from __future__ import annotations

from app.services.gpu_arbitration.rollout_state import (
    GPUArbiterRolloutConflict,
    GPUArbiterRolloutDecision,
    GPUArbiterRolloutSnapshot,
    GPUArbiterRolloutUnavailable,
    begin_gpu_arbiter_rollout,
    block_gpu_arbiter_rollout,
    classify_gpu_arbiter_rollout,
    complete_gpu_arbiter_rollout,
    gpu_arbiter_rollout_snapshot,
    gpu_rollout_boundary_active,
    read_gpu_arbiter_rollout,
    read_gpu_arbiter_rollouts,
    resolve_gpu_arbiter_rollout,
)

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
