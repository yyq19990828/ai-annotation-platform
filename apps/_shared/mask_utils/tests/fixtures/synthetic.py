"""合成 mask fixtures — 测试用。"""

from __future__ import annotations

import cv2
import numpy as np


def circle_mask(size: int = 256, radius: int | None = None) -> np.ndarray:
    """生成圆形 mask。"""
    mask = np.zeros((size, size), dtype=np.uint8)
    r = radius or size // 4
    cv2.circle(mask, (size // 2, size // 2), r, 1, thickness=-1)
    return mask


def square_mask(size: int = 256, half_side: int | None = None) -> np.ndarray:
    """生成正方形 mask。"""
    mask = np.zeros((size, size), dtype=np.uint8)
    h = half_side or size // 4
    c = size // 2
    mask[c - h : c + h, c - h : c + h] = 1
    return mask


def empty_mask(size: int = 256) -> np.ndarray:
    return np.zeros((size, size), dtype=np.uint8)


def polygon_iou(poly_coords: list[list[float]], mask: np.ndarray) -> float:
    """把 polygon 重新栅格化回 mask，计算与原 mask 的 IoU。"""
    if not poly_coords:
        return 0.0
    rasterized = np.zeros_like(mask)
    pts = np.array(poly_coords, dtype=np.int32)
    cv2.fillPoly(rasterized, [pts], 1)

    inter = np.logical_and(rasterized, mask).sum()
    union = np.logical_or(rasterized, mask).sum()
    return float(inter) / float(union) if union > 0 else 0.0
