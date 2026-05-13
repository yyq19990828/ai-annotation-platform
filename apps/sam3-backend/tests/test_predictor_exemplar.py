"""v0.10.0 · SAM3Predictor.predict_exemplar 行为单测 (无 GPU, mock SAM 3 image predictor).

绕开 __init__ 真实加载, 手工挂 mock 子组件; 验证:
  - 视觉示例 bbox 归一化 → 像素坐标转换正确
  - 返回的 polygonlabels 字面与 grounded-sam2 _rings_to_polygon_label 一致
  - DINO/text 路径同样 mock 通过 (与 grounded-sam2 test_predict_text_output_modes 对齐)
  - score_threshold 可单次覆盖
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import numpy as np
import pytest
from PIL import Image


@pytest.fixture
def fake_image():
    return Image.fromarray(np.full((480, 640, 3), 128, dtype=np.uint8))


@pytest.fixture
def predictor_with_mocks(monkeypatch):
    """构造一个不加载真实 GPU 模型的 SAM3Predictor 实例.

    注入伪 `sam3` 模块, 让 predictor.py 顶部的 `from sam3 import build_sam3_image_model`
    在 import 期就成功 (即便没有真实 vendor).
    """
    fake_sam3_mod = types.ModuleType("sam3")
    fake_sam3_mod.build_sam3_image_model = MagicMock(return_value=MagicMock())
    sys.modules["sam3"] = fake_sam3_mod

    from predictor import SAM3Predictor

    inst = SAM3Predictor.__new__(SAM3Predictor)
    inst.device = "cpu"
    inst.checkpoint_dir = "/tmp"
    inst.score_threshold = 0.5
    inst._image_predictor = MagicMock()
    inst.embedding_cache = MagicMock()
    inst.embedding_cache.get = MagicMock(return_value=None)
    inst.embedding_cache.put = MagicMock()
    return inst


def _fake_pcs_exemplar_return(num_instances: int = 2):
    """模拟 SAM 3 PCS exemplar 返回: (boxes_px, masks, scores)."""
    boxes = np.array([[100.0, 100.0, 300.0, 300.0]] * num_instances, dtype=np.float32)
    mask = np.zeros((480, 640), dtype=np.uint8)
    mask[100:300, 100:300] = 1
    masks = np.stack([mask] * num_instances)
    scores = np.array([0.95, 0.88])[:num_instances]
    return boxes, masks, scores


# ---------- predict_exemplar ----------


def test_exemplar_returns_polygonlabels(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    inst._image_predictor.predict_exemplar = MagicMock(return_value=_fake_pcs_exemplar_return(2))

    results, hit = inst.predict_exemplar(
        fake_image, exemplar_bbox=[0.2, 0.2, 0.45, 0.55], cache_key="k1"
    )

    assert hit is False, "首次 miss"
    assert len(results) == 2
    for r in results:
        assert r["type"] == "polygonlabels"
        assert r["value"]["polygonlabels"] == ["object"]
        assert "points" in r["value"]
        # 顶点已归一化 [0,1]
        for pt in r["value"]["points"]:
            assert 0.0 <= pt[0] <= 1.0 and 0.0 <= pt[1] <= 1.0


def test_exemplar_empty_when_no_match(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    inst._image_predictor.predict_exemplar = MagicMock(
        return_value=(np.empty((0, 4)), np.empty((0, 480, 640)), np.empty(0))
    )

    results, hit = inst.predict_exemplar(
        fake_image, exemplar_bbox=[0.0, 0.0, 0.1, 0.1], cache_key="k_empty"
    )

    assert results == []
    assert hit is False


def test_exemplar_score_threshold_override(predictor_with_mocks, fake_image):
    """传入 score_threshold 覆盖 backend 默认 0.5."""
    inst = predictor_with_mocks
    inst._image_predictor.predict_exemplar = MagicMock(return_value=_fake_pcs_exemplar_return(1))

    inst.predict_exemplar(
        fake_image,
        exemplar_bbox=[0.2, 0.2, 0.45, 0.55],
        cache_key="k2",
        score_threshold=0.85,
    )

    call_kwargs = inst._image_predictor.predict_exemplar.call_args.kwargs
    assert call_kwargs["score_threshold"] == 0.85


def test_exemplar_bbox_translated_to_pixels(predictor_with_mocks, fake_image):
    """归一化 [0.2, 0.2, 0.45, 0.55] 在 640x480 上应得到像素 [128, 96, 288, 264]."""
    inst = predictor_with_mocks
    inst._image_predictor.predict_exemplar = MagicMock(return_value=_fake_pcs_exemplar_return(1))

    inst.predict_exemplar(
        fake_image, exemplar_bbox=[0.2, 0.2, 0.45, 0.55], cache_key="k3"
    )

    call_kwargs = inst._image_predictor.predict_exemplar.call_args.kwargs
    px = call_kwargs["exemplar_box"]
    np.testing.assert_allclose(px, [128.0, 96.0, 288.0, 264.0], rtol=0, atol=1e-3)


# ---------- predict_text ----------


def test_text_box_mode_skips_simplify(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    inst._image_predictor.predict_text = MagicMock(
        return_value=(
            np.array([[100.0, 100.0, 300.0, 300.0], [50.0, 50.0, 150.0, 150.0]], dtype=np.float32),
            np.zeros((2, 480, 640), dtype=np.uint8),
            np.array([0.9, 0.85]),
            ["person", "person"],
        )
    )

    results, _ = inst.predict_text(fake_image, "person", output="box", cache_key="kt1")

    assert len(results) == 2
    for r in results:
        assert r["type"] == "rectanglelabels"
        v = r["value"]
        assert {"x", "y", "width", "height", "rectanglelabels"}.issubset(v.keys())
        assert all(0.0 <= v[k] <= 1.0 for k in ("x", "y", "width", "height"))


def test_text_mask_mode_returns_polygons(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    mask = np.zeros((480, 640), dtype=np.uint8)
    mask[100:300, 100:300] = 1
    inst._image_predictor.predict_text = MagicMock(
        return_value=(
            np.array([[100.0, 100.0, 300.0, 300.0], [100.0, 100.0, 300.0, 300.0]], dtype=np.float32),
            np.stack([mask, mask]),
            np.array([0.95, 0.92]),
            ["person", "person"],
        )
    )

    results, _ = inst.predict_text(fake_image, "person", cache_key="kt2")

    assert all(r["type"] == "polygonlabels" for r in results)
    assert len(results) == 2


def test_text_both_mode_pairs_rect_and_polygon(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    mask = np.zeros((480, 640), dtype=np.uint8)
    mask[100:300, 100:300] = 1
    inst._image_predictor.predict_text = MagicMock(
        return_value=(
            np.array([[100.0, 100.0, 300.0, 300.0], [50.0, 50.0, 150.0, 150.0]], dtype=np.float32),
            np.stack([mask, mask]),
            np.array([0.95, 0.92]),
            ["person", "person"],
        )
    )

    results, _ = inst.predict_text(fake_image, "person", output="both", cache_key="kt3")

    assert len(results) == 4
    assert results[0]["type"] == "rectanglelabels"
    assert results[1]["type"] == "polygonlabels"
    assert results[2]["type"] == "rectanglelabels"
    assert results[3]["type"] == "polygonlabels"


def test_text_returns_empty_when_pcs_finds_nothing(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    inst._image_predictor.predict_text = MagicMock(
        return_value=(np.empty((0, 4)), np.empty((0, 480, 640)), np.empty(0), [])
    )

    results, _ = inst.predict_text(fake_image, "unicorn", output="box", cache_key="kt4")

    assert results == []


# ---------- predict_point / predict_bbox 也走 _prime_sam, 这里仅 smoke 一下 ----------


def test_point_returns_polygons(predictor_with_mocks, fake_image):
    inst = predictor_with_mocks
    mask = np.zeros((480, 640), dtype=np.uint8)
    mask[100:300, 100:300] = 1
    inst._image_predictor.predict = MagicMock(
        return_value=(mask[None, ...], np.array([0.95]), None)
    )

    results, _ = inst.predict_point(
        fake_image, points=[[0.5, 0.5]], labels=[1], cache_key="kp1"
    )

    assert len(results) == 1
    assert results[0]["type"] == "polygonlabels"
    assert results[0]["value"]["polygonlabels"] == ["object"]
