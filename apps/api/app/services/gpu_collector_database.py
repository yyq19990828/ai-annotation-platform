"""Compatibility facade for the GPU collector database boundary.

The implementation moved to :mod:`app.services.gpu_arbitration.collector_database`.
This module re-exports the frozen public symbols so existing callers keep importing
``app.services.gpu_collector_database`` unchanged.
"""

from __future__ import annotations

from app.services.gpu_arbitration.collector_database import (
    GPUCollectorDatabase,
    GPUCollectorDatabaseConfigError,
    load_gpu_collector_database_url,
    open_gpu_collector_database,
    validate_gpu_collector_role_boundary,
)

__all__ = [
    "GPUCollectorDatabase",
    "GPUCollectorDatabaseConfigError",
    "load_gpu_collector_database_url",
    "open_gpu_collector_database",
    "validate_gpu_collector_role_boundary",
]
