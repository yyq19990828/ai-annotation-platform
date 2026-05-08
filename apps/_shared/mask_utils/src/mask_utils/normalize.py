"""坐标归一化。"""

from __future__ import annotations

# v0.9.4 phase 3: 6 位小数与平台 BboxAnnotation / PolygonAnnotation value 字段精度对齐
# (predictor.py 旧 inline 实现也是 round(x/w, 6))，避免迁移后协议字段分辨率漂移。
_NORM_PRECISION = 6


def normalize_coords(
    coords: list[list[float]], width: int, height: int
) -> list[list[float]]:
    """像素坐标 -> 归一化 [0, 1]，6 位小数对齐协议精度。"""
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid image size: {width}x{height}")
    return [
        [round(x / width, _NORM_PRECISION), round(y / height, _NORM_PRECISION)]
        for x, y in coords
    ]
