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
