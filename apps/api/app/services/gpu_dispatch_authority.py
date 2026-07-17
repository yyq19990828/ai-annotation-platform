"""Compatibility facade for the GPU dispatch authority.

The implementation moved to :mod:`app.services.gpu_arbitration.dispatch`.
"""

from __future__ import annotations

from app.services.gpu_arbitration.dispatch import build_gpu_dispatch_context_factory

__all__ = ["build_gpu_dispatch_context_factory"]
