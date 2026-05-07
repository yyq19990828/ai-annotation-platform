"""坐标归一化。"""

from __future__ import annotations


def normalize_coords(
    coords: list[list[float]], width: int, height: int
) -> list[list[float]]:
    """像素坐标 -> 归一化 [0, 1]。"""
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid image size: {width}x{height}")
    return [[x / width, y / height] for x, y in coords]
