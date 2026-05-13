"""v0.10.0 · 协议 schemas 中 exemplar 类型的校验单测.

确认 Context.type='exemplar' 必须带 bbox=[x1,y1,x2,y2], 否则 pydantic 校验失败.
未来 v0.10.1 apps/api 路由层会再做项目挂载校验; 这层是 backend 自身的入口防御.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas import Context


def test_exemplar_requires_bbox():
    with pytest.raises(ValidationError) as exc:
        Context(type="exemplar")
    assert "context.bbox" in str(exc.value)


def test_exemplar_requires_bbox_length_4():
    with pytest.raises(ValidationError):
        Context(type="exemplar", bbox=[0.1, 0.2, 0.3])


def test_exemplar_with_valid_bbox():
    ctx = Context(type="exemplar", bbox=[0.2, 0.2, 0.45, 0.55])
    assert ctx.type == "exemplar"
    assert ctx.bbox == [0.2, 0.2, 0.45, 0.55]


def test_text_still_works_without_bbox():
    """exemplar 的强校验不应影响其他 prompt 类型."""
    ctx = Context(type="text", text="person")
    assert ctx.type == "text"
    assert ctx.bbox is None


def test_point_still_works_without_bbox():
    ctx = Context(type="point", points=[[0.5, 0.5]], labels=[1])
    assert ctx.type == "point"


def test_supported_types():
    """v0.10.0 supported_prompts: point / bbox / polygon / text / exemplar."""
    for t in ["point", "bbox", "polygon", "text"]:
        Context(type=t)  # no extra validation for these
    Context(type="exemplar", bbox=[0, 0, 1, 1])


def test_invalid_type_rejected():
    with pytest.raises(ValidationError):
        Context(type="video_tracker")  # v0.10.0 sam3-backend 不接 video; v0.11+


def test_score_threshold_field_present():
    """v0.10.0 新增 score_threshold (text / exemplar 路径)."""
    ctx = Context(type="text", text="cat", score_threshold=0.7)
    assert ctx.score_threshold == 0.7
