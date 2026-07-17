"""Compatibility facade for the task views service.

The implementation has moved to :mod:`app.services.data_management.views` (and the
filter/visibility primitives to :mod:`data_management.task_filters`) as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.data_management.task_filters import (  # noqa: F401
    apply_task_visibility,
    compile_filter,
    visible_tasks_stmt,
)
from app.services.data_management.views import (  # noqa: F401
    DEFAULT_COLUMNS,
    TaskViewService,
    apply_sort,
    builtin_view_keys,
    builtin_views,
    compile_annotation_match_filter,
    invalid_filter_fields,
    validate_columns,
    validate_filter,
    validate_sort,
)

__all__ = [
    "DEFAULT_COLUMNS",
    "TaskViewService",
    "apply_sort",
    "apply_task_visibility",
    "builtin_view_keys",
    "builtin_views",
    "compile_annotation_match_filter",
    "compile_filter",
    "invalid_filter_fields",
    "validate_columns",
    "validate_filter",
    "validate_sort",
    "visible_tasks_stmt",
]
