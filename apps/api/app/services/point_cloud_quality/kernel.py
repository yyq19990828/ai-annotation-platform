from __future__ import annotations

from dataclasses import dataclass, field
from math import atan2, cos, sin
import re
from typing import Iterable
import uuid

import numpy as np


@dataclass(frozen=True)
class Box3D:
    center: tuple[float, float, float]
    size: tuple[float, float, float]
    rotation: tuple[float, float, float]


@dataclass(frozen=True)
class QualityThresholds:
    minimum_points: int = 5
    ground_sample_min: int = 24
    ground_margin_m: float = 0.75
    ground_penetration_m: float = 0.2
    ground_float_m: float = 0.45
    size_min_samples: int = 8
    size_mad_z: float = 4.5
    temporal_center_jump_m: float = 4.0
    temporal_size_change_ratio: float = 0.6
    temporal_yaw_jump_rad: float = 0.8


@dataclass(frozen=True)
class TrackInterval:
    start_frame: int
    end_frame: int
    version: int


@dataclass(frozen=True)
class TrackMember:
    annotation_id: uuid.UUID
    frame_index: int
    class_name: str
    track_id: str | None
    box: Box3D
    annotation_version: int
    ego_translation: tuple[float, float, float] | None = None
    ego_rotation: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class QualityFinding:
    code: str
    severity: str
    metric: dict
    threshold: dict
    evidence: dict = field(default_factory=dict)
    frame_start: int | None = None
    frame_end: int | None = None
    annotation_ids: tuple[uuid.UUID, ...] = ()
    suggestion: str | None = None


_HEADER_LINE = re.compile(rb"^([A-Z]+)\s+(.+)$")


def parse_pcd_positions(payload: bytes) -> np.ndarray:
    """Parse finite XYZ positions from an ASCII or uncompressed binary PCD."""
    lines: list[bytes] = []
    offset = 0
    data_kind: str | None = None
    while offset < len(payload):
        end = payload.find(b"\n", offset)
        if end < 0:
            end = len(payload)
        line = payload[offset:end].strip().rstrip(b"\r")
        offset = min(end + 1, len(payload))
        if line and not line.startswith(b"#"):
            lines.append(line)
        if line.upper().startswith(b"DATA "):
            data_kind = line.split(maxsplit=1)[1].decode("ascii").lower()
            break
    if data_kind is None:
        raise ValueError("PCD DATA header missing")
    if data_kind == "binary_compressed":
        raise ValueError("PCD binary_compressed is not supported")

    header: dict[str, list[str]] = {}
    for line in lines:
        match = _HEADER_LINE.match(line.upper())
        if match:
            header[match.group(1).decode()] = match.group(2).decode().split()
    fields = [value.lower() for value in header.get("FIELDS", [])]
    if not {"x", "y", "z"}.issubset(fields):
        raise ValueError("PCD must contain x, y and z fields")
    sizes = [int(value) for value in header.get("SIZE", [])]
    types = header.get("TYPE", [])
    counts = [int(value) for value in header.get("COUNT", ["1"] * len(fields))]
    if not (len(fields) == len(sizes) == len(types) == len(counts)):
        raise ValueError("PCD field metadata length mismatch")
    if any(value <= 0 for value in sizes) or any(value <= 0 for value in counts):
        raise ValueError("PCD field sizes and counts must be positive")
    if header.get("POINTS"):
        point_count = int(header["POINTS"][0])
    else:
        width = int((header.get("WIDTH") or ["0"])[0])
        height = int((header.get("HEIGHT") or ["1"])[0])
        point_count = width * height
    if point_count < 0:
        raise ValueError("PCD point count must be non-negative")

    if data_kind == "ascii":
        values = np.fromstring(payload[offset:].decode("ascii"), sep=" ")
        columns = sum(counts)
        if columns <= 0 or values.size < point_count * columns:
            raise ValueError("PCD ASCII payload is truncated")
        matrix = values[: point_count * columns].reshape(point_count, columns)
        starts = np.cumsum([0, *counts[:-1]])
        positions = matrix[:, [starts[fields.index(axis)] for axis in ("x", "y", "z")]]
    elif data_kind == "binary":
        type_map = {
            ("F", 4): "<f4",
            ("F", 8): "<f8",
            ("I", 1): "i1",
            ("I", 2): "<i2",
            ("I", 4): "<i4",
            ("U", 1): "u1",
            ("U", 2): "<u2",
            ("U", 4): "<u4",
        }
        descriptors: list[tuple] = []
        for name, scalar_type, size, count in zip(
            fields, types, sizes, counts, strict=True
        ):
            dtype = type_map.get((scalar_type.upper(), size))
            if dtype is None:
                raise ValueError(f"unsupported PCD scalar {scalar_type}{size}")
            descriptors.append((name, dtype) if count == 1 else (name, dtype, (count,)))
        structured = np.frombuffer(
            payload[offset:], dtype=np.dtype(descriptors), count=point_count
        )
        if structured.size != point_count:
            raise ValueError("PCD binary payload is truncated")
        positions = np.column_stack([structured[axis] for axis in ("x", "y", "z")])
    else:
        raise ValueError(f"unsupported PCD DATA mode: {data_kind}")
    positions = np.asarray(positions, dtype=np.float32)
    return positions[np.isfinite(positions).all(axis=1)]


def _rotation_matrix(rotation: tuple[float, float, float]) -> np.ndarray:
    rx, ry, rz = rotation
    cx, sx, cy, sy, cz, sz = cos(rx), sin(rx), cos(ry), sin(ry), cos(rz), sin(rz)
    return np.asarray(
        [
            [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
            [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
            [-sy, cy * sx, cy * cx],
        ],
        dtype=np.float64,
    )


def _local_points(points: np.ndarray, box: Box3D) -> np.ndarray:
    centered = np.asarray(points, dtype=np.float64) - np.asarray(box.center)
    return centered @ _rotation_matrix(box.rotation)


def _box_bottom_z(box: Box3D) -> float:
    half = np.asarray(box.size, dtype=np.float64) / 2
    corners = np.asarray(
        [
            (x, y, z)
            for x in (-half[0], half[0])
            for y in (-half[1], half[1])
            for z in (-half[2], half[2])
        ]
    )
    world = corners @ _rotation_matrix(box.rotation).T + np.asarray(box.center)
    return float(world[:, 2].min())


def _robust_size_outlier(
    size: tuple[float, float, float],
    samples: Iterable[tuple[float, float, float]],
    thresholds: QualityThresholds,
) -> tuple[dict, dict] | None:
    matrix = np.asarray(list(samples), dtype=np.float64)
    if len(matrix) < thresholds.size_min_samples:
        return None
    median = np.median(matrix, axis=0)
    mad = np.median(np.abs(matrix - median), axis=0)
    floor = np.maximum(median * 0.05, 0.05)
    robust_scale = np.maximum(mad * 1.4826, floor)
    z = np.abs(np.asarray(size) - median) / robust_scale
    if float(z.max()) <= thresholds.size_mad_z:
        return None
    return (
        {"dimensions": list(size), "median": median.tolist(), "robust_z": z.tolist()},
        {"max_robust_z": thresholds.size_mad_z, "sample_count": len(matrix)},
    )


def evaluate_box(
    points: np.ndarray | None,
    box: Box3D,
    *,
    thresholds: QualityThresholds,
    size_samples: Iterable[tuple[float, float, float]] = (),
) -> list[QualityFinding]:
    findings: list[QualityFinding] = []
    if points is not None:
        local = _local_points(points, box)
        half = np.asarray(box.size, dtype=np.float64) / 2
        inside_count = int(
            np.count_nonzero(np.all(np.abs(local) <= half + 1e-6, axis=1))
        )
        if inside_count < thresholds.minimum_points:
            findings.append(
                QualityFinding(
                    code="low_point_count",
                    severity="warning" if inside_count else "blocker",
                    metric={"point_count": inside_count},
                    threshold={"minimum_points": thresholds.minimum_points},
                    suggestion="inspect_box_or_mark_absent",
                )
            )
        horizontal = np.abs(local[:, :2]) <= half[:2] + thresholds.ground_margin_m
        ground_candidates = points[np.all(horizontal, axis=1)]
        if len(ground_candidates) >= thresholds.ground_sample_min:
            ground_z = float(np.quantile(ground_candidates[:, 2], 0.1))
            clearance = _box_bottom_z(box) - ground_z
            if (
                clearance < -thresholds.ground_penetration_m
                or clearance > thresholds.ground_float_m
            ):
                findings.append(
                    QualityFinding(
                        code="ground_clearance",
                        severity="warning",
                        metric={
                            "clearance_m": clearance,
                            "ground_z": ground_z,
                            "kind": "penetrating" if clearance < 0 else "floating",
                        },
                        threshold={
                            "penetration_m": thresholds.ground_penetration_m,
                            "floating_m": thresholds.ground_float_m,
                            "sample_min": thresholds.ground_sample_min,
                        },
                        evidence={"ground_sample_count": len(ground_candidates)},
                        suggestion="show_ground_layer",
                    )
                )

    size_evidence = _robust_size_outlier(box.size, size_samples, thresholds)
    if size_evidence is not None:
        metric, threshold = size_evidence
        findings.append(
            QualityFinding(
                code="size_outlier",
                severity="warning",
                metric=metric,
                threshold=threshold,
                suggestion="open_psr_editor",
            )
        )
    return sorted(findings, key=lambda item: item.code)


def _angle_delta(left: float, right: float) -> float:
    return abs(atan2(sin(right - left), cos(right - left)))


def _pose_center(member: TrackMember) -> tuple[np.ndarray, str]:
    center = np.asarray(member.box.center, dtype=np.float64)
    if member.ego_translation is None or member.ego_rotation is None:
        return center, "uncompensated"

    rotation = _quaternion_matrix(member.ego_rotation)
    return rotation @ center + np.asarray(member.ego_translation), "ego_pose"


def _quaternion_matrix(
    quaternion: tuple[float, float, float, float],
) -> np.ndarray:
    """Return the sensor-to-world rotation for a normalized wxyz quaternion."""
    w, x, y, z = quaternion
    norm = float(np.linalg.norm(quaternion))
    if norm <= 1e-12:
        raise ValueError("ego rotation quaternion must be non-zero")
    w, x, y, z = (value / norm for value in (w, x, y, z))
    return np.asarray(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def _pose_yaw(member: TrackMember) -> float:
    if member.ego_rotation is None:
        return member.box.rotation[2]
    box_heading = _rotation_matrix(member.box.rotation) @ np.asarray([1.0, 0.0, 0.0])
    world_heading = _quaternion_matrix(member.ego_rotation) @ box_heading
    return atan2(float(world_heading[1]), float(world_heading[0]))


def _missing_ranges(start: int, end: int, populated: set[int]) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    cursor: int | None = None
    for frame in range(start, end + 1):
        if frame not in populated and cursor is None:
            cursor = frame
        elif frame in populated and cursor is not None:
            ranges.append((cursor, frame - 1))
            cursor = None
    if cursor is not None:
        ranges.append((cursor, end))
    return ranges


def evaluate_track(
    *,
    scene_track_id: uuid.UUID,
    authoritative_class: str,
    authoritative_track_id: str,
    track_revision: int,
    presence_mode: str,
    intervals: list[TrackInterval],
    members: list[TrackMember],
    thresholds: QualityThresholds,
) -> list[QualityFinding]:
    findings: list[QualityFinding] = []
    ordered = sorted(
        members, key=lambda item: (item.frame_index, str(item.annotation_id))
    )
    by_frame: dict[int, list[TrackMember]] = {}
    for member in ordered:
        by_frame.setdefault(member.frame_index, []).append(member)
    for frame, rows in by_frame.items():
        if len(rows) > 1:
            findings.append(
                QualityFinding(
                    code="duplicate_track_member",
                    severity="blocker",
                    metric={"member_count": len(rows)},
                    threshold={"maximum_members_per_frame": 1},
                    evidence={
                        "scene_track_id": str(scene_track_id),
                        "track_revision": track_revision,
                    },
                    frame_start=frame,
                    frame_end=frame,
                    annotation_ids=tuple(row.annotation_id for row in rows),
                    suggestion="review_duplicate_members",
                )
            )
    populated = set(by_frame)
    for interval in sorted(
        intervals, key=lambda item: (item.start_frame, item.end_frame)
    ):
        for start, end in _missing_ranges(
            interval.start_frame, interval.end_frame, populated
        ):
            findings.append(
                QualityFinding(
                    code="track_gap",
                    severity="warning",
                    metric={"missing_frames": end - start + 1},
                    threshold={
                        "declared_presence": [interval.start_frame, interval.end_frame]
                    },
                    evidence={
                        "scene_track_id": str(scene_track_id),
                        "track_revision": track_revision,
                        "interval_version": interval.version,
                        "presence_mode": presence_mode,
                    },
                    frame_start=start,
                    frame_end=end,
                    suggestion="preview_track_gap_command",
                )
            )
    drift = [
        row
        for row in ordered
        if row.class_name != authoritative_class
        or row.track_id != authoritative_track_id
    ]
    if drift:
        findings.append(
            QualityFinding(
                code="track_identity_drift",
                severity="blocker",
                metric={
                    "expected_class": authoritative_class,
                    "actual_classes": sorted({row.class_name for row in drift}),
                    "expected_track_id": authoritative_track_id,
                    "actual_track_ids": sorted({str(row.track_id) for row in drift}),
                },
                threshold={"identity_match": True},
                evidence={
                    "scene_track_id": str(scene_track_id),
                    "track_revision": track_revision,
                },
                frame_start=min(row.frame_index for row in drift),
                frame_end=max(row.frame_index for row in drift),
                annotation_ids=tuple(row.annotation_id for row in drift),
                suggestion="review_track_identity",
            )
        )

    canonical = [rows[0] for _, rows in sorted(by_frame.items())]
    for left, right in zip(canonical, canonical[1:], strict=False):
        if not any(
            interval.start_frame <= left.frame_index <= interval.end_frame
            and interval.start_frame <= right.frame_index <= interval.end_frame
            for interval in intervals
        ):
            continue
        frame_delta = max(1, right.frame_index - left.frame_index)
        left_center, left_pose_mode = _pose_center(left)
        right_center, right_pose_mode = _pose_center(right)
        pose_mode = (
            "ego_pose"
            if left_pose_mode == right_pose_mode == "ego_pose"
            else "uncompensated"
        )
        if pose_mode == "uncompensated":
            left_center = np.asarray(left.box.center)
            right_center = np.asarray(right.box.center)
        center_delta = float(np.linalg.norm(right_center - left_center)) / frame_delta
        size_left = np.asarray(left.box.size)
        size_right = np.asarray(right.box.size)
        size_ratio = float(
            np.max(np.abs(size_right - size_left) / np.maximum(size_left, 1e-6))
        )
        left_yaw = _pose_yaw(left) if pose_mode == "ego_pose" else left.box.rotation[2]
        right_yaw = (
            _pose_yaw(right) if pose_mode == "ego_pose" else right.box.rotation[2]
        )
        yaw_delta = _angle_delta(left_yaw, right_yaw) / frame_delta
        if (
            center_delta > thresholds.temporal_center_jump_m
            or size_ratio > thresholds.temporal_size_change_ratio
            or yaw_delta > thresholds.temporal_yaw_jump_rad
        ):
            findings.append(
                QualityFinding(
                    code="temporal_jump",
                    severity="warning" if pose_mode == "ego_pose" else "info",
                    metric={
                        "center_delta_m_per_frame": center_delta,
                        "size_change_ratio": size_ratio,
                        "yaw_delta_rad_per_frame": yaw_delta,
                    },
                    threshold={
                        "center_jump_m_per_frame": thresholds.temporal_center_jump_m,
                        "size_change_ratio": thresholds.temporal_size_change_ratio,
                        "yaw_jump_rad_per_frame": thresholds.temporal_yaw_jump_rad,
                    },
                    evidence={"pose_mode": pose_mode, "frame_delta": frame_delta},
                    frame_start=left.frame_index,
                    frame_end=right.frame_index,
                    annotation_ids=(left.annotation_id, right.annotation_id),
                    suggestion="compare_neighbor_frames",
                )
            )
    return sorted(
        findings,
        key=lambda item: (
            item.code,
            item.frame_start if item.frame_start is not None else -1,
        ),
    )
