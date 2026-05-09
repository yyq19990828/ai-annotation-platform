"""mask → polygon 转换。

实现：cv2.findContours 取前景轮廓 → shapely.simplify 简化顶点 → 可选归一化。

v0.9.14 · 新增 mask_to_multi_polygon（RETR_CCOMP 抓内外环树, 输出 list[{exterior,
holes}]）支持多连通域 + 空洞。原 mask_to_polygon 保留不动, predictor 在单连通无 hole
时仍走旧路径以保持向后兼容（老前端 / 老存量 prediction 反序列化路径不破）。
"""

from __future__ import annotations

from typing import TypedDict

import cv2
import numpy as np
from shapely.geometry import MultiPolygon, Polygon

from mask_utils.normalize import normalize_coords


class MultiPolygonRing(TypedDict):
    """多连通域单个 polygon 的内外环描述（像素或归一化坐标，由调用方 normalize_to 决定）。"""

    exterior: list[list[float]]
    holes: list[list[list[float]]]


def mask_to_polygon(
    mask: np.ndarray,
    tolerance: float = 1.0,
    normalize_to: tuple[int, int] | None = None,
) -> list[list[float]]:
    """把二值 mask (H, W) 转成简化后的多边形顶点（取最大外环, 不含 hole）。

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
    coords = _simplify_contour(biggest, tolerance)
    if not coords:
        return []

    if normalize_to is not None:
        w, h = normalize_to
        coords = normalize_coords(coords, w, h)

    return coords


def mask_to_multi_polygon(
    mask: np.ndarray,
    tolerance: float = 1.0,
    normalize_to: tuple[int, int] | None = None,
    min_area: float = 4.0,
) -> list[MultiPolygonRing]:
    """二值 mask → 多连通域 polygons（含 hole）。

    cv2.findContours(RETR_CCOMP) 拿到两层环树：顶层 = 各连通域的外环；二层 = hole。
    hierarchy[i] = [next, prev, first_child, parent]; parent == -1 表示外环, 否则其
    parent 索引指向所属外环。每个外环 simplify 后挂上属于它的（同样 simplify 过的）
    holes, 返回 [{exterior, holes}, ...]。空 mask / 全部环退化（< 3 顶点）返回 []。

    Args:
        mask: uint8 / bool 数组, 非零 = 前景。
        tolerance: shapely.simplify 容差（像素单位）, 外环和 hole 共用同一 tolerance。
        normalize_to: (width, height); 为 None 返回像素坐标, 否则归一化到 [0, 1]。
        min_area: 像素面积阈值, 小于该值的外环 / hole 直接丢弃（防 1-2 像素噪点 hole
            充斥结果）。default 4 ≈ 一个像素的 2x2 邻域。

    Returns:
        list[{"exterior": [[x,y], ...], "holes": [[[x,y], ...], ...]}]; 空时 []。
    """
    if mask.size == 0:
        return []

    binary = (mask > 0).astype(np.uint8)
    contours, hierarchy = cv2.findContours(
        binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )
    if not contours or hierarchy is None:
        return []

    # hierarchy shape: (1, N, 4); flatten
    hier = hierarchy[0]

    # 先把外环按索引收集, 顺便简化坐标
    outers: dict[int, MultiPolygonRing] = {}
    for i, contour in enumerate(contours):
        parent = int(hier[i][3])
        if parent != -1:
            continue  # 留给 hole 阶段
        if cv2.contourArea(contour) < min_area:
            continue
        exterior = _simplify_contour(contour, tolerance)
        if not exterior:
            continue
        outers[i] = {"exterior": exterior, "holes": []}

    # hole 挂回所属外环
    for i, contour in enumerate(contours):
        parent = int(hier[i][3])
        if parent == -1 or parent not in outers:
            continue
        if cv2.contourArea(contour) < min_area:
            continue
        hole = _simplify_contour(contour, tolerance)
        if not hole:
            continue
        outers[parent]["holes"].append(hole)

    # 按外环面积降序输出, 与 mask_to_polygon 单环时返回最大者的语义对齐（首项最大）
    sorted_outers = sorted(
        outers.values(),
        key=lambda r: _polygon_signed_area(r["exterior"]),
        reverse=True,
    )

    if not sorted_outers:
        return []

    if normalize_to is not None:
        w, h = normalize_to
        sorted_outers = [
            {
                "exterior": normalize_coords(r["exterior"], w, h),
                "holes": [normalize_coords(h_, w, h) for h_ in r["holes"]],
            }
            for r in sorted_outers
        ]

    return sorted_outers


def _simplify_contour(contour: np.ndarray, tolerance: float) -> list[list[float]]:
    """单条 cv2 contour → 简化后的 [[x,y], ...]（像素坐标）；失败降级到原始顶点。

    与 mask_to_polygon 旧实现一致的拓扑兜底（self-intersecting / spike contour /
    buffer(0) 切碎成 MultiPolygon 时取最大者）, 保证非空 contour 一定返回顶点。
    """
    if len(contour) < 3:
        return []

    points = contour.reshape(-1, 2).astype(float)
    raw_coords = [[float(x), float(y)] for x, y in points]

    try:
        poly = Polygon(points)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            return []
        simplified = poly.simplify(tolerance, preserve_topology=True)
        if simplified.is_empty:
            return []
        if isinstance(simplified, MultiPolygon):
            simplified = max(simplified.geoms, key=lambda g: g.area)
        if simplified.geom_type != "Polygon":
            coords = raw_coords
        else:
            coords = [[float(x), float(y)] for x, y in simplified.exterior.coords]
    except Exception:  # noqa: BLE001 — shapely 拓扑兜底
        coords = raw_coords

    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]

    if len(coords) < 3:
        return []

    return coords


def _polygon_signed_area(coords: list[list[float]]) -> float:
    """shoelace 面积（绝对值, 用于排序）。空 / < 3 顶点返回 0。"""
    n = len(coords)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = coords[i]
        x2, y2 = coords[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0
