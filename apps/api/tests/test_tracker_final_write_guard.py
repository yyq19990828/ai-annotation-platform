"""Direct runner final-write authority regressions for the tracker (B3).

No HTTP: the guard lives inside the runner after the fresh Task lock, so these
tests exercise the actual final-write path with a stale/current revocation and
an explicit actor requirement.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.project_member import ProjectMember
from app.services.video_tracking.runner import (
    TrackerJobStateConflict,
    _assert_tracker_actor_authority,
    _lock_task_bounded,
    accept_tracker_job,
    decide_tracker_job,
)
from tests.factory import create_project, create_task, create_user
from tests.test_video_tracker_jobs_list import _make_job, _make_video_task


async def _add_member(
    db: AsyncSession, *, project_id, user_id, role, assigned_by
) -> None:
    db.add(
        ProjectMember(
            project_id=project_id,
            user_id=user_id,
            role=role,
            assigned_by=assigned_by,
        )
    )
    await db.flush()


async def test_runner_guard_requires_explicit_actor(
    db_session: AsyncSession, super_admin
):
    owner, _ = super_admin
    project = await create_project(db_session, owner_id=owner.id, name="Guard Actor")
    task = await create_task(db_session, project_id=project.id, status="pending")
    await db_session.flush()

    with pytest.raises(TrackerJobStateConflict) as exc:
        await _assert_tracker_actor_authority(db_session, task, None)
    assert exc.value.detail["reason"] == "permission_changed"


async def test_runner_guard_denies_revoked_employee_actor(
    db_session: AsyncSession, super_admin
):
    owner, _ = super_admin
    project = await create_project(db_session, owner_id=owner.id, name="Guard Revoke")
    employee = await create_user(
        db_session, "employee", f"guard-{uuid.uuid4()}@test.local", "Guard"
    )
    await _add_member(
        db_session,
        project_id=project.id,
        user_id=employee.id,
        role="annotator",
        assigned_by=owner.id,
    )
    task = await create_task(db_session, project_id=project.id, status="pending")
    task.assignee_id = employee.id
    await db_session.commit()

    # Current membership + effective assignee: allowed.
    await _assert_tracker_actor_authority(db_session, task, employee.id)

    await db_session.execute(
        delete(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == employee.id,
        )
    )
    await db_session.commit()
    await db_session.refresh(employee)

    with pytest.raises(TrackerJobStateConflict) as exc:
        await _assert_tracker_actor_authority(db_session, task, employee.id)
    assert exc.value.detail["reason"] == "permission_changed"


async def test_accept_runner_authorizes_before_replay_exit(
    db_session: AsyncSession, super_admin
):
    """An idempotent ACCEPTED replay must not bypass current authority."""

    owner, _ = super_admin
    task, item = await _make_video_task(db_session, owner.id)
    employee = await create_user(
        db_session, "employee", f"replay-{uuid.uuid4()}@test.local", "Replay"
    )
    job = await _make_job(db_session, task, item, employee.id, status="accepted")
    await db_session.commit()

    with pytest.raises(TrackerJobStateConflict) as exc:
        await accept_tracker_job(db_session, job.id, actor_id=employee.id)
    assert exc.value.detail["reason"] == "permission_changed"

    with pytest.raises(TrackerJobStateConflict) as exc:
        await accept_tracker_job(db_session, job.id, actor_id=None)
    assert exc.value.detail["reason"] == "permission_changed"


async def test_accept_runner_denies_inactive_actor(
    db_session: AsyncSession, super_admin
):
    owner, _ = super_admin
    task, item = await _make_video_task(db_session, owner.id)
    employee = await create_user(
        db_session, "employee", f"inactive-{uuid.uuid4()}@test.local", "Inactive"
    )
    await _add_member(
        db_session,
        project_id=task.project_id,
        user_id=employee.id,
        role="annotator",
        assigned_by=owner.id,
    )
    employee.is_active = False
    job = await _make_job(db_session, task, item, employee.id, status="pending_review")
    await db_session.commit()

    with pytest.raises(TrackerJobStateConflict) as exc:
        await accept_tracker_job(db_session, job.id, actor_id=employee.id)
    assert exc.value.detail["reason"] == "permission_changed"


async def test_decide_runner_authorizes_before_selector_checks(
    db_session: AsyncSession, super_admin
):
    owner, _ = super_admin
    task, item = await _make_video_task(db_session, owner.id)
    employee = await create_user(
        db_session, "employee", f"decide-{uuid.uuid4()}@test.local", "Decide"
    )
    job = await _make_job(db_session, task, item, employee.id, status="pending_review")
    await db_session.commit()

    with pytest.raises(TrackerJobStateConflict) as exc:
        await decide_tracker_job(
            db_session,
            job.id,
            instance_ids=["missing"],
            from_frame=0,
            to_frame=0,
            decision="reject",
            expected_source_versions={},
            job_revision=1,
            actor_id=employee.id,
        )
    assert exc.value.detail["reason"] == "permission_changed"


async def test_tracker_task_lock_is_bounded_nowait(
    db_session: AsyncSession, test_engine, super_admin
):
    """An independently held Task lock yields a retryable conflict, not a wait."""

    owner, _ = super_admin
    project = await create_project(db_session, owner_id=owner.id, name="Guard Busy")
    task = await create_task(db_session, project_id=project.id, status="pending")
    await db_session.commit()

    async with test_engine.connect() as conn:
        trans = await conn.begin()
        await conn.execute(
            text("SELECT id FROM tasks WHERE id = :id FOR UPDATE"),
            {"id": str(task.id)},
        )
        with pytest.raises(TrackerJobStateConflict) as exc:
            await _lock_task_bounded(db_session, task.id)
        assert exc.value.detail["reason"] == "task_locked"
        await trans.rollback()


async def test_runner_guard_denies_self_review_evidence(
    db_session: AsyncSession, super_admin
):
    owner, _ = super_admin
    project = await create_project(db_session, owner_id=owner.id, name="Guard Self")
    employee = await create_user(
        db_session, "employee", f"guard-self-{uuid.uuid4()}@test.local", "Guard Self"
    )
    await _add_member(
        db_session,
        project_id=project.id,
        user_id=employee.id,
        role="reviewer",
        assigned_by=owner.id,
    )
    task = await create_task(db_session, project_id=project.id, status="review")
    task.annotation_contributor_ids = [str(employee.id)]
    task.review_round_id = uuid.uuid4()
    task.review_contributor_ids = [str(employee.id)]
    task.review_submitter_id = str(employee.id)
    await db_session.commit()

    with pytest.raises(TrackerJobStateConflict) as exc:
        await _assert_tracker_actor_authority(db_session, task, employee.id)
    assert exc.value.detail["reason"] == "self_review_denied"
