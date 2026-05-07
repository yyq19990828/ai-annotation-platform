"""mask → polygon 转换。

实现：cv2.findContours 取前景轮廓 → shapely.simplify 简化顶点 → 可选归一化。
"""

from __future__ import annotations

import cv2
import numpy as np
from shapely.geometry import Polygon

from mask_utils.normalize import normalize_coords


def mask_to_polygon(
    mask: np.ndarray,
    tolerance: float = 1.0,
    normalize_to: tuple[int, int] | None = None,
) -> list[list[float]]:
    """把二值 mask (H, W) 转成简化后的多边形顶点。

    Args:
        mask: uint8 / bool 数组，非零 = 前景。
        tolerance: shapely.simplify 容差（像素单位）。
        normalize_to: (width, height)；为 None 返回像素坐标，否则归一化到 [0, 1]。

    Returns:
        [[x1, y1], [x2, y2], ...]；多连通域取面积最大者；空 mask 返回 []。
    """
    if mask.size == 0:
        return []

    binary = (mask > 0).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []

    biggest = max(contours, key=cv2.contourArea)
    if len(biggest) < 3:
        return []

    points = biggest.reshape(-1, 2).astype(float)
    poly = Polygon(points)
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.is_empty or poly.geom_type != "Polygon":
            return []

    simplified = poly.simplify(tolerance, preserve_topology=True)
    if simplified.is_empty or simplified.geom_type != "Polygon":
        return []

    coords = [[float(x), float(y)] for x, y in simplified.exterior.coords]
    # shapely 闭合多边形首尾点重复，去掉末点
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]

    if normalize_to is not None:
        w, h = normalize_to
        coords = normalize_coords(coords, w, h)

    return coords
