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


def donut_mask(size: int = 256, outer: int = 80, inner: int = 30) -> np.ndarray:
    """甜甜圈 mask：外环填充, 内圈挖空。RETR_CCOMP 应抓出 1 外环 + 1 hole。"""
    mask = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(mask, (size // 2, size // 2), outer, 1, thickness=-1)
    cv2.circle(mask, (size // 2, size // 2), inner, 0, thickness=-1)
    return mask


def two_circles_mask(
    size: int = 256, radius: int = 40, gap: int = 30
) -> np.ndarray:
    """两个分离的圆 mask：RETR_CCOMP 应抓出 2 个外环, 各无 hole。"""
    mask = np.zeros((size, size), dtype=np.uint8)
    cy = size // 2
    cx_left = size // 2 - radius - gap // 2
    cx_right = size // 2 + radius + gap // 2
    cv2.circle(mask, (cx_left, cy), radius, 1, thickness=-1)
    cv2.circle(mask, (cx_right, cy), radius, 1, thickness=-1)
    return mask


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


def multi_polygon_iou(
    rings: list[dict],
    mask: np.ndarray,
) -> float:
    """多连通域 polygons → 栅格化 → 与原 mask 计算 IoU。

    rings: [{exterior: [[x,y], ...], holes: [[[x,y], ...], ...]}, ...]
    每个外环 fillPoly 1, hole fillPoly 0（按顺序覆盖）。
    """
    if not rings:
        return 0.0
    rasterized = np.zeros_like(mask)
    for ring in rings:
        ext = np.array(ring["exterior"], dtype=np.int32)
        cv2.fillPoly(rasterized, [ext], 1)
        for hole in ring.get("holes", []):
            hpts = np.array(hole, dtype=np.int32)
            cv2.fillPoly(rasterized, [hpts], 0)
    inter = np.logical_and(rasterized, mask).sum()
    union = np.logical_or(rasterized, mask).sum()
    return float(inter) / float(union) if union > 0 else 0.0
