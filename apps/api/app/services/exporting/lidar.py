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
from app.services.axis_convention import PsrDict, R_NORM


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


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


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


def _euler_xyz_matrix(rotation: list[float]) -> tuple[float, ...]:
    rx, ry, rz = rotation
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    return (
        cy * cz,
        -cy * sz,
        sy,
        cx * sz + cz * sx * sy,
        cx * cz - sx * sy * sz,
        -cy * sx,
        sx * sz - cx * cz * sy,
        cz * sx + cx * sy * sz,
        cx * cy,
    )


def _mat3_vec(
    matrix: tuple[float, ...] | list[float], point: tuple[float, float, float]
) -> tuple[float, float, float]:
    x, y, z = point
    return (
        matrix[0] * x + matrix[1] * y + matrix[2] * z,
        matrix[3] * x + matrix[4] * y + matrix[5] * z,
        matrix[6] * x + matrix[7] * y + matrix[8] * z,
    )


def _iso_to_source(
    point: tuple[float, float, float], axis_convention: str
) -> tuple[float, float, float]:
    matrix = R_NORM[axis_convention]
    transpose = (
        matrix[0],
        matrix[3],
        matrix[6],
        matrix[1],
        matrix[4],
        matrix[7],
        matrix[2],
        matrix[5],
        matrix[8],
    )
    return _mat3_vec(transpose, point)


def _apply_camera_point(
    point: tuple[float, float, float], calibration: SensorCalibration
) -> tuple[float, float, float]:
    x, y, z = point
    extrinsic = calibration.extrinsic
    camera = (
        extrinsic[0] * x + extrinsic[1] * y + extrinsic[2] * z + extrinsic[3],
        extrinsic[4] * x + extrinsic[5] * y + extrinsic[6] * z + extrinsic[7],
        extrinsic[8] * x + extrinsic[9] * y + extrinsic[10] * z + extrinsic[11],
    )
    if calibration.rect:
        rect = calibration.rect
        cx, cy, cz = camera
        return (
            rect[0] * cx + rect[1] * cy + rect[2] * cz + rect[3],
            rect[4] * cx + rect[5] * cy + rect[6] * cz + rect[7],
            rect[8] * cx + rect[9] * cy + rect[10] * cz + rect[11],
        )
    return camera


def _apply_camera_vector(
    vector: tuple[float, float, float], calibration: SensorCalibration
) -> tuple[float, float, float]:
    extrinsic = calibration.extrinsic
    camera = _mat3_vec(
        (
            extrinsic[0],
            extrinsic[1],
            extrinsic[2],
            extrinsic[4],
            extrinsic[5],
            extrinsic[6],
            extrinsic[8],
            extrinsic[9],
            extrinsic[10],
        ),
        vector,
    )
    if calibration.rect:
        rect = calibration.rect
        return _mat3_vec(
            (
                rect[0],
                rect[1],
                rect[2],
                rect[4],
                rect[5],
                rect[6],
                rect[8],
                rect[9],
                rect[10],
            ),
            camera,
        )
    return camera


def _project_camera_point(
    point: tuple[float, float, float], intrinsic: list[float]
) -> tuple[float, float] | None:
    x, y, z = point
    u = intrinsic[0] * x + intrinsic[1] * y + intrinsic[2] * z
    v = intrinsic[3] * x + intrinsic[4] * y + intrinsic[5] * z
    w = intrinsic[6] * x + intrinsic[7] * y + intrinsic[8] * z
    if w <= 0 or not math.isfinite(w):
        return None
    pixel = (u / w, v / w)
    return pixel if all(math.isfinite(value) for value in pixel) else None


_BOX_EDGES: tuple[tuple[int, int], ...] = (
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 0),
    (4, 5),
    (5, 6),
    (6, 7),
    (7, 4),
    (0, 4),
    (1, 5),
    (2, 6),
    (3, 7),
)
_NEAR_PLANE = 0.1


def _box_iso_geometry(
    psr: PsrDict,
) -> tuple[
    list[tuple[float, float, float]],
    tuple[float, float, float],
    tuple[float, float, float],
]:
    center = tuple(psr["center"])
    length, width, height = psr["size"]
    rotation = _euler_xyz_matrix(psr["rotation"])

    def world(local: tuple[float, float, float]) -> tuple[float, float, float]:
        offset = _mat3_vec(rotation, local)
        return (
            center[0] + offset[0],
            center[1] + offset[1],
            center[2] + offset[2],
        )

    corners = [
        world((sx * length / 2, sy * width / 2, sz * height / 2))
        for sz in (-1, 1)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ]
    bottom_center = world((0, 0, -height / 2))
    forward = _mat3_vec(rotation, (1, 0, 0))
    return corners, bottom_center, forward


def _clipped_projection_bbox(
    corners: list[tuple[float, float, float]],
    camera: LidarCameraExportCtx,
) -> tuple[tuple[float, float, float, float], float] | None:
    candidates = [point for point in corners if point[2] >= _NEAR_PLANE]
    for start_index, end_index in _BOX_EDGES:
        start = corners[start_index]
        end = corners[end_index]
        start_front = start[2] >= _NEAR_PLANE
        end_front = end[2] >= _NEAR_PLANE
        if start_front == end_front:
            continue
        ratio = (_NEAR_PLANE - start[2]) / (end[2] - start[2])
        candidates.append(
            (
                start[0] + ratio * (end[0] - start[0]),
                start[1] + ratio * (end[1] - start[1]),
                _NEAR_PLANE,
            )
        )
    pixels = [
        pixel
        for point in candidates
        if (pixel := _project_camera_point(point, camera.calibration.intrinsic))
        is not None
    ]
    if not pixels:
        return None
    raw = (
        min(pixel[0] for pixel in pixels),
        min(pixel[1] for pixel in pixels),
        max(pixel[0] for pixel in pixels),
        max(pixel[1] for pixel in pixels),
    )
    raw_area = max(0.0, raw[2] - raw[0]) * max(0.0, raw[3] - raw[1])
    if raw_area <= 1e-9:
        return None
    image_right = float(camera.width - 1)
    image_bottom = float(camera.height - 1)
    clipped = (
        _clamp(raw[0], 0.0, image_right),
        _clamp(raw[1], 0.0, image_bottom),
        _clamp(raw[2], 0.0, image_right),
        _clamp(raw[3], 0.0, image_bottom),
    )
    clipped_area = max(0.0, clipped[2] - clipped[0]) * max(0.0, clipped[3] - clipped[1])
    if clipped_area <= 1e-9:
        return None
    truncated = _clamp(1.0 - clipped_area / raw_area, 0.0, 1.0)
    return clipped, truncated


def build_kitti_lidar_frame(
    annotations: list[Annotation],
    *,
    camera: LidarCameraExportCtx,
    axis_convention: str,
) -> KittiFrameExportResult:
    """Project ISO-frame cuboids into one trusted KITTI camera frame."""

    lines: list[str] = []
    skipped: list[KittiSkippedAnnotation] = []
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
        bbox, truncated = projection
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
    return KittiFrameExportResult(lines=lines, skipped=skipped)


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
