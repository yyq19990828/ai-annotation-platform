"""catalog 自报运行时阈值 params 的契约测试(纯模块,无需引擎)。

平台据 model.params.properties 渲染阈值滑块;此处守住三个 model 各自暴露的阈值键
与取值域,避免回退到「无可调参数」。
"""
from __future__ import annotations

import catalog


def _params(model_id: str) -> dict:
    ent = {e["id"]: e for e in catalog.model_entries()}
    return (ent[model_id].get("params") or {}).get("properties", {})


def test_det_exposes_box_and_unclip():
    keys = set(_params(catalog.DET_MODEL_ID))
    assert keys == {"box_thresh", "unclip_ratio"}  # det 无 rec,不暴露 text_score


def test_rec_exposes_text_score_only():
    keys = set(_params(catalog.REC_MODEL_ID))
    assert keys == {"text_score"}  # rec 无 det,只暴露识别置信度


def test_e2e_exposes_all_three():
    keys = set(_params(catalog.E2E_MODEL_ID))
    assert keys == {"box_thresh", "unclip_ratio", "text_score"}


def test_threshold_schema_has_range_and_default():
    text_score = _params(catalog.E2E_MODEL_ID)["text_score"]
    assert text_score["type"] == "number"
    assert text_score["minimum"] == 0.0 and text_score["maximum"] == 1.0
    assert 0.0 <= text_score["default"] <= 1.0
