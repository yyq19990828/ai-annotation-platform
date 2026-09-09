"""Batch assignment invariants for active, role-matched project members."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.db.models.project_member import ProjectMember
from app.db.models.task_batch import TaskBatch
from app.schemas.batch import BatchCreate, BatchUpdate
from app.services.batch import BatchService
from tests.factory import create_project


pytestmark = pytest.mark.asyncio


async def _add_member(db, *, project_id, user_id, role, assigned_by):
    db.add(
        ProjectMember(
            project_id=project_id,
            user_id=user_id,
            role=role,
            assigned_by=assigned_by,
        )
    )
    await db.flush()


async def test_create_rejects_inactive_assignment_target(
    db_session, super_admin, annotator
):
    owner, _ = super_admin
    target, _ = annotator
    project = await create_project(db_session, owner_id=owner.id)
    await _add_member(
        db_session,
        project_id=project.id,
        user_id=target.id,
        role="annotator",
        assigned_by=owner.id,
    )
    target.is_active = False
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await BatchService(db_session).create(
            project.id,
            BatchCreate(name="inactive target", annotator_id=target.id),
            owner.id,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["reason"] == "assignment_user_unavailable"


async def test_update_rejects_assignment_target_without_project_role(
    db_session, super_admin, reviewer
):
    owner, _ = super_admin
    target, _ = reviewer
    project = await create_project(db_session, owner_id=owner.id)
    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id=f"B-GUARD-{uuid.uuid4().hex[:8]}",
        name="assignment target",
        status="draft",
    )
    db_session.add(batch)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await BatchService(db_session).update(
            batch.id,
            BatchUpdate(reviewer_id=target.id),
            project_id=project.id,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["reason"] == "assignment_project_member_required"
    await db_session.refresh(batch)
    assert batch.reviewer_id is None


async def test_bulk_reassign_rejects_inactive_target_before_batch_write(
    db_session, super_admin, reviewer
):
    owner, _ = super_admin
    target, _ = reviewer
    project = await create_project(db_session, owner_id=owner.id)
    await _add_member(
        db_session,
        project_id=project.id,
        user_id=target.id,
        role="reviewer",
        assigned_by=owner.id,
    )
    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id=f"B-GUARD-{uuid.uuid4().hex[:8]}",
        name="bulk assignment target",
        status="active",
    )
    db_session.add(batch)
    target.is_active = False
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await BatchService(db_session).bulk_reassign(
            project.id,
            [batch.id],
            annotator_id=None,
            reviewer_id=target.id,
            annotator_set=False,
            reviewer_set=True,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["reason"] == "assignment_user_unavailable"
    await db_session.refresh(batch)
    assert batch.reviewer_id is None
