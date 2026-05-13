"""v0.10.0 (vendor-aligned) · SAM3Predictor 行为单测.

绕开 __init__ 真实加载 (无 GPU + 不要触发 build_sam3_image_model 真实拉权重),
手工挂 mock Sam3Processor; 验证:
  - bbox 归一化 xyxy → 归一化 cxcywh 转换正确
  - text / bbox / exemplar 三种 prompt 都返回 polygonlabels
  - text "box" 输出模式跳过 mask → polygon, 给 rectanglelabels
  - text "both" 模式同 instance 配对 (rect+poly 交错)
  - score_threshold 单次覆盖会写到 processor.confidence_threshold
  - cache miss 时调 set_image, cache hit 时跳过
  - 0 mask 时返回空 list, 不抛错
  - reset_all_prompts 在 prompt 前后都会被调 (防 backbone_out 污染)
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import numpy as np
import pytest
import torch
from PIL import Image


@pytest.fixture
def fake_image():
    return Image.fromarray(np.full((480, 640, 3), 128, dtype=np.uint8))


@pytest.fixture
def predictor_with_mocks(monkeypatch):
    """构造一个不加载真实模型的 SAM3Predictor 实例."""
    # 注入伪 sam3 模块, 让 predictor.py 顶部 import 不挂.
    fake_sam3 = types.ModuleType("sam3")
    fake_sam3.build_sam3_image_model = MagicMock(return_value=MagicMock())
    sys.modules["sam3"] = fake_sam3
    fake_model_mod = types.ModuleType("sam3.model")
    sys.modules.setdefault("sam3.model", fake_model_mod)
    fake_processor_mod = types.ModuleType("sam3.model.sam3_image_processor")
    fake_processor_mod.Sam3Processor = MagicMock(return_value=MagicMock())
    sys.modules["sam3.model.sam3_image_processor"] = fake_processor_mod

    from predictor import SAM3Predictor  # noqa: PLC0415

    inst = SAM3Predictor.__new__(SAM3Predictor)
    inst.device = "cpu"
    inst.checkpoint_dir = "/tmp"
    inst.score_threshold = 0.5
    inst._model = MagicMock()
    inst._processor = MagicMock()
    inst._processor.confidence_threshold = 0.5
    inst.embedding_cache = MagicMock()
    inst.embedding_cache.get = MagicMock(return_value=None)
    inst.embedding_cache.put = MagicMock()
    return inst


# ---------- helpers ----------


def _fake_state_after_set_image(w: int = 640, h: int = 480) -> dict:
    """模拟 Sam3Processor.set_image 写入 state 的 keys."""
    return {
        "backbone_out": {"vision_features": MagicMock(name="vision_features")},
        "original_width": w,
        "original_height": h,
    }


def _populate_state_with_outputs(state: dict, num: int) -> None:
    """模拟 _forward_grounding 写入 state 的 boxes/masks/scores."""
    state["boxes"] = torch.tensor(
        [[100.0, 100.0, 300.0, 300.0]] * num, dtype=torch.float32
    )
    mask = torch.zeros((480, 640), dtype=torch.bool)
    mask[100:300, 100:300] = True
    masks = torch.stack([mask] * num).unsqueeze(1)  # (N, 1, H, W)
    state["masks"] = masks
    state["scores"] = torch.tensor([0.95, 0.88, 0.72][:num], dtype=torch.float32)


# ---------- predict_exemplar ----------


def test_exemplar_returns_polygonlabels(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)

    def add_geo(box, label, st):
        _populate_state_with_outputs(st, 2)
        return st

    inst._processor.add_geometric_prompt = MagicMock(side_effect=add_geo)
    inst._processor.reset_all_prompts = MagicMock()

    results, hit = inst.predict_exemplar(
        fake_image, exemplar_bbox=[0.2, 0.2, 0.45, 0.55], cache_key="k1"
    )

    assert hit is False
    assert len(results) == 2
    for r in results:
        assert r["type"] == "polygonlabels"
        assert r["value"]["polygonlabels"] == ["object"]
        for pt in r["value"]["points"]:
            assert 0.0 <= pt[0] <= 1.0 and 0.0 <= pt[1] <= 1.0


def test_exemplar_empty_when_no_match(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)

    # add_geometric_prompt 不写 masks → 空结果
    inst._processor.add_geometric_prompt = MagicMock(return_value=state)
    inst._processor.reset_all_prompts = MagicMock()

    results, _ = inst.predict_exemplar(
        fake_image, exemplar_bbox=[0.0, 0.0, 0.1, 0.1], cache_key="k_empty"
    )
    assert results == []


def test_exemplar_bbox_converted_to_cxcywh(predictor_with_mocks, fake_image):
    """归一化 xyxy [0.2, 0.2, 0.45, 0.55] → cxcywh [0.325, 0.375, 0.25, 0.35]."""
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)
    inst._processor.add_geometric_prompt = MagicMock(return_value=state)
    inst._processor.reset_all_prompts = MagicMock()

    inst.predict_exemplar(
        fake_image, exemplar_bbox=[0.2, 0.2, 0.45, 0.55], cache_key="k3"
    )

    call = inst._processor.add_geometric_prompt.call_args
    # 调用形式: add_geometric_prompt(box, True, state)
    box_arg = call.args[0]
    assert box_arg == pytest.approx([0.325, 0.375, 0.25, 0.35])
    assert call.args[1] is True


def test_exemplar_score_threshold_override(predictor_with_mocks, fake_image):
    """per-request score_threshold 写到 processor.confidence_threshold."""
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)
    inst._processor.add_geometric_prompt = MagicMock(return_value=state)
    inst._processor.reset_all_prompts = MagicMock()

    inst.predict_exemplar(
        fake_image, exemplar_bbox=[0.1, 0.1, 0.2, 0.2], cache_key="k4", score_threshold=0.85
    )

    assert inst._processor.confidence_threshold == 0.85


# ---------- predict_bbox (与 exemplar 同底层) ----------


def test_bbox_routes_to_same_geometric_call(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)

    def add_geo(box, label, st):
        _populate_state_with_outputs(st, 1)
        return st

    inst._processor.add_geometric_prompt = MagicMock(side_effect=add_geo)
    inst._processor.reset_all_prompts = MagicMock()

    results, _ = inst.predict_bbox(
        fake_image, bbox=[0.2, 0.2, 0.45, 0.55], cache_key="kb1"
    )

    assert len(results) == 1
    assert results[0]["type"] == "polygonlabels"
    inst._processor.add_geometric_prompt.assert_called_once()


# ---------- predict_text ----------


def test_text_mask_mode_returns_polygons(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)

    def set_text(prompt, st):
        _populate_state_with_outputs(st, 2)
        return st

    inst._processor.set_text_prompt = MagicMock(side_effect=set_text)
    inst._processor.reset_all_prompts = MagicMock()

    results, _ = inst.predict_text(fake_image, "person", cache_key="kt1")

    assert all(r["type"] == "polygonlabels" for r in results)
    assert len(results) == 2
    for r in results:
        assert r["value"]["polygonlabels"] == ["person"]


def test_text_box_mode_skips_simplify(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)

    def set_text(prompt, st):
        _populate_state_with_outputs(st, 2)
        return st

    inst._processor.set_text_prompt = MagicMock(side_effect=set_text)
    inst._processor.reset_all_prompts = MagicMock()

    results, _ = inst.predict_text(fake_image, "person", output="box", cache_key="kt2")

    assert len(results) == 2
    for r in results:
        assert r["type"] == "rectanglelabels"
        v = r["value"]
        assert {"x", "y", "width", "height", "rectanglelabels"}.issubset(v.keys())
        assert all(0.0 <= v[k] <= 1.0 for k in ("x", "y", "width", "height"))


def test_text_both_mode_pairs_rect_and_polygon(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)

    def set_text(prompt, st):
        _populate_state_with_outputs(st, 2)
        return st

    inst._processor.set_text_prompt = MagicMock(side_effect=set_text)
    inst._processor.reset_all_prompts = MagicMock()

    results, _ = inst.predict_text(fake_image, "person", output="both", cache_key="kt3")

    assert len(results) == 4
    assert results[0]["type"] == "rectanglelabels"
    assert results[1]["type"] == "polygonlabels"
    assert results[2]["type"] == "rectanglelabels"
    assert results[3]["type"] == "polygonlabels"


def test_text_returns_empty_when_pcs_finds_nothing(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)
    inst._processor.set_text_prompt = MagicMock(return_value=state)
    inst._processor.reset_all_prompts = MagicMock()

    results, _ = inst.predict_text(fake_image, "unicorn", output="box", cache_key="kt4")

    assert results == []


# ---------- cache 行为 ----------


def test_cache_miss_calls_set_image(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)
    inst._processor.add_geometric_prompt = MagicMock(return_value=state)
    inst._processor.reset_all_prompts = MagicMock()

    inst.predict_bbox(fake_image, bbox=[0.1, 0.1, 0.2, 0.2], cache_key="cm1")

    inst._processor.set_image.assert_called_once()
    inst.embedding_cache.put.assert_called_once()


def test_cache_hit_skips_set_image(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    # 设置 cache 返回一个有效 entry
    from embedding_cache import CacheEntry  # noqa: PLC0415

    inst.embedding_cache.get = MagicMock(
        return_value=CacheEntry(
            features={"vision_features": MagicMock()},
            orig_hw=(480, 640),
            is_batch=False,
            wh=(640, 480),
        )
    )
    inst._processor.set_image = MagicMock(return_value=state)

    def add_geo(box, label, st):
        _populate_state_with_outputs(st, 1)
        return st

    inst._processor.add_geometric_prompt = MagicMock(side_effect=add_geo)
    inst._processor.reset_all_prompts = MagicMock()

    # image=None: 命中时 _prime_state 不应调 set_image, 不需要 image
    results, hit = inst.predict_bbox(
        None, bbox=[0.1, 0.1, 0.2, 0.2], cache_key="ch1"
    )

    assert hit is True
    inst._processor.set_image.assert_not_called()
    inst.embedding_cache.put.assert_not_called()
    assert len(results) == 1


# ---------- reset_all_prompts 调用 ----------


def test_reset_called_before_and_after_prompt(predictor_with_mocks, fake_image):
    """防 backbone_out 被前一次 text prompt 污染 (state["language_features"] 等)."""
    inst = predictor_with_mocks
    state = _fake_state_after_set_image()
    inst._processor.set_image = MagicMock(return_value=state)

    def add_geo(box, label, st):
        _populate_state_with_outputs(st, 1)
        return st

    inst._processor.add_geometric_prompt = MagicMock(side_effect=add_geo)
    inst._processor.reset_all_prompts = MagicMock()

    inst.predict_bbox(fake_image, bbox=[0.1, 0.1, 0.2, 0.2], cache_key="kr1")

    # reset 应被调 2 次: prompt 前 (清除 stale) + prompt 后 (cleanup)
    assert inst._processor.reset_all_prompts.call_count == 2
