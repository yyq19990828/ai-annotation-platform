"""v0.8.6 F1 · 协议 context.type 扩 text。

InteractiveRequest.context 仍是开放 dict（与 backend 协商空间不锁死），
但 schema docstring 与协议文档 §2.2 列出的 4 种 type 要随版本同步。
"""

from __future__ import annotations

import uuid

from app.schemas.ml_backend import InteractiveRequest


def test_interactive_request_accepts_point_type():
    req = InteractiveRequest(
        task_id=uuid.uuid4(),
        context={"type": "point", "points": [[0.5, 0.5]], "labels": [1]},
    )
    assert req.context["type"] == "point"


def test_interactive_request_accepts_bbox_type():
    req = InteractiveRequest(
        task_id=uuid.uuid4(),
        context={"type": "bbox", "bbox": [0.1, 0.1, 0.5, 0.5]},
    )
    assert req.context["type"] == "bbox"


def test_interactive_request_accepts_polygon_type():
    req = InteractiveRequest(
        task_id=uuid.uuid4(),
        context={"type": "polygon", "points": [[0.1, 0.1], [0.2, 0.2]]},
    )
    assert req.context["type"] == "polygon"


def test_interactive_request_accepts_text_type():
    """v0.9.x Grounded-SAM-2 文本批量入口 — schema 必须不拒绝。"""
    req = InteractiveRequest(
        task_id=uuid.uuid4(),
        context={"type": "text", "text": "ripe apples"},
    )
    assert req.context["type"] == "text"
    assert req.context["text"] == "ripe apples"


def test_interactive_request_accepts_unknown_type_no_strict_schema():
    """context 是开放 dict — 平台不校验，留给 backend 协商。"""
    req = InteractiveRequest(
        task_id=uuid.uuid4(),
        context={"type": "exemplar", "bbox": [0.1, 0.1, 0.5, 0.5]},
    )
    assert req.context["type"] == "exemplar"


def test_interactive_request_default_context_empty_dict():
    req = InteractiveRequest(task_id=uuid.uuid4())
    assert req.context == {}
