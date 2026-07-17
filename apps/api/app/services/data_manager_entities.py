"""Compatibility facade for the Data Manager entities service.

The implementation has moved to :mod:`app.services.data_management.entities` as part of
the v0.23.0 service-domain modularization. Pure re-export facade.
"""

from __future__ import annotations

from app.services.data_management.entities import (  # noqa: F401
    COMPACT_TRACK_TYPES,
    DataManagerObjectService,
    object_from_row,
    task_dataset_item_id_expr,
)

__all__ = [
    "COMPACT_TRACK_TYPES",
    "DataManagerObjectService",
    "object_from_row",
    "task_dataset_item_id_expr",
]
