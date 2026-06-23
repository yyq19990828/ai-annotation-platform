"""v0.18.1 · 多阶段预标注 ROI 裁剪 + 属性回写纯函数单测 (路径 B M1).

- crop_inputs_from_boxes: 按 bbox 百分比裁 crop, pad 外扩, 跳过非 bbox / 旋转框。
- merge_classify_attributes: 下游分类结果 attributes 按 id 回写到对应父框 (union)。
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

from PIL import Image

from app.workers.roi import crop_inputs_from_boxes, merge_classify_attributes


def _img(w: int, h: int) -> Image.Image:
    return Image.new("RGB", (w, h), (123, 200, 50))


def _bbox(x, y, w, h, cls="car"):
    return {
        "type": "rectanglelabels",
        "value": {"x": x, "y": y, "width": w, "height": h, "rectanglelabels": [cls]},
    }


def _decode(data_uri: str) -> Image.Image:
    assert data_uri.startswith("data:image/jpeg;base64,")
    raw = base64.b64decode(data_uri.split(",", 1)[1])
    return Image.open(io.BytesIO(raw))


def test_crop_basic_pixel_mapping_and_pad():
    img = _img(1000, 500)
    # 框居中: 占图 20%x20%, 即 200x100 px, 左上 (400,200)
    boxes = [_bbox(40, 40, 20, 20)]
    inputs = crop_inputs_from_boxes(img, boxes, pad=0.0)
    assert len(inputs) == 1
    assert inputs[0]["id"] == "0"
    crop = _decode(inputs[0]["file_path"])
    assert crop.size == (200, 100)
    # pad 5% → 各边外扩 framaw*0.05=10px / frah*0.05=5px → 220x110
    inputs_pad = crop_inputs_from_boxes(img, boxes, pad=0.05)
    crop_pad = _decode(inputs_pad[0]["file_path"])
    assert crop_pad.size == (220, 110)


def test_crop_clamps_to_image_bounds():
    img = _img(100, 100)
    # 贴左上角的框, pad 会越界 → clamp 到 0
    boxes = [_bbox(0, 0, 50, 50)]
    inputs = crop_inputs_from_boxes(img, boxes, pad=0.2)
    crop = _decode(inputs[0]["file_path"])
    # 左/上 clamp 到 0, 右/下 外扩 50*0.2=10 → 60
    assert crop.size == (60, 60)


def test_crop_skips_non_bbox_and_rotated():
    img = _img(200, 200)
    boxes = [
        {"type": "polygonlabels", "value": {"points": [[0, 0], [1, 1]]}},
        {"type": "rectanglelabels", "value": {"x": 10, "y": 10, "width": 20, "height": 20, "rotation": 30}},
        _bbox(10, 10, 20, 20),  # idx 2: 唯一有效
    ]
    inputs = crop_inputs_from_boxes(img, boxes, pad=0.0)
    assert len(inputs) == 1
    assert inputs[0]["id"] == "2"  # id 保留原下标, 供回写


def test_crop_parent_class_filter_preserves_original_index():
    img = _img(200, 200)
    boxes = [_bbox(10, 10, 20, 20, cls="car"), _bbox(50, 50, 10, 10, cls="person")]
    inputs = crop_inputs_from_boxes(img, boxes, pad=0.0, parent_class_filter=["person"])
    # 只裁 person (idx1), id 保留原下标 "1"
    assert len(inputs) == 1
    assert inputs[0]["id"] == "1"


@dataclass
class _FakeResult:
    task_id: str
    result: list


def test_merge_attributes_union_by_id():
    boxes = [_bbox(0, 0, 10, 10), _bbox(20, 20, 10, 10)]
    # 下游对 box0 返回 color, box1 返回 color+vehicle_type
    classify = [
        _FakeResult("0", [{"type": "rectanglelabels", "score": 0.9, "attributes": {"color": "blue"}}]),
        _FakeResult("1", [{"type": "rectanglelabels", "score": 0.8, "attributes": {"color": "red", "vehicle_type": "bus"}}]),
    ]
    n = merge_classify_attributes(boxes, classify)
    assert n == 2
    assert boxes[0]["attributes"] == {"color": "blue"}
    assert boxes[1]["attributes"] == {"color": "red", "vehicle_type": "bus"}


def test_merge_picks_highest_score_and_respects_write_keys():
    boxes = [_bbox(0, 0, 10, 10)]
    classify = [
        _FakeResult(
            "0",
            [
                {"score": 0.3, "attributes": {"color": "black", "vehicle_type": "car"}},
                {"score": 0.95, "attributes": {"color": "white", "vehicle_type": "truck"}},
            ],
        )
    ]
    merge_classify_attributes(boxes, classify, write_keys=["color"])
    # 取最高分项 (white/truck), 但 write_keys 只留 color
    assert boxes[0]["attributes"] == {"color": "white"}


def test_merge_preserves_existing_attributes():
    boxes = [{"type": "rectanglelabels", "value": {"x": 0, "y": 0, "width": 10, "height": 10}, "attributes": {"existing": "keep"}}]
    classify = [_FakeResult("0", [{"score": 0.9, "attributes": {"color": "blue"}}])]
    merge_classify_attributes(boxes, classify)
    assert boxes[0]["attributes"] == {"existing": "keep", "color": "blue"}


def test_merge_ignores_out_of_range_or_empty():
    boxes = [_bbox(0, 0, 10, 10)]
    classify = [
        _FakeResult("9", [{"score": 0.9, "attributes": {"color": "blue"}}]),  # 越界
        _FakeResult("0", [{"score": 0.9, "attributes": {}}]),  # 空属性
    ]
    n = merge_classify_attributes(boxes, classify)
    assert n == 0
    assert "attributes" not in boxes[0] or not boxes[0].get("attributes")
