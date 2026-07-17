"""Compatibility facade for the GPU admission signer.

The implementation moved to :mod:`app.services.gpu_arbitration.signing`. This module
re-exports the frozen public symbols so existing callers keep importing
``app.services.gpu_admission_signer`` unchanged.
"""

from __future__ import annotations

from app.services.gpu_arbitration.signing import (
    GPUAdmissionSignerConfigError,
    GPUAdmissionTokenSigner,
)

__all__ = [
    "GPUAdmissionSignerConfigError",
    "GPUAdmissionTokenSigner",
]
