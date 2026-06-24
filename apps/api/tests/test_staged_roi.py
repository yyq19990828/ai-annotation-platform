"""v0.18.1 · 多阶段预标注 ROI 裁剪 + 属性回写纯函数单测 (路径 B M1).

- crop_inputs_from_boxes: 按 bbox 百分比裁 crop, pad 外扩, 跳过非 bbox / 旋转框。
- merge_classify_attributes: 下游分类结果 attributes 按 id 回写到对应父框 (union)。
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

import pytest
from PIL import Image

from app.workers.roi import (
    collect_geometry_shapes,
    crop_inputs_from_boxes,
    geometry_prompts_from_boxes,
    merge_classify_attributes,
)


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
    batch = crop_inputs_from_boxes(img, boxes, pad=0.0)
    assert len(batch.inputs) == 1
    assert batch.skipped_geometry == 0
    assert batch.inputs[0]["id"] == "0"
    crop = _decode(batch.inputs[0]["file_path"])
    assert crop.size == (200, 100)
    # pad 5% → 各边外扩 framaw*0.05=10px / frah*0.05=5px → 220x110
    batch_pad = crop_inputs_from_boxes(img, boxes, pad=0.05)
    crop_pad = _decode(batch_pad.inputs[0]["file_path"])
    assert crop_pad.size == (220, 110)


def test_crop_clamps_to_image_bounds():
    img = _img(100, 100)
    # 贴左上角的框, pad 会越界 → clamp 到 0
    boxes = [_bbox(0, 0, 50, 50)]
    batch = crop_inputs_from_boxes(img, boxes, pad=0.2)
    crop = _decode(batch.inputs[0]["file_path"])
    # 左/上 clamp 到 0, 右/下 外扩 50*0.2=10 → 60
    assert crop.size == (60, 60)


def test_crop_skips_non_bbox_and_rotated():
    img = _img(200, 200)
    boxes = [
        {"type": "polygonlabels", "value": {"points": [[0, 0], [1, 1]]}},
        {"type": "rectanglelabels", "value": {"x": 10, "y": 10, "width": 20, "height": 20, "rotation": 30}},
        _bbox(10, 10, 20, 20),  # idx 2: 唯一有效
    ]
    batch = crop_inputs_from_boxes(img, boxes, pad=0.0)
    assert len(batch.inputs) == 1
    assert batch.inputs[0]["id"] == "2"  # id 保留原下标, 供回写
    # 多边形 + 旋转框 → 几何不支持, 计入 skipped_geometry
    assert batch.skipped_geometry == 2


def test_crop_parent_class_filter_preserves_original_index():
    img = _img(200, 200)
    boxes = [_bbox(10, 10, 20, 20, cls="car"), _bbox(50, 50, 10, 10, cls="person")]
    batch = crop_inputs_from_boxes(img, boxes, pad=0.0, parent_class_filter=["person"])
    # 只裁 person (idx1), id 保留原下标 "1"
    assert len(batch.inputs) == 1
    assert batch.inputs[0]["id"] == "1"
    # car 被类别路由跳过 (非几何), 不计入 skipped_geometry
    assert batch.skipped_geometry == 0


def test_crop_presigned_delivery_uses_upload_fn():
    img = _img(200, 200)
    boxes = [_bbox(10, 10, 20, 20), _bbox(50, 50, 10, 10)]
    calls: list[int] = []

    def fake_upload(box_idx: int, jpeg_bytes: bytes) -> str:
        calls.append(box_idx)
        assert jpeg_bytes[:2] == b"\xff\xd8"  # JPEG SOI
        return f"http://store/crop-{box_idx}.jpg"

    batch = crop_inputs_from_boxes(
        img, boxes, pad=0.0, delivery="presigned", upload_fn=fake_upload
    )
    assert calls == [0, 1]
    assert batch.inputs[0]["file_path"] == "http://store/crop-0.jpg"
    assert batch.inputs[1]["file_path"] == "http://store/crop-1.jpg"


def test_crop_cache_reuses_across_sibling_stages():
    img = _img(200, 200)
    boxes = [_bbox(10, 10, 20, 20), _bbox(50, 50, 10, 10)]
    calls: list[int] = []

    def fake_upload(box_idx: int, jpeg_bytes: bytes) -> str:
        calls.append(box_idx)
        return f"http://store/crop-{box_idx}.jpg"

    cache: dict = {}
    # 两个并行兄弟阶段 target 同一批父框 (同 pad) → 第二次全部命中缓存, 不重复上传/编码。
    crop_inputs_from_boxes(
        img, boxes, pad=0.0, delivery="presigned", upload_fn=fake_upload, cache=cache
    )
    batch2 = crop_inputs_from_boxes(
        img, boxes, pad=0.0, delivery="presigned", upload_fn=fake_upload, cache=cache
    )
    # 上传/编码只发生一次 (2 个框各一次), 第二次零上传
    assert calls == [0, 1]
    assert batch2.inputs[0]["file_path"] == "http://store/crop-0.jpg"


def test_crop_presigned_without_upload_fn_raises():
    import pytest

    img = _img(100, 100)
    boxes = [_bbox(10, 10, 20, 20)]
    with pytest.raises(ValueError):
        crop_inputs_from_boxes(img, boxes, delivery="presigned")


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


# ── v0.18.12 · geometry-prompt 投递 (box-seg 下游) ──


def test_geometry_prompts_normalize_and_index():
    """LS 百分比 → 归一化 [0,1] [x1,y1,x2,y2]; parent_box_idx = 原下标。"""
    boxes = [_bbox(10, 20, 30, 40), _bbox(50, 50, 10, 10)]
    batch = geometry_prompts_from_boxes(boxes)
    assert batch.skipped_geometry == 0
    assert batch.prompts[0]["parent_box_idx"] == 0
    assert batch.prompts[0]["box"][0] == pytest.approx(0.1)
    assert batch.prompts[0]["box"][1] == pytest.approx(0.2)
    assert batch.prompts[0]["box"][2] == pytest.approx(0.4)  # (10+30)/100
    assert batch.prompts[0]["box"][3] == pytest.approx(0.6)  # (20+40)/100
    assert batch.prompts[1]["parent_box_idx"] == 1


def test_geometry_prompts_class_filter_keeps_original_index():
    """parent_class_filter 只对目标类生成 prompt, 但 parent_box_idx 保留原下标。"""
    boxes = [_bbox(0, 0, 10, 10, cls="person"), _bbox(20, 20, 10, 10, cls="car")]
    batch = geometry_prompts_from_boxes(boxes, parent_class_filter=["car"])
    assert len(batch.prompts) == 1
    assert batch.prompts[0]["parent_box_idx"] == 1  # car 在原下标 1
    assert batch.skipped_geometry == 0  # person 是路由跳过, 非几何跳过


def test_geometry_prompts_skips_rotated_and_degenerate():
    """旋转框 / 退化框计入 skipped_geometry, 不产 prompt。"""
    boxes = [
        {"type": "rectanglelabels",
         "value": {"x": 10, "y": 10, "width": 10, "height": 10, "rotation": 30}},
        _bbox(0, 0, 0, 10),  # 退化 (w=0)
        _bbox(30, 30, 20, 20),  # 有效
    ]
    batch = geometry_prompts_from_boxes(boxes)
    assert batch.skipped_geometry == 2
    assert len(batch.prompts) == 1
    assert batch.prompts[0]["parent_box_idx"] == 2


def test_collect_geometry_shapes_filters_bad_parent_idx():
    """收集下游 polygon: 保留合法 parent_box_idx, 丢越界项。"""
    boxes = [_bbox(0, 0, 10, 10)]
    seg = [
        _FakeResult("task-1", [
            {"type": "polygonlabels", "value": {"points": [[1, 1]]}, "parent_box_idx": 0},
            {"type": "polygonlabels", "value": {"points": [[2, 2]]}, "parent_box_idx": 9},  # 越界
            {"type": "polygonlabels", "value": {"points": [[3, 3]]}},  # 无 parent_box_idx → 保留
        ]),
    ]
    shapes = collect_geometry_shapes(seg, boxes)
    assert len(shapes) == 2
    assert shapes[0]["parent_box_idx"] == 0
