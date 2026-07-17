"""Compatibility facade for the Data Manager service.

The implementation has moved to :mod:`app.services.data_management.service` (plus the
extracted :mod:`schema` and :mod:`task_metrics` primitives) as part of the v0.23.0
service-domain modularization. This module re-exports the previous public symbols with
unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.data_management.service import (  # noqa: F401
    LOW_CONFIDENCE_THRESHOLD,
    DataManagerService,
    build_data_manager_schema,
    low_confidence_pending_prediction_shapes_expr,
    pending_prediction_shapes_expr,
    pending_tracker_jobs_expr,
)

__all__ = [
    "LOW_CONFIDENCE_THRESHOLD",
    "DataManagerService",
    "build_data_manager_schema",
    "low_confidence_pending_prediction_shapes_expr",
    "pending_prediction_shapes_expr",
    "pending_tracker_jobs_expr",
]
