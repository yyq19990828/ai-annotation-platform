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


def test_point_requires_points():
    """v0.18.17 · point 升级为 inst 单实例交互, 必须带 points."""
    ctx = Context(type="point", points=[[0.5, 0.5]], labels=[1])
    assert ctx.type == "point"
    with pytest.raises(ValidationError) as exc:
        Context(type="point")
    assert "context.points" in str(exc.value)


def test_interactive_box_requires_bbox():
    """v0.18.17 · interactive_box (单框单 mask) 必须带 bbox=[x1,y1,x2,y2]."""
    ctx = Context(type="interactive_box", bbox=[0.1, 0.1, 0.4, 0.4])
    assert ctx.type == "interactive_box"
    with pytest.raises(ValidationError) as exc:
        Context(type="interactive_box")
    assert "context.bbox" in str(exc.value)


def test_supported_types():
    """v0.18.17 supported_prompts: point / interactive_box / polygon / text / exemplar."""
    Context(type="polygon")  # 无额外校验
    Context(type="text")
    Context(type="point", points=[[0.5, 0.5]], labels=[1])
    Context(type="interactive_box", bbox=[0, 0, 1, 1])
    Context(type="exemplar", bbox=[0, 0, 1, 1])


def test_bbox_prompt_retired():
    """v0.18.17 · type=bbox 已退出交互 prompt 命名空间, 落 ValidationError."""
    with pytest.raises(ValidationError):
        Context(type="bbox", bbox=[0, 0, 1, 1])  # type: ignore[arg-type]


def test_invalid_type_rejected():
    with pytest.raises(ValidationError):
        Context(type="video_tracker")  # type: ignore[arg-type]  # sam3-backend 不接 video


def test_multimask_output_field():
    """v0.18.17 · point / interactive_box 候选开关, 缺省 False."""
    assert Context(type="point", points=[[0.5, 0.5]]).multimask_output is False
    ctx = Context(type="point", points=[[0.5, 0.5]], multimask_output=True)
    assert ctx.multimask_output is True


def test_score_threshold_field_present():
    """score_threshold (text / exemplar 路径)."""
    ctx = Context(type="text", text="cat", score_threshold=0.7)
    assert ctx.score_threshold == 0.7
