"""mask_to_polygon 单测：圆 / 方 / 空 mask × IoU 验证。"""

from __future__ import annotations

import numpy as np
import pytest

from mask_utils import mask_to_polygon
from tests.fixtures.synthetic import (
    circle_mask,
    empty_mask,
    polygon_iou,
    square_mask,
)


def test_circle_mask_returns_polygon():
    mask = circle_mask(size=256, radius=64)
    poly = mask_to_polygon(mask, tolerance=1.0)

    assert isinstance(poly, list)
    assert 8 <= len(poly) <= 200, f"unexpected vertex count: {len(poly)}"
    assert all(len(p) == 2 for p in poly)

    iou = polygon_iou(poly, mask)
    assert iou >= 0.95, f"IoU={iou:.3f} < 0.95"


def test_square_mask_simplifies_to_few_corners():
    mask = square_mask(size=256, half_side=64)
    poly = mask_to_polygon(mask, tolerance=2.0)

    # tolerance 2.0 + 正方形 → 4-6 顶点（findContours 在四角可能各产生 1-2 像素台阶）
    assert 4 <= len(poly) <= 6, f"unexpected vertex count: {len(poly)}"

    iou = polygon_iou(poly, mask)
    assert iou >= 0.97, f"IoU={iou:.3f} < 0.97"


def test_empty_mask_returns_empty_list():
    assert mask_to_polygon(empty_mask()) == []


def test_normalize_to_unit_square():
    mask = circle_mask(size=512, radius=128)
    poly = mask_to_polygon(mask, tolerance=1.0, normalize_to=(512, 512))

    assert len(poly) > 0
    for x, y in poly:
        assert 0.0 <= x <= 1.0, f"x={x} out of [0,1]"
        assert 0.0 <= y <= 1.0, f"y={y} out of [0,1]"


def test_zero_size_mask_returns_empty():
    assert mask_to_polygon(np.zeros((0, 0), dtype=np.uint8)) == []


def test_normalize_invalid_size_raises():
    from mask_utils.normalize import normalize_coords

    with pytest.raises(ValueError):
        normalize_coords([[1.0, 1.0]], 0, 100)


def test_bool_mask_supported():
    """非零像素都视为前景 — bool dtype 也行。"""
    mask = circle_mask(size=128, radius=32).astype(bool)
    poly = mask_to_polygon(mask, tolerance=0.5)
    assert len(poly) > 0


def test_normalized_coords_rounded_to_6_decimals():
    """v0.9.4 phase 3 — 归一化输出与 predictor.py 旧 inline 实现一致 6 位精度。"""
    mask = circle_mask(size=300, radius=70)
    poly = mask_to_polygon(mask, tolerance=1.0, normalize_to=(300, 300))

    assert poly, "non-empty polygon expected"
    for x, y in poly:
        # round(x, 6) 后小数位 ≤ 6；用字符串 split 检查更直观（容许 0.5 这种短表示）。
        for v in (x, y):
            tail = f"{v}".split(".")[-1] if "." in f"{v}" else ""
            assert len(tail) <= 6, f"coord {v} has more than 6 decimals"


def test_self_intersecting_contour_falls_back_to_raw_coords():
    """v0.9.4 phase 3 — shapely simplify 拓扑失败时降级到原始 contour, 不返回空。

    构造一个 8 字形 mask: 两个相邻矩形通过单像素桥连接, findContours 沿外环走时形成
    自相交细颈, shapely.is_valid → False, buffer(0) 可能切成 MultiPolygon, simplify
    可能继续抛 TopologicalError. 兜底路径要保证非空返回。
    """
    mask = np.zeros((128, 128), dtype=np.uint8)
    # 两个矩形 + 1px 桥
    mask[20:50, 20:60] = 1
    mask[20:50, 70:110] = 1
    mask[34:36, 60:70] = 1  # 桥 (2px 高, 形成细颈)

    poly = mask_to_polygon(mask, tolerance=2.0)
    assert poly, "topology fallback should never return empty for non-empty mask"
    assert len(poly) >= 4
