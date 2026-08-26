"""LiDAR standard training-format serializers.

Pure serializer helpers for point-cloud exports. They intentionally do not
depend on routers or database sessions so packaging code can test and reuse
them directly.
"""

from __future__ import annotations

import json
import math
import struct
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.db.models.annotation import Annotation
from app.schemas._jsonb_types import SensorCalibration
from app.services.axis_convention import PsrDict
from app.services.pointcloud_projection import (
    NEAR_PLANE as _NEAR_PLANE,
    apply_camera_point as _apply_camera_point,
    apply_camera_vector as _apply_camera_vector,
    box_iso_geometry as _box_iso_geometry,
    clamp as _clamp,
    clipped_projection_bbox as _clipped_projection_bbox,
    iso_to_source as _iso_to_source,
    pixel_bbox,
)


@dataclass(frozen=True)
class BoxExportAttrs:
    occluded: int = 0


@dataclass(frozen=True)
class LidarCameraExportCtx:
    role: str
    name: str
    calibration: SensorCalibration
    width: int
    height: int


@dataclass(frozen=True)
class LidarFrameExportCtx:
    task_id: uuid.UUID
    frame_key: str
    annotations: list[Annotation]
    axis_convention: str
    cameras: dict[str, LidarCameraExportCtx] = field(default_factory=dict)


@dataclass(frozen=True)
class KittiSkippedAnnotation:
    annotation_id: str
    class_name: str
    reason: str


@dataclass(frozen=True)
class KittiFrameExportResult:
    lines: list[str]
    skipped: list[KittiSkippedAnnotation]
    manual_bbox_count: int = 0
    derived_bbox_count: int = 0


def _wrap_pi(value: float) -> float:
    while value > math.pi:
        value -= math.tau
    while value <= -math.pi:
        value += math.tau
    return value


def _map_box_attributes(attrs: dict | None) -> BoxExportAttrs:
    raw = attrs or {}
    try:
        occluded = int(_clamp(float(raw.get("occluded", 0) or 0), 0, 3))
    except (TypeError, ValueError):
        occluded = 0
    return BoxExportAttrs(occluded=occluded)


def _box_psr(geometry: dict) -> PsrDict:
    return {
        "center": [float(v) for v in (geometry.get("center") or [0, 0, 0])[:3]],
        "size": [float(v) for v in (geometry.get("size") or [0, 0, 0])[:3]],
        "rotation": [float(v) for v in (geometry.get("rotation") or [0, 0, 0])[:3]],
    }


def _kitti_alpha(ry: float, x: float, z: float) -> float:
    if abs(x) < 1e-9 and abs(z) < 1e-9:
        return _wrap_pi(ry)
    return _wrap_pi(ry - math.atan2(x, z))


def build_kitti_lidar_frame(
    annotations: list[Annotation],
    *,
    camera: LidarCameraExportCtx,
    axis_convention: str,
    camera_members: list[Annotation] | None = None,
) -> KittiFrameExportResult:
    """Project ISO-frame cuboids into one trusted KITTI camera frame."""

    lines: list[str] = []
    skipped: list[KittiSkippedAnnotation] = []
    manual_bbox_count = 0
    derived_bbox_count = 0
    manual_by_track = {
        member.scene_track_id: member
        for member in (camera_members or [])
        if member.is_active
        and not member.was_cancelled
        and member.sensor_role == camera.role
        and member.scene_track_id is not None
        and (member.geometry or {}).get("type") == "bbox"
    }
    for ann in annotations:
        geometry = ann.geometry or {}
        if geometry.get("type") != "box_3d":
            continue
        psr = _box_psr(geometry)
        length, width, height = psr["size"]
        if not all(
            math.isfinite(value) and value > 0 for value in (length, width, height)
        ):
            skipped.append(
                KittiSkippedAnnotation(
                    str(ann.id), str(ann.class_name), "invalid_geometry"
                )
            )
            continue
        corners_iso, bottom_iso, forward_iso = _box_iso_geometry(psr)
        corners_camera = [
            _apply_camera_point(
                _iso_to_source(point, axis_convention), camera.calibration
            )
            for point in corners_iso
        ]
        manual_member = manual_by_track.get(ann.scene_track_id)
        projection = _clipped_projection_bbox(corners_camera, camera)
        if projection is None:
            reason = (
                "behind_camera"
                if all(point[2] < _NEAR_PLANE for point in corners_camera)
                else "outside_image_or_degenerate"
            )
            skipped.append(
                KittiSkippedAnnotation(str(ann.id), str(ann.class_name), reason)
            )
            continue
        derived_bbox, truncated = projection
        if manual_member is not None:
            manual = manual_member.geometry or {}
            bbox = pixel_bbox(
                tuple(float(manual[key]) for key in ("x", "y", "w", "h")),
                camera.width,
                camera.height,
            )
            truncated = 0.0
            manual_bbox_count += 1
        else:
            bbox = derived_bbox
            derived_bbox_count += 1
        x, y, z = _apply_camera_point(
            _iso_to_source(bottom_iso, axis_convention), camera.calibration
        )
        forward_camera = _apply_camera_vector(
            _iso_to_source(forward_iso, axis_convention), camera.calibration
        )
        if math.hypot(forward_camera[0], forward_camera[2]) <= 1e-9:
            skipped.append(
                KittiSkippedAnnotation(
                    str(ann.id), str(ann.class_name), "degenerate_orientation"
                )
            )
            continue
        ry = _wrap_pi(math.atan2(-forward_camera[2], forward_camera[0]))
        alpha = _kitti_alpha(ry, x, z)
        attrs = _map_box_attributes(ann.attributes)
        x1, y1, x2, y2 = bbox
        lines.append(
            " ".join(
                [
                    str(ann.class_name),
                    f"{truncated:.6f}",
                    str(attrs.occluded),
                    f"{alpha:.6f}",
                    f"{x1:.2f}",
                    f"{y1:.2f}",
                    f"{x2:.2f}",
                    f"{y2:.2f}",
                    f"{height:.6f}",
                    f"{width:.6f}",
                    f"{length:.6f}",
                    f"{x:.6f}",
                    f"{y:.6f}",
                    f"{z:.6f}",
                    f"{ry:.6f}",
                ]
            )
        )
    return KittiFrameExportResult(
        lines=lines,
        skipped=skipped,
        manual_bbox_count=manual_bbox_count,
        derived_bbox_count=derived_bbox_count,
    )


def build_kitti_lidar_label_lines(
    annotations: list[Annotation],
    *,
    camera: LidarCameraExportCtx,
    axis_convention: str,
) -> list[str]:
    return build_kitti_lidar_frame(
        annotations,
        camera=camera,
        axis_convention=axis_convention,
    ).lines


def build_nuscenes_frame_records(
    frames: list[LidarFrameExportCtx],
) -> dict[str, list[dict[str, Any]]]:
    _ = frames
    raise ValueError("nuscenes_export_not_trusted")


def build_pointmask_label_bytes(
    annotations: list[Annotation],
    *,
    source_point_count: int | None,
    category_map: dict[str, int],
) -> bytes:
    """Build little-endian uint32 per-point labels for ``point_mask_3d``."""

    point_count = int(source_point_count or 0)
    for ann in annotations:
        geometry = ann.geometry or {}
        if geometry.get("type") == "point_mask_3d":
            indices = geometry.get("point_indices") or []
            if indices:
                point_count = max(point_count, max(int(i) for i in indices) + 1)
            if geometry.get("source_point_count") is not None:
                point_count = max(point_count, int(geometry["source_point_count"]))
    labels = [0] * point_count
    for ann in annotations:
        geometry = ann.geometry or {}
        if geometry.get("type") != "point_mask_3d":
            continue
        class_id = int(category_map.get(ann.class_name, 0))
        for idx in geometry.get("point_indices") or []:
            i = int(idx)
            if 0 <= i < point_count:
                labels[i] = class_id
    return struct.pack(f"<{len(labels)}I", *labels) if labels else b""


def category_map_json(classes_list: list[str]) -> str:
    return json.dumps(
        {name: idx + 1 for idx, name in enumerate(classes_list)},
        ensure_ascii=False,
        indent=2,
    )
