"""Compatibility facade for the export davis module.

The implementation has moved to :mod:`app.services.exporting.davis` as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.exporting.davis import (
    DAVIS_MAX_OBJECTS,
    build_davis_palette_png,
    davis_palette,
    derive_davis_object_ids,
)

__all__ = [
    "DAVIS_MAX_OBJECTS",
    "build_davis_palette_png",
    "davis_palette",
    "derive_davis_object_ids",
]
