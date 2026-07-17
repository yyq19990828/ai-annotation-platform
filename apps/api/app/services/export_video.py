"""Compatibility facade for the export video module.

The implementation has moved to :mod:`app.services.exporting.video` as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.exporting.video import (
    VIDEO_SINGLE_FRAME_GEOMETRY_TYPES,
    VIDEO_TRACK_GEOMETRY_TYPES,
    build_coco_frames_seg,
    build_kitti_labels,
    build_mot_gt,
    build_mot_seqinfo,
    build_yolo_frame_det_labels,
    build_yolo_frame_seg_labels,
    effective_fps,
    points_to_bbox_norm,
    single_frame_bbox,
    source_to_grid,
    track_grid_rows,
    yolo_seg_line,
)

__all__ = [
    "VIDEO_SINGLE_FRAME_GEOMETRY_TYPES",
    "VIDEO_TRACK_GEOMETRY_TYPES",
    "build_coco_frames_seg",
    "build_kitti_labels",
    "build_mot_gt",
    "build_mot_seqinfo",
    "build_yolo_frame_det_labels",
    "build_yolo_frame_seg_labels",
    "effective_fps",
    "points_to_bbox_norm",
    "single_frame_bbox",
    "source_to_grid",
    "track_grid_rows",
    "yolo_seg_line",
]
