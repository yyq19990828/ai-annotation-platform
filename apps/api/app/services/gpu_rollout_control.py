"""Compatibility facade for GPU rollout control.

The implementation moved to :mod:`app.services.gpu_arbitration.rollout_control`.
"""

from __future__ import annotations

from app.services.gpu_arbitration.rollout_control import (
    GPURolloutControlResult,
    advance_gpu_backend_rollout_control,
    advance_gpu_resource_rollout_control,
)

__all__ = [
    "GPURolloutControlResult",
    "advance_gpu_backend_rollout_control",
    "advance_gpu_resource_rollout_control",
]
