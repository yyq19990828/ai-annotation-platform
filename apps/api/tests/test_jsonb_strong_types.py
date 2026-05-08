"""v0.6.4 · Pydantic JSONB 字段强类型化的回归测试。

把以前散落在 dict 里的 shape 拉成 Pydantic 模型后，应该：
- 合法 shape 通过
- 非法 shape 422
- 历史 bbox（不带 type）能 normalize 通过 OUT 路径
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas._jsonb_types import (
    AnnotationAttributes,
    Attachment,
    AuditDetail,
    AttributeField,
    AttributeSchema,
    BboxGeometry,
    CanvasDrawing,
    CanvasShape,
    ClassConfigEntry,
    Mention,
    PolygonGeometry,
)


# ── Geometry ────────────────────────────────────────────────────────


def test_bbox_geometry_required_fields():
    g = BboxGeometry(x=0.1, y=0.2, w=0.3, h=0.4)
    assert g.type == "bbox"
    assert g.x == 0.1


def test_polygon_geometry_min_3_points():
    PolygonGeometry(points=[[0, 0], [1, 0], [1, 1]])
    with pytest.raises(ValidationError):
        PolygonGeometry(points=[[0, 0], [1, 0]])


def test_polygon_geometry_pair_shape():
    with pytest.raises(ValidationError):
        PolygonGeometry(points=[[0, 0, 0], [1, 0, 0], [1, 1, 0]])


# ── Attribute schema ────────────────────────────────────────────────


def test_attribute_schema_unique_keys():
    AttributeSchema(
        fields=[
            AttributeField(key="a", label="A", type="text"),
            AttributeField(key="b", label="B", type="text"),
        ]
    )
    with pytest.raises(ValidationError):
        AttributeSchema(
            fields=[
                AttributeField(key="a", label="A", type="text"),
                AttributeField(key="a", label="B", type="text"),
            ]
        )


def test_attribute_schema_hotkey_constraints():
    # hotkey 字符必须 1-9
    with pytest.raises(ValidationError):
        AttributeField(key="x", label="X", type="boolean", hotkey="0")
    # hotkey 仅 boolean / select
    with pytest.raises(ValidationError):
        AttributeSchema(
            fields=[
                AttributeField(key="x", label="X", type="text", hotkey="1"),
            ]
        )
    # 重复 hotkey
    with pytest.raises(ValidationError):
        AttributeSchema(
            fields=[
                AttributeField(key="a", label="A", type="boolean", hotkey="1"),
                AttributeField(key="b", label="B", type="boolean", hotkey="1"),
            ]
        )


# ── ClassConfigEntry alias（v0.9.5）────────────────────────────────


def test_class_config_alias_optional_default_none():
    e = ClassConfigEntry(color="#ff0000", order=0)
    assert e.alias is None


def test_class_config_alias_ascii_allowed():
    e = ClassConfigEntry(alias="ripe apple")
    assert e.alias == "ripe apple"
    e2 = ClassConfigEntry(alias="cat,dog,bird")
    assert e2.alias == "cat,dog,bird"


def test_class_config_alias_rejects_chinese():
    with pytest.raises(ValidationError):
        ClassConfigEntry(alias="苹果")


def test_class_config_alias_rejects_overlong():
    with pytest.raises(ValidationError):
        ClassConfigEntry(alias="x" * 51)


# ── v0.9.6 · alias 规范化 ───────────────────────────────────────────


def test_class_config_alias_lowercased():
    """v0.9.6 · DINO 召回更稳, 前端用户输大小写都规范化为小写."""
    e = ClassConfigEntry(alias="Person")
    assert e.alias == "person"
    e2 = ClassConfigEntry(alias="RIPE APPLE")
    assert e2.alias == "ripe apple"


def test_class_config_alias_strips_whitespace():
    e = ClassConfigEntry(alias="  apple  ")
    assert e.alias == "apple"


def test_class_config_alias_collapses_whitespace_runs():
    e = ClassConfigEntry(alias="ripe   apple")
    assert e.alias == "ripe apple"


def test_class_config_alias_collapses_multiple_commas():
    """逗号 + 周边空白折叠为单 ','."""
    e = ClassConfigEntry(alias="cat,,dog")
    assert e.alias == "cat,dog"
    e2 = ClassConfigEntry(alias="a, , b")
    assert e2.alias == "a,b"
    e3 = ClassConfigEntry(alias="a ,, b")
    assert e3.alias == "a,b"


def test_class_config_alias_strips_leading_trailing_commas():
    e = ClassConfigEntry(alias=",foo,")
    assert e.alias == "foo"


def test_class_config_alias_empty_string_to_none():
    e = ClassConfigEntry(alias="")
    assert e.alias is None
    e2 = ClassConfigEntry(alias="   ")
    assert e2.alias is None


def test_attribute_field_select_requires_options():
    with pytest.raises(ValidationError):
        AttributeSchema(
            fields=[
                AttributeField(key="x", label="X", type="select"),
            ]
        )


# ── Comment 子类型 ──────────────────────────────────────────────────


def test_mention_via_alias():
    m = Mention.model_validate(
        {
            "userId": "11111111-1111-1111-1111-111111111111",
            "displayName": "Alice",
            "offset": 0,
            "length": 5,
        }
    )
    assert str(m.user_id) == "11111111-1111-1111-1111-111111111111"


def test_attachment_prefix_enforced():
    Attachment.model_validate(
        {
            "storageKey": "comment-attachments/foo.png",
            "fileName": "foo.png",
            "mimeType": "image/png",
            "size": 100,
        }
    )
    with pytest.raises(ValidationError):
        Attachment.model_validate(
            {
                "storageKey": "../etc/passwd",
                "fileName": "x",
                "mimeType": "image/png",
                "size": 1,
            }
        )


def test_canvas_drawing_shapes_typed():
    cd = CanvasDrawing(
        shapes=[
            CanvasShape(type="line", points=[0.1, 0.2, 0.3, 0.4], stroke="#ef4444"),
        ]
    )
    assert cd.shapes[0].type == "line"
    assert cd.shapes[0].points == [0.1, 0.2, 0.3, 0.4]
    # 不允许 extra
    with pytest.raises(ValidationError):
        CanvasShape.model_validate({"type": "line", "points": [0, 0], "extra": 1})


# ── Audit detail：extra=allow + 已知字段类型化 ─────────────────────


def test_audit_detail_extra_allowed():
    d = AuditDetail.model_validate(
        {
            "request_id": "abc",
            "task_id": "tid",
            "field_key": "color",
            "before": "red",
            "after": "blue",
            "anything": {"nested": True},
        }
    )
    assert d.request_id == "abc"
    # extra 字段保留
    assert d.model_extra == {"anything": {"nested": True}}


# ── AnnotationOut legacy bbox auto-normalize ───────────────────────


def test_annotation_out_normalizes_legacy_bbox():
    from app.schemas.annotation import AnnotationOut
    from datetime import datetime, timezone
    from uuid import uuid4

    out = AnnotationOut.model_validate(
        {
            "id": uuid4(),
            "task_id": uuid4(),
            "source": "manual",
            "annotation_type": "bbox",
            "class_name": "car",
            # 历史数据缺 type
            "geometry": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        }
    )
    assert isinstance(out.geometry, BboxGeometry)
    assert out.geometry.type == "bbox"


# ── AnnotationAttributes 元素类型受限 ───────────────────────────────


def test_annotation_attributes_value_types():
    from pydantic import TypeAdapter

    AA = TypeAdapter(AnnotationAttributes)
    AA.validate_python({"k1": "str", "k2": 1, "k3": True, "k4": ["a"], "k5": None})
    # multiselect 列表必须 str
    AA.validate_python({"k": ["a", "b"]})
