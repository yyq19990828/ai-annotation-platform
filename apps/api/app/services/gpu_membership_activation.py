"""Compatibility facade for GPU membership activation.

The implementation moved to :mod:`app.services.gpu_arbitration.membership_activation`.
"""

from __future__ import annotations

from app.services.gpu_arbitration.membership_activation import (
    GPUMembershipPromotionResult,
    promote_gpu_backend_membership,
    promote_gpu_resource_memberships,
)

__all__ = [
    "GPUMembershipPromotionResult",
    "promote_gpu_backend_membership",
    "promote_gpu_resource_memberships",
]
