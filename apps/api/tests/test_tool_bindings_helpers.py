"""v0.10.17 · tool_bindings service helper 单测.

覆盖 services/project.py 的 derive_legacy_* / apply_tool_bindings_legacy_sync /
coalesce_legacy_into_tool_bindings / lookup_classes_for_tool_unit, 以及
services/prediction.py 的 derive_tool_unit_from_ls_type / derive_tool_unit_from_result.

这些 helper 是 v0.10.17 兼容层的核心, 双写 / 反向派生 / 工具单位查表都依赖它,
任何回归都会让旧 reader / 新 wizard / accept_prediction 至少一个分支错位.
"""

from __future__ import annotations

import pytest

from app.services.prediction import (
    derive_tool_unit_from_ls_type,
    derive_tool_unit_from_result,
)
from app.services.project import (
    apply_tool_bindings_legacy_sync,
    coalesce_legacy_into_tool_bindings,
    derive_legacy_attribute_schema,
    derive_legacy_classes_config,
    derive_legacy_classes_list,
    derive_tool_unit_for_type_key,
    lookup_classes_for_tool_unit,
)


# ── derive_tool_unit_from_ls_type / _from_result ───────────────────────────


@pytest.mark.parametrize(
    "ls_type, expected",
    [
        ("rectanglelabels", "bbox"),
        ("polygonlabels", "region"),
        ("brushlabels", "region"),
        ("multi_polygon", "region"),
        ("keypointlabels", "bbox"),  # 占位, v0.10.17 未实现 keypoint unit
        ("unknown_kind", "bbox"),
        (None, "bbox"),
    ],
)
def test_derive_tool_unit_from_ls_type(ls_type, expected):
    assert derive_tool_unit_from_ls_type(ls_type) == expected


def test_derive_tool_unit_from_result_empty_or_invalid():
    assert derive_tool_unit_from_result(None) == "bbox"
    assert derive_tool_unit_from_result([]) == "bbox"
    assert derive_tool_unit_from_result(["not-a-dict"]) == "bbox"


def test_derive_tool_unit_from_result_picks_first():
    result = [
        {"type": "polygonlabels", "value": {}},
        {"type": "rectanglelabels", "value": {}},
    ]
    assert derive_tool_unit_from_result(result) == "region"


# ── derive_tool_unit_for_type_key ──────────────────────────────────────────


@pytest.mark.parametrize(
    "type_key, expected",
    [
        ("image-seg", "region"),
        ("image-det", "bbox"),
        ("video-track", "bbox"),
        ("image-kp", "bbox"),
        ("lidar", "bbox"),
        (None, "bbox"),
        ("", "bbox"),
    ],
)
def test_derive_tool_unit_for_type_key(type_key, expected):
    assert derive_tool_unit_for_type_key(type_key) == expected


# ── derive_legacy_classes_config ───────────────────────────────────────────


def test_derive_legacy_classes_config_empty():
    assert derive_legacy_classes_config(None) == {}
    assert derive_legacy_classes_config({}) == {}


def test_derive_legacy_classes_config_skips_disabled_binding():
    tb = {
        "bbox": {
            "enabled": False,
            "classes": [{"name": "ignored", "color": "#fff"}],
        },
        "region": {
            "enabled": True,
            "classes": [{"name": "kept", "color": "#000"}],
        },
    }
    out = derive_legacy_classes_config(tb)
    assert "ignored" not in out
    assert out["kept"] == {"color": "#000"}


def test_derive_legacy_classes_config_first_occurrence_wins():
    tb = {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "person", "color": "#aaa", "alias": "p"}],
        },
        "region": {
            "enabled": True,
            "classes": [{"name": "person", "color": "#bbb", "alias": "x"}],
        },
    }
    out = derive_legacy_classes_config(tb)
    # 同名类强隔离 union: 取最先出现的 binding 配色 / alias.
    assert out["person"]["color"] == "#aaa"
    assert out["person"]["alias"] == "p"


def test_derive_legacy_classes_config_drops_empty_fields():
    tb = {
        "bbox": {
            "enabled": True,
            "classes": [
                {"name": "x", "color": None, "alias": "", "order": 0},
                {"name": "y", "color": "#fff"},
            ],
        }
    }
    out = derive_legacy_classes_config(tb)
    assert "color" not in out["x"]
    assert "alias" not in out["x"]
    assert out["x"]["order"] == 0
    assert out["y"] == {"color": "#fff"}


# ── derive_legacy_classes_list ─────────────────────────────────────────────


def test_derive_legacy_classes_list_sorts_by_order():
    tb = {
        "bbox": {
            "enabled": True,
            "classes": [
                {"name": "b", "order": 2},
                {"name": "a", "order": 0},
                {"name": "c", "order": 1},
            ],
        }
    }
    assert derive_legacy_classes_list(tb) == ["a", "c", "b"]


def test_derive_legacy_classes_list_missing_order_pushed_to_end():
    tb = {
        "bbox": {
            "enabled": True,
            "classes": [
                {"name": "no_order"},
                {"name": "ordered", "order": 5},
            ],
        }
    }
    out = derive_legacy_classes_list(tb)
    assert out == ["ordered", "no_order"]


def test_derive_legacy_classes_list_skips_dup_across_units():
    tb = {
        "bbox": {"enabled": True, "classes": [{"name": "person", "order": 0}]},
        "ai_interactive": {
            "enabled": True,
            "classes": [{"name": "person", "order": 9}],
        },
    }
    out = derive_legacy_classes_list(tb)
    assert out == ["person"]


# ── derive_legacy_attribute_schema ─────────────────────────────────────────


def test_derive_legacy_attribute_schema_union_first_wins():
    tb = {
        "bbox": {
            "enabled": True,
            "classes": [],
            "attribute_schema": {
                "fields": [
                    {"key": "occluded", "type": "boolean"},
                ]
            },
        },
        "region": {
            "enabled": True,
            "classes": [],
            "attribute_schema": {
                "fields": [
                    {"key": "occluded", "type": "select"},  # 重复 key 被丢弃
                    {"key": "color", "type": "string"},
                ]
            },
        },
    }
    out = derive_legacy_attribute_schema(tb)
    keys = [f["key"] for f in out["fields"]]
    assert keys == ["occluded", "color"]
    # 首次出现的版本保留
    assert out["fields"][0]["type"] == "boolean"


def test_derive_legacy_attribute_schema_empty_input():
    assert derive_legacy_attribute_schema(None) == {"fields": []}
    assert derive_legacy_attribute_schema({}) == {"fields": []}


# ── apply_tool_bindings_legacy_sync ────────────────────────────────────────


def test_apply_legacy_sync_writes_to_dict_target():
    target: dict = {}
    tb = {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "car", "color": "#f00", "order": 0}],
            "attribute_schema": {"fields": [{"key": "k1", "type": "boolean"}]},
        }
    }
    apply_tool_bindings_legacy_sync(target, tb)
    assert target["classes"] == ["car"]
    assert target["classes_config"] == {"car": {"color": "#f00", "order": 0}}
    assert target["attribute_schema"]["fields"][0]["key"] == "k1"


def test_apply_legacy_sync_none_is_noop():
    target = {"classes_config": {"keep": {}}, "classes": ["keep"]}
    apply_tool_bindings_legacy_sync(target, None)
    # None 不动 target.
    assert target == {"classes_config": {"keep": {}}, "classes": ["keep"]}


def test_apply_legacy_sync_object_target_uses_setattr():
    class _Stub:
        pass

    target = _Stub()
    tb = {"bbox": {"enabled": True, "classes": [{"name": "x", "order": 0}]}}
    apply_tool_bindings_legacy_sync(target, tb)
    assert target.classes == ["x"]
    assert target.classes_config == {"x": {"order": 0}}
    assert target.attribute_schema == {"fields": []}


# ── lookup_classes_for_tool_unit ───────────────────────────────────────────


def test_lookup_classes_for_tool_unit_disabled_returns_empty():
    tb = {
        "bbox": {
            "enabled": False,
            "classes": [{"name": "x"}],
        }
    }
    assert lookup_classes_for_tool_unit(tb, "bbox") == []


def test_lookup_classes_for_tool_unit_returns_names():
    tb = {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "a"}, {"name": "b"}],
        },
        "ai_interactive": {
            "enabled": True,
            "classes": [{"name": "c"}],
        },
    }
    assert lookup_classes_for_tool_unit(tb, "bbox") == ["a", "b"]
    assert lookup_classes_for_tool_unit(tb, "ai_interactive") == ["c"]


def test_lookup_classes_for_tool_unit_missing_unit():
    tb = {"bbox": {"enabled": True, "classes": []}}
    assert lookup_classes_for_tool_unit(tb, "region") == []
    assert lookup_classes_for_tool_unit(None, "bbox") == []


# ── coalesce_legacy_into_tool_bindings ─────────────────────────────────────


def test_coalesce_skips_when_tool_bindings_already_set():
    payload = {
        "tool_bindings": {
            "bbox": {"enabled": True, "classes": [{"name": "preserved"}]}
        },
        "classes": ["should_not_overwrite"],
    }
    coalesce_legacy_into_tool_bindings(payload, None, "image-det")
    assert payload["tool_bindings"]["bbox"]["classes"][0]["name"] == "preserved"


def test_coalesce_skips_when_no_legacy_keys():
    payload = {"name": "x"}
    coalesce_legacy_into_tool_bindings(payload, None, "image-det")
    assert "tool_bindings" not in payload


def test_coalesce_empty_dict_tool_bindings_is_treated_as_unset():
    # 模板 fixture 默认 tool_bindings={}, 应触发反向派生.
    payload = {"tool_bindings": {}, "classes": ["car"]}
    coalesce_legacy_into_tool_bindings(payload, None, "image-det")
    assert payload["tool_bindings"]["bbox"]["classes"] == [{"name": "car", "order": 0}]


def test_coalesce_classes_list_priority_over_cfg_map():
    payload = {
        "classes": ["explicit"],
        "classes_config": {"old_key": {"color": "#aaa"}},
    }
    coalesce_legacy_into_tool_bindings(payload, None, "image-det")
    names = [c["name"] for c in payload["tool_bindings"]["bbox"]["classes"]]
    assert names == ["explicit"]


def test_coalesce_cfg_map_supplies_color_for_class_name():
    payload = {
        "classes": ["car"],
        "classes_config": {"car": {"color": "#fff", "alias": "auto"}},
    }
    coalesce_legacy_into_tool_bindings(payload, None, "image-det")
    car = payload["tool_bindings"]["bbox"]["classes"][0]
    assert car["color"] == "#fff"
    assert car["alias"] == "auto"


def test_coalesce_image_seg_picks_region_unit():
    payload = {"classes": ["road"]}
    coalesce_legacy_into_tool_bindings(payload, None, "image-seg")
    assert "region" in payload["tool_bindings"]
    assert "bbox" not in payload["tool_bindings"]


def test_coalesce_preserves_other_units_from_existing():
    existing = {
        "ai_interactive": {
            "enabled": True,
            "classes": [{"name": "ai_kept", "order": 0}],
        }
    }
    payload = {"classes": ["car"]}
    coalesce_legacy_into_tool_bindings(payload, existing, "image-det")
    # bbox 被反向派生; ai_interactive 保留.
    assert payload["tool_bindings"]["bbox"]["classes"][0]["name"] == "car"
    assert payload["tool_bindings"]["ai_interactive"]["classes"][0]["name"] == "ai_kept"


def test_coalesce_backfill_color_from_prev_when_cfg_missing():
    """用户 PATCH attribute_schema 但没改 classes 时, 应保留原 bbox 配色."""
    existing = {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "car", "color": "#abc", "order": 0}],
        }
    }
    payload = {
        "classes": ["car"],
        "attribute_schema": {"fields": []},
    }
    coalesce_legacy_into_tool_bindings(payload, existing, "image-det")
    car = payload["tool_bindings"]["bbox"]["classes"][0]
    assert car["color"] == "#abc"


def test_coalesce_empty_class_name_skipped():
    payload = {"classes": ["", "valid"]}
    coalesce_legacy_into_tool_bindings(payload, None, "image-det")
    names = [c["name"] for c in payload["tool_bindings"]["bbox"]["classes"]]
    assert names == ["valid"]
