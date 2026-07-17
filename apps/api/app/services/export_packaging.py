"""Compatibility facade for the export packaging module.

The implementation has moved to :mod:`app.services.exporting.packaging` as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.exporting.packaging import (
    ALL_EXPORT_TARGETS,
    IMAGE_EXPORT_TARGETS,
    LIDAR_EXPORT_TARGETS,
    PRESIGN_EXPIRES_SECONDS,
    VIDEO_EXPORT_FORMATS,
    YOLO_TARGETS,
    build_export_zip,
    clean_export_targets,
    relative_path_from_file_path,
)

__all__ = [
    "ALL_EXPORT_TARGETS",
    "IMAGE_EXPORT_TARGETS",
    "LIDAR_EXPORT_TARGETS",
    "PRESIGN_EXPIRES_SECONDS",
    "VIDEO_EXPORT_FORMATS",
    "YOLO_TARGETS",
    "build_export_zip",
    "clean_export_targets",
    "relative_path_from_file_path",
]
