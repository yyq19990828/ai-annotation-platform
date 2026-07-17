"""Compatibility facade for the Data Manager entity filter compiler.

The implementation has moved to :mod:`app.services.data_management.entity_filters` as
part of the v0.23.0 service-domain modularization. Pure re-export facade.
"""

from __future__ import annotations

from app.services.data_management.entity_filters import (  # noqa: F401
    builtin_entity_views,
    compile_entity_filter,
    count_entity_filters,
    invalid_entity_filter_fields,
    validate_entity_view,
)

__all__ = [
    "builtin_entity_views",
    "compile_entity_filter",
    "count_entity_filters",
    "invalid_entity_filter_fields",
    "validate_entity_view",
]
