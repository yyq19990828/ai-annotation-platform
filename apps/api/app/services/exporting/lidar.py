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
    project_box_to_image_bbox,
    transform_box_to_camera_psr,
)


@dataclass(frozen=True)
class BoxExportAttrs:
    occluded: int = 0
    truncated: float = 0.0
    visibility: str = ""


@dataclass(frozen=True)
class LidarCameraExportCtx:
    role: str
    sensor_name: str
    source_name: str
    width: int
    height: int
    calibration: SensorCalibration | None
    source_calibration: SensorCalibration | None


@dataclass(frozen=True)
class LidarFrameExportCtx:
    task_id: uuid.UUID
    frame_key: str
    annotations: list[Annotation]
    cameras: dict[str, LidarCameraExportCtx] = field(default_factory=dict)
    scene_id: uuid.UUID | None = None
    scene_name: str | None = None
    frame_index: int | None = None
    timestamp_us: int | None = None
    ego_translation: list[float] | None = None
    ego_rotation: list[float] | None = None


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


def _kitti_alpha(ry: float, x: float, z: float) -> float:
    if abs(x) < 1e-9 and abs(z) < 1e-9:
        return _wrap_pi(ry)
    return _wrap_pi(ry - math.atan2(x, z))


def build_kitti_lidar_label_lines(
    annotations: list[Annotation],
    *,
    calibration: SensorCalibration,
    image_width: int,
    image_height: int,
) -> list[str]:
    """Build KITTI ``label_2`` rows using one explicit calibrated camera."""

    lines: list[str] = []
    for ann in annotations:
        geometry = ann.geometry or {}
        if geometry.get("type") != "box_3d":
            continue
        psr = _box_psr(geometry)
        box_cam = transform_box_to_camera_psr(psr, calibration)
        bbox = project_box_to_image_bbox(
            psr,
            calibration,
            image_width=image_width,
            image_height=image_height,
        )
        if bbox is None:
            raise ValueError(f"box {ann.id} has no visible projection")
        x, y, z = box_cam["center"]
        length, width, height = box_cam["size"]
        rx, pitch, rz = (float(value) for value in box_cam["rotation"])
        cx, sx = math.cos(rx), math.sin(rx)
        cy, sy = math.cos(pitch), math.sin(pitch)
        cz, sz = math.cos(rz), math.sin(rz)
        heading_x = cy * cz
        heading_z = sx * sz - cx * cz * sy
        up_x = sy
        up_y = -cy * sx
        up_z = cx * cy
        x -= up_x * height / 2.0
        y -= up_y * height / 2.0
        z -= up_z * height / 2.0
        ry = _wrap_pi(math.atan2(-heading_z, heading_x))
        alpha = _kitti_alpha(ry, x, z)
        attrs = _map_box_attributes(ann.attributes)
        x1, y1, x2, y2 = bbox
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


def build_lidar_coco(
    frames: list[LidarFrameExportCtx],
    classes: list[str],
) -> dict[str, Any]:
    """Derive per-camera COCO boxes without persisting 2D annotations."""

    categories = [
        {"id": index + 1, "name": name, "supercategory": ""}
        for index, name in enumerate(classes)
    ]
    category_ids = {row["name"]: row["id"] for row in categories}
    images: list[dict[str, Any]] = []
    annotations: list[dict[str, Any]] = []
    skipped_cameras = 0
    skipped_annotations = 0
    for frame in frames:
        for camera in sorted(frame.cameras.values(), key=lambda value: value.role):
            if camera.calibration is None or camera.width <= 0 or camera.height <= 0:
                skipped_cameras += 1
                continue
            image_id = len(images) + 1
            images.append(
                {
                    "id": image_id,
                    "file_name": (
                        f"{camera.role}/{frame.frame_key}/{camera.source_name}"
                    ),
                    "width": camera.width,
                    "height": camera.height,
                }
            )
            for ann in frame.annotations:
                geometry = ann.geometry or {}
                if geometry.get("type") != "box_3d":
                    continue
                bbox = project_box_to_image_bbox(
                    _box_psr(geometry),
                    camera.calibration,
                    image_width=camera.width,
                    image_height=camera.height,
                )
                category_id = category_ids.get(ann.class_name)
                if bbox is None or category_id is None:
                    skipped_annotations += 1
                    continue
                x1, y1, x2, y2 = bbox
                width = x2 - x1
                height = y2 - y1
                attributes = dict(ann.attributes or {})
                attributes.update(
                    {
                        "__source_box_3d_id": str(ann.id),
                        "__track_id": getattr(ann, "track_id", None),
                        "__camera_role": camera.role,
                    }
                )
                annotations.append(
                    {
                        "id": len(annotations) + 1,
                        "image_id": image_id,
                        "category_id": category_id,
                        "bbox": [x1, y1, width, height],
                        "area": width * height,
                        "iscrowd": 0,
                        "attributes": attributes,
                    }
                )
    return {
        "info": {
            "description": "AAP LiDAR camera-derived COCO 2D boxes",
            "skipped_annotations": skipped_annotations,
            "skipped_cameras": skipped_cameras,
        },
        "images": images,
        "annotations": annotations,
        "categories": categories,
    }


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


def _rotation_xyz(rotation: list[float]) -> tuple[float, ...]:
    rx, ry, rz = (float(value) for value in rotation)
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


def _quat_to_rotation(quaternion: list[float]) -> tuple[float, ...]:
    w, x, y, z = (float(value) for value in quaternion)
    norm = w * w + x * x + y * y + z * z
    if norm <= 1e-12:
        raise ValueError("ego rotation quaternion must be non-zero")
    scale = 2.0 / norm
    return (
        1.0 - scale * (y * y + z * z),
        scale * (x * y - z * w),
        scale * (x * z + y * w),
        scale * (x * y + z * w),
        1.0 - scale * (x * x + z * z),
        scale * (y * z - x * w),
        scale * (x * z - y * w),
        scale * (y * z + x * w),
        1.0 - scale * (x * x + y * y),
    )


def _rotation_to_quat(rotation: tuple[float, ...]) -> list[float]:
    trace = rotation[0] + rotation[4] + rotation[8]
    if trace > 0:
        scale = math.sqrt(trace + 1.0) * 2.0
        return [
            0.25 * scale,
            (rotation[7] - rotation[5]) / scale,
            (rotation[2] - rotation[6]) / scale,
            (rotation[3] - rotation[1]) / scale,
        ]
    index = max(range(3), key=lambda value: rotation[value * 3 + value])
    if index == 0:
        scale = math.sqrt(1.0 + rotation[0] - rotation[4] - rotation[8]) * 2.0
        return [
            (rotation[7] - rotation[5]) / scale,
            0.25 * scale,
            (rotation[1] + rotation[3]) / scale,
            (rotation[2] + rotation[6]) / scale,
        ]
    if index == 1:
        scale = math.sqrt(1.0 + rotation[4] - rotation[0] - rotation[8]) * 2.0
        return [
            (rotation[2] - rotation[6]) / scale,
            (rotation[1] + rotation[3]) / scale,
            0.25 * scale,
            (rotation[5] + rotation[7]) / scale,
        ]
    scale = math.sqrt(1.0 + rotation[8] - rotation[0] - rotation[4]) * 2.0
    return [
        (rotation[3] - rotation[1]) / scale,
        (rotation[2] + rotation[6]) / scale,
        (rotation[5] + rotation[7]) / scale,
        0.25 * scale,
    ]


def _rotation_mul(
    left: tuple[float, ...], right: tuple[float, ...]
) -> tuple[float, ...]:
    return tuple(
        sum(left[row * 3 + i] * right[i * 3 + col] for i in range(3))
        for row in range(3)
        for col in range(3)
    )


def _rotation_vec(rotation: tuple[float, ...], vector: list[float]) -> list[float]:
    return [
        sum(rotation[row * 3 + col] * float(vector[col]) for col in range(3))
        for row in range(3)
    ]


def _camera_to_ego(calibration: SensorCalibration) -> tuple[list[float], list[float]]:
    extrinsic = [float(value) for value in calibration.extrinsic]
    rotation = (
        extrinsic[0],
        extrinsic[1],
        extrinsic[2],
        extrinsic[4],
        extrinsic[5],
        extrinsic[6],
        extrinsic[8],
        extrinsic[9],
        extrinsic[10],
    )
    inverse_rotation = (
        rotation[0],
        rotation[3],
        rotation[6],
        rotation[1],
        rotation[4],
        rotation[7],
        rotation[2],
        rotation[5],
        rotation[8],
    )
    translation = _rotation_vec(
        inverse_rotation,
        [-extrinsic[3], -extrinsic[7], -extrinsic[11]],
    )
    return translation, _rotation_to_quat(inverse_rotation)


def build_nuscenes_frame_records(
    frames: list[LidarFrameExportCtx],
) -> dict[str, list[dict[str, Any]]]:
    """Build a truthful nuScenes-style subset from persisted scene metadata."""

    ordered = sorted(
        frames,
        key=lambda frame: (str(frame.scene_id), frame.frame_index or 0),
    )
    for frame in ordered:
        if (
            frame.scene_id is None
            or frame.scene_name is None
            or frame.frame_index is None
            or frame.timestamp_us is None
            or frame.ego_translation is None
            or frame.ego_rotation is None
        ):
            raise ValueError(f"nuScenes metadata is incomplete at {frame.frame_key}")

    samples: list[dict[str, Any]] = []
    sample_annotations: list[dict[str, Any]] = []
    categories: dict[str, dict[str, Any]] = {}
    attributes: dict[str, dict[str, Any]] = {}
    sensors: dict[str, dict[str, Any]] = {}
    calibrated_sensors: list[dict[str, Any]] = []
    sample_data: list[dict[str, Any]] = []
    ego_poses: list[dict[str, Any]] = []
    scene_frames: dict[uuid.UUID, list[LidarFrameExportCtx]] = {}
    instance_annotations: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    instance_categories: dict[str, str] = {}

    for frame in ordered:
        assert frame.scene_id is not None
        assert frame.frame_index is not None
        assert frame.timestamp_us is not None
        assert frame.ego_translation is not None
        assert frame.ego_rotation is not None
        scene_frames.setdefault(frame.scene_id, []).append(frame)
        sample_token = f"sample-{frame.task_id}"
        ego_pose_token = f"ego-pose-{frame.task_id}"
        samples.append(
            {
                "token": sample_token,
                "timestamp": frame.timestamp_us,
                "scene_token": f"scene-{frame.scene_id}",
                "prev": "",
                "next": "",
            }
        )
        ego_poses.append(
            {
                "token": ego_pose_token,
                "translation": frame.ego_translation,
                "rotation": frame.ego_rotation,
            }
        )
        for camera in sorted(frame.cameras.values(), key=lambda value: value.role):
            if camera.calibration is None:
                continue
            sensor_token = f"sensor-{camera.role}"
            calibrated_token = f"calibrated-{frame.task_id}-{camera.role}"
            sensors.setdefault(
                sensor_token,
                {
                    "token": sensor_token,
                    "channel": camera.role,
                    "modality": "camera",
                },
            )
            translation, rotation = _camera_to_ego(camera.calibration)
            calibrated_sensors.append(
                {
                    "token": calibrated_token,
                    "sensor_token": sensor_token,
                    "translation": translation,
                    "rotation": rotation,
                    "camera_intrinsic": [
                        list(camera.calibration.intrinsic[0:3]),
                        list(camera.calibration.intrinsic[3:6]),
                        list(camera.calibration.intrinsic[6:9]),
                    ],
                }
            )
            sample_data.append(
                {
                    "token": f"sample-data-{frame.task_id}-{camera.role}",
                    "sample_token": sample_token,
                    "ego_pose_token": ego_pose_token,
                    "calibrated_sensor_token": calibrated_token,
                    "timestamp": frame.timestamp_us,
                    "filename": (
                        f"images/{camera.role}/{frame.frame_key}/{camera.source_name}"
                    ),
                    "fileformat": camera.source_name.rsplit(".", 1)[-1].lower(),
                    "is_key_frame": True,
                    "width": camera.width,
                    "height": camera.height,
                    "prev": "",
                    "next": "",
                    "_aap_scene_id": str(frame.scene_id),
                    "_aap_frame_index": frame.frame_index,
                    "_aap_camera_role": camera.role,
                }
            )

        ego_rotation = _quat_to_rotation(frame.ego_rotation)
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
            track_id = getattr(ann, "track_id", None)
            instance_key = (
                f"{frame.scene_id}-{ann.class_name}-{track_id}"
                if track_id
                else str(ann.id)
            )
            instance_token = f"instance-{instance_key}"
            instance_categories[instance_token] = f"category-{ann.class_name}"
            psr = _box_psr(geometry)
            length, width, height = psr["size"]
            rotated_center = _rotation_vec(ego_rotation, psr["center"])
            global_center = [
                rotated_center[index] + float(frame.ego_translation[index])
                for index in range(3)
            ]
            annotation_row = {
                "token": f"annotation-{ann.id}",
                "sample_token": sample_token,
                "instance_token": instance_token,
                "visibility_token": visibility_token,
                "attribute_tokens": [visibility_token] if visibility_token else [],
                "translation": global_center,
                "size": [width, length, height],
                "rotation": _rotation_to_quat(
                    _rotation_mul(ego_rotation, _rotation_xyz(psr["rotation"]))
                ),
                "num_lidar_pts": 0,
                "num_radar_pts": 0,
                "prev": "",
                "next": "",
                "_aap_coordinate_frame": "global",
            }
            sample_annotations.append(annotation_row)
            instance_annotations.setdefault(instance_token, []).append(
                (frame.frame_index, annotation_row)
            )

    sample_by_token = {row["token"]: row for row in samples}
    scenes: list[dict[str, Any]] = []
    for scene_id, grouped_frames in scene_frames.items():
        grouped_frames.sort(key=lambda frame: frame.frame_index or 0)
        tokens = [f"sample-{frame.task_id}" for frame in grouped_frames]
        for index, token in enumerate(tokens):
            sample_by_token[token]["prev"] = tokens[index - 1] if index else ""
            sample_by_token[token]["next"] = (
                tokens[index + 1] if index + 1 < len(tokens) else ""
            )
        scenes.append(
            {
                "token": f"scene-{scene_id}",
                "name": grouped_frames[0].scene_name,
                "description": "",
                "nbr_samples": len(grouped_frames),
                "first_sample_token": tokens[0],
                "last_sample_token": tokens[-1],
            }
        )

    sample_data_groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in sample_data:
        sample_data_groups.setdefault(
            (row.pop("_aap_scene_id"), row["_aap_camera_role"]), []
        ).append(row)
    for rows in sample_data_groups.values():
        rows.sort(key=lambda row: row["_aap_frame_index"])
        for index, row in enumerate(rows):
            row["prev"] = rows[index - 1]["token"] if index else ""
            row["next"] = rows[index + 1]["token"] if index + 1 < len(rows) else ""

    instances: list[dict[str, Any]] = []
    for instance_token, rows in instance_annotations.items():
        rows.sort(key=lambda item: item[0])
        annotation_rows = [row for _frame_index, row in rows]
        for index, row in enumerate(annotation_rows):
            row["prev"] = annotation_rows[index - 1]["token"] if index else ""
            row["next"] = (
                annotation_rows[index + 1]["token"]
                if index + 1 < len(annotation_rows)
                else ""
            )
        instances.append(
            {
                "token": instance_token,
                "category_token": instance_categories[instance_token],
                "nbr_annotations": len(annotation_rows),
                "first_annotation_token": annotation_rows[0]["token"],
                "last_annotation_token": annotation_rows[-1]["token"],
            }
        )

    return {
        "scene": scenes,
        "sample": samples,
        "sample_annotation": sample_annotations,
        "category": list(categories.values()),
        "attribute": list(attributes.values()),
        "visibility": list(attributes.values()),
        "instance": instances,
        "sensor": list(sensors.values()),
        "calibrated_sensor": calibrated_sensors,
        "sample_data": sample_data,
        "ego_pose": ego_poses,
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
