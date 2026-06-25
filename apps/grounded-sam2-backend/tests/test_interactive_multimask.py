"""v0.18.17 · predict_point / predict_bbox 的 multimask 候选 + 排序单测。

不加载 GPU, mock SAM predict, 验证:
- multimask_output 透传到 _sam_predictor.predict;
- 多候选按 score 降序 (results[0]=top-1, 与 sam3 _build_interactive_results 对齐);
- 单 mask (multimask_output=False) 路径不改顺序。
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import cv2
import numpy as np
import pytest
from PIL import Image


def _ensure_dino_module_stub():
    fake_dino_mod = types.ModuleType("groundingdino.util.inference")
    fake_dino_mod.predict = MagicMock()
    sys.modules.setdefault("groundingdino", types.ModuleType("groundingdino"))
    sys.modules.setdefault("groundingdino.util", types.ModuleType("groundingdino.util"))
    sys.modules["groundingdino.util.inference"] = fake_dino_mod


@pytest.fixture
def predictor():
    _ensure_dino_module_stub()
    from predictor import GroundedSAM2Predictor

    inst = GroundedSAM2Predictor.__new__(GroundedSAM2Predictor)
    inst.device = "cpu"
    inst.sam_variant = "tiny"
    inst.dino_variant = "T"
    inst._sam_predictor = MagicMock()
    inst.embedding_cache = MagicMock()
    inst.embedding_cache.get = MagicMock(return_value=None)
    inst.embedding_cache.put = MagicMock()
    return inst


def _circle(size: int = 256, r: int = 60) -> np.ndarray:
    m = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(m, (size // 2, size // 2), r, 1, thickness=-1)
    return m


def _img() -> Image.Image:
    return Image.fromarray(np.zeros((256, 256, 3), dtype=np.uint8))


def test_point_multimask_passthrough_and_sorted(predictor):
    """3 候选 score 乱序 → 透传 multimask=True, 结果按 score 降序。"""
    masks = np.stack([_circle()] * 3)  # (3, H, W)
    scores = np.array([0.5, 0.91, 0.7], dtype=np.float32)
    predictor._sam_predictor.predict = MagicMock(return_value=(masks, scores, None))

    results, _ = predictor.predict_point(
        _img(), [[0.5, 0.5]], [1], multimask_output=True, cache_key=None, simplify_tolerance=1.0
    )

    kw = predictor._sam_predictor.predict.call_args.kwargs
    assert kw["multimask_output"] is True
    assert len(results) == 3
    out_scores = [r["score"] for r in results]
    assert out_scores == sorted(out_scores, reverse=True)
    assert out_scores[0] == pytest.approx(0.91)


def test_point_single_mask_default(predictor):
    """缺省 multimask=False → 单 mask, 透传 False。"""
    predictor._sam_predictor.predict = MagicMock(
        return_value=(_circle()[None, ...], np.array([0.8]), None)
    )
    results, _ = predictor.predict_point(
        _img(), [[0.5, 0.5]], [1], cache_key=None, simplify_tolerance=1.0
    )
    assert predictor._sam_predictor.predict.call_args.kwargs["multimask_output"] is False
    assert len(results) == 1


def test_interactive_box_multimask_sorted(predictor):
    """predict_bbox (interactive_box 路由) 多候选同样按 score 降序。"""
    masks = np.stack([_circle()] * 2)
    scores = np.array([0.6, 0.95], dtype=np.float32)
    predictor._sam_predictor.predict = MagicMock(return_value=(masks, scores, None))

    results, _ = predictor.predict_bbox(
        _img(), [0.1, 0.1, 0.4, 0.4], multimask_output=True, cache_key=None, simplify_tolerance=1.0
    )
    assert predictor._sam_predictor.predict.call_args.kwargs["multimask_output"] is True
    out_scores = [r["score"] for r in results]
    assert out_scores == sorted(out_scores, reverse=True)
    assert out_scores[0] == pytest.approx(0.95)
