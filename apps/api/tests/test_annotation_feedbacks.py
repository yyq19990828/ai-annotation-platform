"""I18 · AnnotationFeedback 统一表 service + schema 测试."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.annotation_feedback import AnnotationFeedbackCreate
from app.services.feedback import FeedbackService
from tests.factory import create_project, create_task


def test_pixel_anchor_requires_position():
    with pytest.raises(ValidationError):
        AnnotationFeedbackCreate(
            kind="issue",
            anchor_type="pixel",
            project_id="00000000-0000-0000-0000-000000000001",
            task_id="00000000-0000-0000-0000-000000000002",
            body="missing position",
        )


def test_project_anchor_rejects_task_id():
    with pytest.raises(ValidationError):
        AnnotationFeedbackCreate(
            kind="comment",
            anchor_type="project",
            project_id="00000000-0000-0000-0000-000000000001",
            task_id="00000000-0000-0000-0000-000000000002",
            body="should fail",
        )


def test_annotation_anchor_requires_both_ids():
    with pytest.raises(ValidationError):
        AnnotationFeedbackCreate(
            kind="comment",
            anchor_type="annotation",
            project_id="00000000-0000-0000-0000-000000000001",
            task_id="00000000-0000-0000-0000-000000000002",
            body="missing annotation_id",
        )


@pytest.mark.asyncio
async def test_feedback_create_and_list(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = FeedbackService(db_session)
    issue = await svc.create(
        author_id=user.id,
        kind="issue",
        anchor_type="pixel",
        project_id=proj.id,
        task_id=task.id,
        annotation_id=None,
        anchor_position={"x": 0.5, "y": 0.3},
        severity="warn",
        title="漏标了一片区域",
        body="左上角缺一个人",
        attachments=[],
        thread_parent_id=None,
    )
    await db_session.flush()

    rows, cursor = await svc.list_paged(project_id=proj.id, limit=10)
    assert len(rows) == 1
    assert rows[0].id == issue.id
    assert rows[0].anchor_position["x"] == 0.5
    assert cursor is None


@pytest.mark.asyncio
async def test_feedback_patch_status_sets_resolved_at(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = FeedbackService(db_session)
    issue = await svc.create(
        author_id=user.id,
        kind="issue",
        anchor_type="task",
        project_id=proj.id,
        task_id=task.id,
        annotation_id=None,
        anchor_position=None,
        severity="info",
        title="t",
        body="b",
        attachments=[],
        thread_parent_id=None,
    )
    await db_session.flush()

    updated = await svc.patch(issue.id, actor_id=user.id, status="resolved")
    assert updated.status == "resolved"
    assert updated.resolved_at is not None
    assert updated.resolved_by_id == user.id

    reopened = await svc.patch(issue.id, actor_id=user.id, status="open")
    assert reopened.status == "open"
    assert reopened.resolved_at is None
    assert reopened.resolved_by_id is None
