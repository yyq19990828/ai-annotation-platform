"""v0.9.7 fix · LabelStudio → 内部 schema adapter 测试."""

from __future__ import annotations

from app.services.prediction import to_internal_shape


def test_rectanglelabels_with_value_field():
    raw = {
        "type": "rectanglelabels",
        "score": 0.92,
        "value": {
            "x": 0.1,
            "y": 0.2,
            "width": 0.3,
            "height": 0.4,
            "rectanglelabels": ["car"],
        },
    }
    out = to_internal_shape(raw)
    assert out["type"] == "rectanglelabels"
    assert out["class_name"] == "car"
    assert out["confidence"] == 0.92
    assert out["geometry"] == {"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}


def test_polygonlabels_with_value_field():
    raw = {
        "type": "polygonlabels",
        "score": 0.85,
        "value": {
            "points": [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
            "polygonlabels": ["person"],
        },
    }
    out = to_internal_shape(raw)
    assert out["type"] == "polygonlabels"
    assert out["class_name"] == "person"
    assert out["confidence"] == 0.85
    assert out["geometry"] == {
        "type": "polygon",
        "points": [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
    }


def test_legacy_labels_field_fallback():
    """老格式: value.labels 而非 value.{type}."""
    raw = {
        "type": "rectanglelabels",
        "score": 0.5,
        "value": {"x": 0, "y": 0, "width": 1, "height": 1, "labels": ["bottle"]},
    }
    out = to_internal_shape(raw)
    assert out["class_name"] == "bottle"


def test_legacy_class_field_fallback():
    """更老格式: value.class 字符串."""
    raw = {
        "type": "rectanglelabels",
        "score": 0.7,
        "value": {"x": 0, "y": 0, "width": 1, "height": 1, "class": "dog"},
    }
    out = to_internal_shape(raw)
    assert out["class_name"] == "dog"


def test_already_internal_shape_passthrough():
    """已是内部 schema (向后兼容): 原样返回."""
    raw = {
        "type": "rectanglelabels",
        "class_name": "cat",
        "geometry": {"type": "bbox", "x": 0, "y": 0, "w": 1, "h": 1},
        "confidence": 0.9,
    }
    assert to_internal_shape(raw) == raw


def test_score_missing_falls_back_to_confidence():
    raw = {
        "type": "rectanglelabels",
        "confidence": 0.6,
        "value": {"x": 0, "y": 0, "width": 1, "height": 1, "rectanglelabels": ["a"]},
    }
    assert to_internal_shape(raw)["confidence"] == 0.6


def test_score_missing_defaults_to_zero():
    raw = {
        "type": "rectanglelabels",
        "value": {"x": 0, "y": 0, "width": 1, "height": 1, "rectanglelabels": ["a"]},
    }
    assert to_internal_shape(raw)["confidence"] == 0.0


def test_no_labels_returns_empty_class():
    raw = {
        "type": "rectanglelabels",
        "score": 0.9,
        "value": {"x": 0, "y": 0, "width": 1, "height": 1},
    }
    out = to_internal_shape(raw)
    assert out["class_name"] == ""


def test_unknown_type_returns_empty_geometry():
    raw = {"type": "keypoints", "score": 0.5, "value": {"x": 0.5, "y": 0.5}}
    out = to_internal_shape(raw)
    assert out["geometry"] == {}
    assert out["type"] == "keypoints"


def test_non_dict_input_safe():
    assert to_internal_shape(None) == {}
    assert to_internal_shape("garbage") == {}
    assert to_internal_shape([1, 2]) == {}


# ─── v0.9.8 黄金样本 — 锁定内部 schema 边界, 防止再次漂移 ────────────────────


def test_idempotent_on_internal_shape():
    """to_internal_shape 二次调用同形态结果 — 即 read path 多次应用安全."""
    raw = {
        "type": "rectanglelabels",
        "score": 0.9,
        "value": {
            "x": 0.1,
            "y": 0.2,
            "width": 0.3,
            "height": 0.4,
            "rectanglelabels": ["car"],
        },
    }
    once = to_internal_shape(raw)
    twice = to_internal_shape(once)
    assert once == twice


def test_dual_presence_value_and_geometry_prefers_geometry():
    """v0.9.7 fix 边界: 当后端写入既含 LS value 又含内部 geometry (老 fixture / 迁移期)
    时, geometry 优先 pass-through, 不再二次解释 value."""
    raw = {
        "type": "rectanglelabels",
        "geometry": {"type": "bbox", "x": 0, "y": 0, "w": 1, "h": 1},
        "class_name": "internal-cls",
        "confidence": 0.42,
        "score": 0.99,
        "value": {
            "x": 0.5,
            "y": 0.5,
            "width": 0.5,
            "height": 0.5,
            "rectanglelabels": ["ls-cls"],
        },
    }
    out = to_internal_shape(raw)
    # geometry 路径胜出 — internal-cls / 0.42 / 0/0/1/1, 而非 ls-cls / 0.99
    assert out["class_name"] == "internal-cls"
    assert out["confidence"] == 0.42
    assert out["geometry"] == {"type": "bbox", "x": 0, "y": 0, "w": 1, "h": 1}


def test_geometry_passthrough_preserves_unknown_fields():
    """已是内部 shape 时 pass-through 不丢非标字段 (前端可能附带 extra meta)."""
    raw = {
        "type": "rectanglelabels",
        "geometry": {"type": "bbox", "x": 0, "y": 0, "w": 1, "h": 1},
        "class_name": "x",
        "confidence": 0.5,
        "extra_meta": {"hint": "from-sam"},
    }
    out = to_internal_shape(raw)
    assert out is raw  # 同一对象返回, 字段无损
    assert out["extra_meta"] == {"hint": "from-sam"}
