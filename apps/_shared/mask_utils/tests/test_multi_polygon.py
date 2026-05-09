"""mask_to_multi_polygon 单测：donut / 两圆 / 单连通退化路径 × IoU 验证。

v0.9.14 · ROADMAP P2 多连通域 / 空洞支持。覆盖：
- 单连通无 hole（与 mask_to_polygon 同结果, 但包成 [{exterior, holes:[]}]）
- 甜甜圈（1 外环 + 1 hole）
- 两个分离圆（2 外环, 各无 hole）
- 空 mask / size=0 / 全噪点
- 归一化 [0,1] 输出
- min_area 过滤小噪点 hole
"""

from __future__ import annotations

import numpy as np

from mask_utils import mask_to_multi_polygon
from tests.fixtures.synthetic import (
    circle_mask,
    donut_mask,
    empty_mask,
    multi_polygon_iou,
    two_circles_mask,
)


def test_circle_yields_single_polygon_no_holes():
    mask = circle_mask(size=256, radius=64)
    rings = mask_to_multi_polygon(mask, tolerance=1.0)

    assert len(rings) == 1
    assert rings[0]["holes"] == []
    assert 8 <= len(rings[0]["exterior"]) <= 200

    iou = multi_polygon_iou(rings, mask)
    assert iou >= 0.95, f"IoU={iou:.3f} < 0.95"


def test_donut_has_one_outer_and_one_hole():
    mask = donut_mask(size=256, outer=80, inner=30)
    rings = mask_to_multi_polygon(mask, tolerance=1.0)

    assert len(rings) == 1, f"expected 1 outer ring, got {len(rings)}"
    assert len(rings[0]["holes"]) == 1, (
        f"expected 1 hole, got {len(rings[0]['holes'])}"
    )
    # outer 顶点应明显多于 hole 顶点（外环周长更长）
    assert len(rings[0]["exterior"]) > len(rings[0]["holes"][0])

    iou = multi_polygon_iou(rings, mask)
    assert iou >= 0.95, f"donut IoU={iou:.3f} < 0.95"


def test_two_disconnected_circles_yield_two_outers():
    mask = two_circles_mask(size=256, radius=40, gap=30)
    rings = mask_to_multi_polygon(mask, tolerance=1.0)

    assert len(rings) == 2, f"expected 2 outer rings, got {len(rings)}"
    for r in rings:
        assert r["holes"] == []
        assert len(r["exterior"]) >= 6

    # 第一项面积应 >= 第二项（按面积降序）
    iou = multi_polygon_iou(rings, mask)
    assert iou >= 0.95, f"two-circles IoU={iou:.3f} < 0.95"


def test_empty_mask_returns_empty_list():
    assert mask_to_multi_polygon(empty_mask()) == []


def test_zero_size_mask_returns_empty():
    assert mask_to_multi_polygon(np.zeros((0, 0), dtype=np.uint8)) == []


def test_normalize_to_unit_square_for_donut():
    mask = donut_mask(size=512, outer=160, inner=60)
    rings = mask_to_multi_polygon(
        mask, tolerance=1.0, normalize_to=(512, 512)
    )

    assert len(rings) == 1
    for x, y in rings[0]["exterior"]:
        assert 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0
    for hole in rings[0]["holes"]:
        for x, y in hole:
            assert 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0


def test_min_area_filters_noise_holes():
    """1×1 噪点 hole 应被 min_area=4 过滤掉, 不出现在结果里。"""
    mask = np.zeros((128, 128), dtype=np.uint8)
    mask[20:100, 20:100] = 1  # 80x80 实心方块
    mask[50, 50] = 0  # 单像素噪点 hole（面积=1, < min_area=4）

    rings = mask_to_multi_polygon(mask, tolerance=1.0, min_area=4.0)

    assert len(rings) == 1
    assert rings[0]["holes"] == [], (
        f"single-pixel noise hole should be filtered, got {len(rings[0]['holes'])}"
    )


def test_min_area_keeps_real_holes():
    mask = donut_mask(size=128, outer=50, inner=20)
    rings = mask_to_multi_polygon(mask, tolerance=1.0, min_area=4.0)
    assert len(rings) == 1
    assert len(rings[0]["holes"]) == 1


def test_outer_rings_sorted_by_area_descending():
    """两圆不同半径时, 大圆排在前。"""
    mask = np.zeros((256, 256), dtype=np.uint8)
    import cv2

    cv2.circle(mask, (60, 128), 20, 1, thickness=-1)  # 小圆
    cv2.circle(mask, (180, 128), 40, 1, thickness=-1)  # 大圆

    rings = mask_to_multi_polygon(mask, tolerance=1.0)
    assert len(rings) == 2
    # 大圆顶点数应多于小圆（周长更长）
    assert len(rings[0]["exterior"]) > len(rings[1]["exterior"])


def test_bool_dtype_supported():
    mask = donut_mask(size=128, outer=40, inner=15).astype(bool)
    rings = mask_to_multi_polygon(mask, tolerance=0.5)
    assert len(rings) == 1
    assert len(rings[0]["holes"]) == 1
