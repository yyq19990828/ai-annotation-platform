"""v0.10.17 · AnnotationService class_name 软校验 + accept_prediction unit-scoped alias.

覆盖:
- create: tool_unit 配置了类集合且 class_name 不在内 → 422
- create: 集合为空 (旧项目 / 未配置) → 放行
- accept_prediction: 落库前同样走 _validate_class_name 校验
- accept_prediction: alias 只读 prediction.tool_unit_id 对应 unit 的 classes
  (强隔离, 不再跨 unit 走旧 classes_config union)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.db.models.prediction import Prediction
from app.services.annotation import AnnotationService
from tests.factory import create_project, create_task


def _tb(unit: str, classes: list[dict], attribute_schema=None) -> dict:
    return {
        unit: {
            "enabled": True,
            "classes": classes,
            "attribute_schema": attribute_schema or {"fields": []},
        }
    }


@pytest.mark.asyncio
async def test_create_class_name_not_in_allowed_raises_422(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    proj.tool_bindings = _tb("bbox", [{"name": "person", "order": 0}])
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc_info:
        await svc.create(
            task_id=task.id,
            user_id=user.id,
            annotation_type="bbox",
            class_name="cat",  # 不在 allowed=["person"] 内
            geometry={"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
            tool_unit_id="bbox",
        )
    assert exc_info.value.status_code == 422
    assert "cat" in exc_info.value.detail
    assert "bbox" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_allowed_class_passes(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    proj.tool_bindings = _tb("bbox", [{"name": "person", "order": 0}])
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    ann = await svc.create(
        task_id=task.id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="person",
        geometry={"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
        tool_unit_id="bbox",
    )
    assert ann.class_name == "person"
    assert ann.tool_unit_id == "bbox"


@pytest.mark.asyncio
async def test_create_empty_allowed_skips_validation(db_session, super_admin):
    """旧项目 tool_bindings 为空 → 集合空 → 放行 (向后兼容)."""
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    proj.tool_bindings = {}
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    ann = await svc.create(
        task_id=task.id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="anything",
        geometry={"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
        tool_unit_id="bbox",
    )
    assert ann.class_name == "anything"


@pytest.mark.asyncio
async def test_create_wrong_unit_does_not_match(db_session, super_admin):
    """tool_bindings 给的 bbox unit 配置, 但 create 传 tool_unit_id='ai_interactive':
    allowed=[] (该 unit 未配置) → 放行 (强隔离, 不跨 unit 借).
    """
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    proj.tool_bindings = _tb("bbox", [{"name": "person", "order": 0}])
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = AnnotationService(db_session)
    ann = await svc.create(
        task_id=task.id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="anything",  # 不在 bbox 的 allowed 内
        geometry={"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
        tool_unit_id="ai_interactive",  # 但走的是 ai_interactive unit
    )
    # ai_interactive 未配置, allowed=[], 放行.
    assert ann.tool_unit_id == "ai_interactive"


# ── accept_prediction ──────────────────────────────────────────────────────


async def _create_prediction(
    db_session, *, project_id, task_id, tool_unit_id: str, result: list[dict]
) -> Prediction:
    pred = Prediction(
        id=uuid.uuid4(),
        task_id=task_id,
        project_id=project_id,
        result=result,
        score=0.9,
        created_at=datetime.now(timezone.utc),
        tool_unit_id=tool_unit_id,
    )
    db_session.add(pred)
    await db_session.flush()
    return pred


@pytest.mark.asyncio
async def test_accept_prediction_alias_scoped_to_prediction_unit(
    db_session, super_admin
):
    """v0.10.17 强隔离: alias 反查必须限 prediction.tool_unit_id 对应 unit;
    旧实现走 classes_config union 会拿到错 unit 的同名类配置.
    """
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    # bbox unit: person.alias = 'person_ext'; ai_interactive unit: person.alias = 'object'
    proj.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": [
                {"name": "person", "alias": "person_ext", "order": 0},
            ],
            "attribute_schema": {"fields": []},
        },
        "ai_interactive": {
            "enabled": True,
            "classes": [
                {"name": "person", "alias": "object", "order": 0},
            ],
            "attribute_schema": {"fields": []},
        },
    }
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    # prediction 来自 ai_interactive (例如 SAM 候选), class_name="object" (alias) → 应回查到 person.
    pred = await _create_prediction(
        db_session,
        project_id=proj.id,
        task_id=task.id,
        tool_unit_id="ai_interactive",
        result=[
            {
                "type": "rectanglelabels",
                "geometry": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                "class_name": "object",  # ai_interactive unit 的 alias
                "tool_unit_id": "ai_interactive",
            }
        ],
    )

    svc = AnnotationService(db_session)
    ann = await svc.accept_prediction(pred.id, user.id)
    assert ann is not None
    assert ann.class_name == "person"
    assert ann.tool_unit_id == "ai_interactive"


@pytest.mark.asyncio
async def test_accept_prediction_raises_when_class_not_in_unit(db_session, super_admin):
    """v0.10.17 共享校验: accept_prediction 也必须过 _validate_class_name."""
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    # bbox unit 仅有 "person", 没有 "ghost".
    proj.tool_bindings = _tb("bbox", [{"name": "person", "order": 0}])
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    pred = await _create_prediction(
        db_session,
        project_id=proj.id,
        task_id=task.id,
        tool_unit_id="bbox",
        result=[
            {
                "type": "rectanglelabels",
                "geometry": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                "class_name": "ghost",  # 不在 bbox unit 内
                "tool_unit_id": "bbox",
            }
        ],
    )

    svc = AnnotationService(db_session)
    with pytest.raises(HTTPException) as exc_info:
        await svc.accept_prediction(pred.id, user.id)
    assert exc_info.value.status_code == 422
    assert "ghost" in exc_info.value.detail


@pytest.mark.asyncio
async def test_accept_prediction_no_match_pass_through_class_name(
    db_session, super_admin
):
    """无 alias 配置时 class_name 不变 (旧行为不破坏)."""
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    proj.tool_bindings = _tb("bbox", [{"name": "person", "order": 0}])
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    pred = await _create_prediction(
        db_session,
        project_id=proj.id,
        task_id=task.id,
        tool_unit_id="bbox",
        result=[
            {
                "type": "rectanglelabels",
                "geometry": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                "class_name": "person",
                "tool_unit_id": "bbox",
            }
        ],
    )

    svc = AnnotationService(db_session)
    ann = await svc.accept_prediction(pred.id, user.id)
    assert ann is not None
    assert ann.class_name == "person"
