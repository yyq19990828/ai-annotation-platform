"""Compatibility facade for the export lidar module.

The implementation has moved to :mod:`app.services.exporting.lidar` as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.exporting.lidar import (
    BoxExportAttrs,
    LidarFrameExportCtx,
    build_kitti_lidar_label_lines,
    build_nuscenes_frame_records,
    build_pointmask_label_bytes,
    category_map_json,
)

__all__ = [
    "BoxExportAttrs",
    "LidarFrameExportCtx",
    "build_kitti_lidar_label_lines",
    "build_nuscenes_frame_records",
    "build_pointmask_label_bytes",
    "category_map_json",
]
