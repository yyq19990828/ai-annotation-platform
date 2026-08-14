"""Pure point-cloud box transforms shared by LiDAR export and scene QC."""

from __future__ import annotations

import math

from app.schemas._jsonb_types import SensorCalibration
from app.services.axis_convention import PsrDict


Mat3 = tuple[float, float, float, float, float, float, float, float, float]
Vec3 = tuple[float, float, float]

BOX_EDGES: tuple[tuple[int, int], ...] = (
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


def _mat4_vec(matrix: list[float], vector: tuple[float, float, float, float]):
    return tuple(
        sum(float(matrix[row * 4 + col]) * vector[col] for col in range(4))
        for row in range(4)
    )


def _mat3_vec(matrix: list[float] | Mat3, vector: Vec3) -> Vec3:
    return tuple(
        sum(float(matrix[row * 3 + col]) * vector[col] for col in range(3))
        for row in range(3)
    )  # type: ignore[return-value]


def _mat3_mul(left: Mat3, right: Mat3) -> Mat3:
    return tuple(
        sum(left[row * 3 + i] * right[i * 3 + col] for i in range(3))
        for row in range(3)
        for col in range(3)
    )  # type: ignore[return-value]


def _euler_xyz_to_mat3(rotation: list[float]) -> Mat3:
    rx, ry, rz = (float(rotation[i]) for i in range(3))
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


def _mat3_to_euler_xyz(matrix: Mat3) -> list[float]:
    ry = math.asin(max(-1.0, min(1.0, matrix[2])))
    if abs(math.cos(ry)) > 1e-6:
        rx = math.atan2(-matrix[5], matrix[8])
        rz = math.atan2(-matrix[1], matrix[0])
    else:
        rx = math.atan2(matrix[7], matrix[4])
        rz = 0.0
    return [rx, ry, rz]


def _camera_matrix(calibration: SensorCalibration) -> tuple[list[float], Mat3]:
    extrinsic = [float(value) for value in calibration.extrinsic]
    linear: Mat3 = (
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
    if calibration.rect is None:
        return extrinsic, linear

    rect = [float(value) for value in calibration.rect]
    combined = [
        sum(rect[row * 4 + i] * extrinsic[i * 4 + col] for i in range(4))
        for row in range(4)
        for col in range(4)
    ]
    rect_linear: Mat3 = (
        rect[0],
        rect[1],
        rect[2],
        rect[4],
        rect[5],
        rect[6],
        rect[8],
        rect[9],
        rect[10],
    )
    return combined, _mat3_mul(rect_linear, linear)


def _transform_point(matrix: list[float], point: Vec3) -> Vec3:
    x, y, z, w = _mat4_vec(matrix, (point[0], point[1], point[2], 1.0))
    if abs(w) > 1e-12 and w != 1.0:
        return (x / w, y / w, z / w)
    return (x, y, z)


def transform_box_to_camera_psr(
    psr: PsrDict,
    calibration: SensorCalibration,
) -> PsrDict:
    """Transform a platform ISO-frame box center and orientation to camera frame."""

    matrix, linear = _camera_matrix(calibration)
    center = _transform_point(
        matrix,
        tuple(float(value) for value in psr["center"][:3]),  # type: ignore[arg-type]
    )
    rotation = _mat3_mul(linear, _euler_xyz_to_mat3(psr["rotation"]))
    return {
        "center": list(center),
        "size": [float(value) for value in psr["size"][:3]],
        "rotation": _mat3_to_euler_xyz(rotation),
    }


def _box_corners(psr: PsrDict) -> list[Vec3]:
    center = tuple(float(value) for value in psr["center"][:3])
    half = tuple(float(value) / 2.0 for value in psr["size"][:3])
    rotation = _euler_xyz_to_mat3(psr["rotation"])
    corners: list[Vec3] = []
    for z_sign in (-1.0, 1.0):
        for x_sign, y_sign in ((-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)):
            offset = _mat3_vec(
                rotation,
                (x_sign * half[0], y_sign * half[1], z_sign * half[2]),
            )
            corners.append(
                (center[0] + offset[0], center[1] + offset[1], center[2] + offset[2])
            )
    return corners


def project_box_to_image_bbox(
    psr: PsrDict,
    calibration: SensorCalibration,
    *,
    image_width: int | None = None,
    image_height: int | None = None,
    near_clip: float = 1e-6,
) -> tuple[float, float, float, float] | None:
    """Project a box to a clipped image bbox, including near-plane edge intersections."""

    if not math.isfinite(near_clip) or near_clip <= 0:
        raise ValueError("near_clip must be a finite positive number")
    matrix, _linear = _camera_matrix(calibration)
    camera_corners = [_transform_point(matrix, point) for point in _box_corners(psr)]
    clipped = [point for point in camera_corners if point[2] >= near_clip]
    for start_index, end_index in BOX_EDGES:
        start = camera_corners[start_index]
        end = camera_corners[end_index]
        if (start[2] >= near_clip) == (end[2] >= near_clip):
            continue
        ratio = (near_clip - start[2]) / (end[2] - start[2])
        clipped.append(
            tuple(start[i] + ratio * (end[i] - start[i]) for i in range(3))  # type: ignore[arg-type]
        )
    if not clipped:
        return None

    pixels: list[tuple[float, float]] = []
    intrinsic = [float(value) for value in calibration.intrinsic]
    for point in clipped:
        u, v, w = _mat3_vec(intrinsic, point)
        if w > 0 and all(math.isfinite(value) for value in (u, v, w)):
            pixels.append((u / w, v / w))
    if not pixels:
        return None

    x1 = min(pixel[0] for pixel in pixels)
    y1 = min(pixel[1] for pixel in pixels)
    x2 = max(pixel[0] for pixel in pixels)
    y2 = max(pixel[1] for pixel in pixels)
    if image_width is not None:
        x1 = max(0.0, min(float(image_width), x1))
        x2 = max(0.0, min(float(image_width), x2))
    if image_height is not None:
        y1 = max(0.0, min(float(image_height), y1))
        y2 = max(0.0, min(float(image_height), y2))
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1, y1, x2, y2)
