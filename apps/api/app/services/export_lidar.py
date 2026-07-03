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
from app.services.axis_convention import PsrDict, unapply_to_psr


@dataclass(frozen=True)
class BoxExportAttrs:
    occluded: int = 0
    truncated: float = 0.0
    visibility: str = ""


@dataclass(frozen=True)
class LidarFrameExportCtx:
    task_id: uuid.UUID
    frame_key: str
    annotations: list[Annotation]
    cameras: dict[str, SensorCalibration] = field(default_factory=dict)


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
    occluded = int(_clamp(float(raw.get("occluded", 0) or 0), 0, 3))
    truncated = _clamp(float(raw.get("truncated", 0.0) or 0.0), 0.0, 1.0)
    visibility = raw.get("visible", raw.get("visibility", "")) or ""
    return BoxExportAttrs(
        occluded=occluded,
        truncated=truncated,
        visibility=str(visibility),
    )


def _box_psr(geometry: dict) -> PsrDict:
    return {
        "center": [float(v) for v in (geometry.get("center") or [0, 0, 0])[:3]],
        "size": [float(v) for v in (geometry.get("size") or [0, 0, 0])[:3]],
        "rotation": [float(v) for v in (geometry.get("rotation") or [0, 0, 0])[:3]],
    }


def _kitti_bbox_placeholder() -> tuple[float, float, float, float]:
    return (-1.0, -1.0, -1.0, -1.0)


def _kitti_alpha(ry: float, x: float, z: float) -> float:
    if abs(x) < 1e-9 and abs(z) < 1e-9:
        return _wrap_pi(ry)
    return _wrap_pi(ry - math.atan2(x, z))


def build_kitti_lidar_label_lines(
    annotations: list[Annotation],
    *,
    calib_by_cam: dict[str, SensorCalibration] | None = None,
) -> list[str]:
    """Build KITTI ``label_2`` rows from ISO-frame ``box_3d`` annotations.

    KITTI 3D detection labels are always in camera coordinates, independent of
    the API's ``axis_frame`` option. The platform stores box PSR in ISO
    (+X forward, +Y left, +Z up), so mapping to KITTI camera is the fixed
    inverse of the existing ``kitti_camera`` normalization matrix.
    """

    _ = calib_by_cam  # 2D bbox projection is deliberately optional for v0.14.7.
    lines: list[str] = []
    for ann in annotations:
        geometry = ann.geometry or {}
        if geometry.get("type") != "box_3d":
            continue
        box_cam = unapply_to_psr(_box_psr(geometry), "kitti_camera")
        x, y, z = box_cam["center"]
        length, width, height = box_cam["size"]
        ry = _wrap_pi(float(box_cam["rotation"][1]))
        alpha = _kitti_alpha(ry, x, z)
        attrs = _map_box_attributes(ann.attributes)
        x1, y1, x2, y2 = _kitti_bbox_placeholder()
        lines.append(
            " ".join(
                [
                    str(ann.class_name),
                    f"{attrs.truncated:.2f}",
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
    return lines


def _visibility_token(value: str) -> str:
    aliases = {
        "": "",
        "0": "visibility-0",
        "1": "visibility-1",
        "2": "visibility-2",
        "3": "visibility-3",
        "v0-40": "visibility-0",
        "v40-60": "visibility-1",
        "v60-80": "visibility-2",
        "v80-100": "visibility-3",
    }
    return aliases.get(value, value)


def build_nuscenes_frame_records(
    frames: list[LidarFrameExportCtx],
) -> dict[str, list[dict[str, Any]]]:
    """Build a lightweight nuScenes-style table set.

    Without persisted ego poses, exported boxes stay in ego/ISO coordinates and
    ``ego_pose`` rows are explicit identity placeholders.
    """

    samples: list[dict[str, Any]] = []
    sample_annotations: list[dict[str, Any]] = []
    categories: dict[str, dict[str, Any]] = {}
    attributes: dict[str, dict[str, Any]] = {}
    calibrated_sensors: dict[str, dict[str, Any]] = {}
    sample_data: list[dict[str, Any]] = []
    ego_pose: list[dict[str, Any]] = []
    instances: dict[str, dict[str, Any]] = {}

    for frame in frames:
        sample_token = f"sample-{frame.task_id}"
        ego_pose_token = f"ego-pose-{frame.task_id}"
        samples.append(
            {
                "token": sample_token,
                "timestamp": 0,
                "scene_token": "aap-scene",
                "prev": "",
                "next": "",
            }
        )
        ego_pose.append(
            {
                "token": ego_pose_token,
                "translation": [0.0, 0.0, 0.0],
                "rotation": [1.0, 0.0, 0.0, 0.0],
                "_aap_note": "identity placeholder: AAP v0.14.7 has no persisted ego_pose/global trajectory",
            }
        )
        for cam_name, calib in sorted(frame.cameras.items()):
            sensor_token = f"calibrated-{cam_name}"
            if sensor_token not in calibrated_sensors:
                calibrated_sensors[sensor_token] = {
                    "token": sensor_token,
                    "sensor_token": f"sensor-{cam_name}",
                    "translation": [
                        float(calib.extrinsic[3]),
                        float(calib.extrinsic[7]),
                        float(calib.extrinsic[11]),
                    ],
                    "rotation": [1.0, 0.0, 0.0, 0.0],
                    "camera_intrinsic": [
                        list(calib.intrinsic[0:3]),
                        list(calib.intrinsic[3:6]),
                        list(calib.intrinsic[6:9]),
                    ],
                }
            sample_data.append(
                {
                    "token": f"sample-data-{frame.task_id}-{cam_name}",
                    "sample_token": sample_token,
                    "ego_pose_token": ego_pose_token,
                    "calibrated_sensor_token": sensor_token,
                    "filename": f"images/{cam_name}/{frame.frame_key}",
                    "fileformat": "jpg",
                    "is_key_frame": True,
                }
            )
        for ann in frame.annotations:
            geometry = ann.geometry or {}
            if geometry.get("type") != "box_3d":
                continue
            categories.setdefault(
                ann.class_name,
                {
                    "token": f"category-{ann.class_name}",
                    "name": ann.class_name,
                    "description": "",
                },
            )
            attrs = _map_box_attributes(ann.attributes)
            visibility_token = _visibility_token(attrs.visibility)
            if visibility_token:
                attributes.setdefault(
                    visibility_token,
                    {
                        "token": visibility_token,
                        "name": attrs.visibility,
                        "description": "",
                    },
                )
            # v0.21.2 · ADR-0045 · 跨帧同一对象 instance 归并按 track_id (原 group_id);
            # 无 track_id 的孤立框退化为按 annotation id 各自成 instance。
            track_id = getattr(ann, "track_id", None)
            instance_key = f"{ann.class_name}-{track_id}" if track_id else str(ann.id)
            instance_token = f"instance-{instance_key}"
            instances.setdefault(
                instance_token,
                {
                    "token": instance_token,
                    "category_token": f"category-{ann.class_name}",
                },
            )
            psr = _box_psr(geometry)
            length, width, height = psr["size"]
            yaw = float(psr["rotation"][2])
            sample_annotations.append(
                {
                    "token": f"annotation-{ann.id}",
                    "sample_token": sample_token,
                    "instance_token": instance_token,
                    "visibility_token": visibility_token,
                    "attribute_tokens": [visibility_token] if visibility_token else [],
                    "translation": psr["center"],
                    "size": [width, length, height],
                    "rotation": [
                        math.cos(yaw / 2.0),
                        0.0,
                        0.0,
                        math.sin(yaw / 2.0),
                    ],
                    "num_lidar_pts": 0,
                    "num_radar_pts": 0,
                    "_aap_coordinate_frame": "ego_iso",
                }
            )

    return {
        "sample": samples,
        "sample_annotation": sample_annotations,
        "category": list(categories.values()),
        "attribute": list(attributes.values()),
        "visibility": list(attributes.values()),
        "instance": list(instances.values()),
        "calibrated_sensor": list(calibrated_sensors.values()),
        "sample_data": sample_data,
        "ego_pose": ego_pose,
    }


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
