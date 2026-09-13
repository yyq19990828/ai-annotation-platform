"""Task-level Data Manager action invariants."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.schemas.data_manager_actions import (
    DataManagerTaskAssignmentApplyRequest,
    DataManagerTaskAssignmentRequest,
)
from app.services.data_management.actions import DataManagerTaskActionService
from tests.factory import create_project


pytestmark = pytest.mark.asyncio


async def _task(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    display_id: str,
    batch_id: uuid.UUID | None = None,
) -> Task:
    task = Task(
        project_id=project_id,
        batch_id=batch_id,
        display_id=display_id,
        file_name=f"{display_id}.jpg",
        file_path=f"items/{display_id}.jpg",
        file_type="image",
        status="pending",
    )
    db.add(task)
    await db.flush()
    return task


async def test_assignment_updates_only_explicit_tasks_across_batch_boundaries(
    db_session: AsyncSession, super_admin, annotator
):
    owner, _ = super_admin
    target, _ = annotator
    project = await create_project(db_session, owner_id=owner.id)
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=target.id,
            role="annotator",
            assigned_by=owner.id,
        )
    )
    batch = TaskBatch(
        project_id=project.id,
        display_id=f"B-DM-ACTION-{uuid.uuid4().hex[:8]}",
        name="partial selection",
        status="active",
    )
    db_session.add(batch)
    await db_session.flush()

    selected_in_batch = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-DM-SELECTED-{uuid.uuid4().hex[:8]}",
        batch_id=batch.id,
    )
    sibling_in_batch = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-DM-SIBLING-{uuid.uuid4().hex[:8]}",
        batch_id=batch.id,
    )
    selected_unbatched = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-DM-UNBATCHED-{uuid.uuid4().hex[:8]}",
    )

    payload = DataManagerTaskAssignmentRequest(
        task_ids=[selected_unbatched.id, selected_in_batch.id],
        annotator_id=target.id,
    )
    service = DataManagerTaskActionService(db_session)
    preview = await service.preview_assignment(project.id, payload, actor=owner)

    assert preview.eligible_count == 2
    assert preview.failed_count == 0
    assert {item.task_id for item in preview.items} == {
        selected_in_batch.id,
        selected_unbatched.id,
    }

    result = await service.apply_assignment(
        project.id,
        DataManagerTaskAssignmentApplyRequest(
            task_ids=payload.task_ids,
            annotator_id=target.id,
            preview_version=preview.preview_version,
        ),
        actor=owner,
    )
    assert result.succeeded == payload.task_ids

    await db_session.refresh(selected_in_batch)
    await db_session.refresh(selected_unbatched)
    await db_session.refresh(sibling_in_batch)
    assert selected_in_batch.assignee_id == target.id
    assert selected_unbatched.assignee_id == target.id
    assert sibling_in_batch.assignee_id is None


async def test_assignment_preview_becomes_stale_after_task_state_changes(
    db_session: AsyncSession, super_admin, annotator
):
    owner, _ = super_admin
    target, _ = annotator
    project = await create_project(db_session, owner_id=owner.id)
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=target.id,
            role="annotator",
            assigned_by=owner.id,
        )
    )
    task = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-DM-STALE-{uuid.uuid4().hex[:8]}",
    )
    payload = DataManagerTaskAssignmentRequest(
        task_ids=[task.id], annotator_id=target.id
    )
    service = DataManagerTaskActionService(db_session)
    preview = await service.preview_assignment(project.id, payload, actor=owner)

    task.status = "completed"
    await db_session.flush()

    apply_payload = DataManagerTaskAssignmentApplyRequest(
        task_ids=payload.task_ids,
        annotator_id=target.id,
        preview_version=preview.preview_version,
    )
    with pytest.raises(HTTPException) as exc:
        await service.apply_assignment(project.id, apply_payload, actor=owner)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "data_manager_assignment_preview_stale"
