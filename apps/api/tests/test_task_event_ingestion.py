"""Trust-boundary and idempotency checks for Workbench time events."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select


def _project(owner_id: uuid.UUID, display_id: str):
    from app.db.models.project import Project

    return Project(
        id=uuid.uuid4(),
        display_id=display_id,
        name=display_id,
        type_label="图像检测",
        type_key="image-det",
        owner_id=owner_id,
    )


def _task(project_id: uuid.UUID, display_id: str):
    from app.db.models.task import Task

    return Task(
        id=uuid.uuid4(),
        project_id=project_id,
        display_id=display_id,
        file_name="image.jpg",
        file_path="image.jpg",
    )


def _event(task_id: uuid.UUID, project_id: uuid.UUID, event_id: uuid.UUID):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "client_id": str(event_id),
        "task_id": str(task_id),
        "project_id": str(project_id),
        "kind": "annotate",
        "started_at": (now - timedelta(seconds=2)).isoformat(),
        "ended_at": now.isoformat(),
        "duration_ms": 2_000,
        "collector_version": "session-v2",
    }


@pytest.mark.asyncio
async def test_task_event_derives_project_and_is_idempotent(
    httpx_client, annotator, db_session, monkeypatch
):
    from app.config import settings
    from app.db.models.task_event import TaskEvent

    user, token = annotator
    project = _project(user.id, "P-TE-TRUST")
    task = _task(project.id, "T-TE-TRUST")
    db_session.add_all([project, task])
    await db_session.flush()
    event_id = uuid.uuid4()
    payload = {"events": [_event(task.id, project.id, event_id)]}
    monkeypatch.setattr(settings, "task_events_async", False)

    for _ in range(2):
        response = await httpx_client.post(
            "/api/v1/auth/me/task-events:batch",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["accepted"] == 1

    row = (
        await db_session.execute(select(TaskEvent).where(TaskEvent.id == event_id))
    ).scalar_one()
    assert row.project_id == task.project_id
    assert row.collection_source == "session"
    assert row.collection_coverage == "qualified"
    assert (
        await db_session.scalar(
            select(func.count()).select_from(TaskEvent).where(TaskEvent.id == event_id)
        )
    ) == 1

    legacy_payload = _event(task.id, project.id, uuid.uuid4())
    legacy_payload.pop("collector_version")
    response = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json={"events": [legacy_payload]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    legacy = (
        await db_session.execute(
            select(TaskEvent).where(
                TaskEvent.id == uuid.UUID(legacy_payload["client_id"])
            )
        )
    ).scalar_one()
    assert legacy.collection_source == "legacy"
    assert legacy.collection_coverage == "unverified_collection"

    conflict = {"events": [{**payload["events"][0], "annotation_count": 1}]}
    response = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json=conflict,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["reason"] == "duplicate_client_event_conflict"


@pytest.mark.asyncio
async def test_task_event_rejects_conflicting_project_and_future_interval(
    httpx_client, annotator, db_session, monkeypatch
):
    from app.config import settings

    user, token = annotator
    project = _project(user.id, "P-TE-MISMATCH")
    task = _task(project.id, "T-TE-MISMATCH")
    db_session.add_all([project, task])
    await db_session.flush()
    monkeypatch.setattr(settings, "task_events_async", False)

    mismatch = _event(task.id, uuid.uuid4(), uuid.uuid4())
    response = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json={"events": [mismatch]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "task_project_mismatch"

    now = datetime.now(timezone.utc).replace(microsecond=0)
    future = _event(task.id, project.id, uuid.uuid4())
    future["started_at"] = now.isoformat()
    future["ended_at"] = (now + timedelta(seconds=2)).isoformat()
    response = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json={"events": [future]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "interval_in_future"


@pytest.mark.asyncio
async def test_final_close_requires_current_project_access(
    httpx_client, super_admin, annotator, db_session, monkeypatch
):
    from app.config import settings
    from app.db.models.project_member import ProjectMember
    from app.db.models.task_batch import TaskBatch

    owner, _ = super_admin
    user, token = annotator
    project = _project(owner.id, "P-TE-CLOSE")
    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id="B-TE-CLOSE",
        name="Batch",
        status="reviewing",
        annotator_id=user.id,
    )
    task = _task(project.id, "T-TE-CLOSE")
    task.batch_id = batch.id
    task.assignee_id = user.id
    task.status = "review"
    task.submitted_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.add(project)
    await db_session.flush()
    db_session.add(batch)
    await db_session.flush()
    db_session.add_all(
        [
            task,
            ProjectMember(project_id=project.id, user_id=user.id, role="annotator"),
        ]
    )
    await db_session.flush()
    monkeypatch.setattr(settings, "task_events_async", False)

    response = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json={"events": [_event(task.id, project.id, uuid.uuid4())]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text

    await db_session.execute(
        ProjectMember.__table__.delete().where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user.id,
        )
    )
    response = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json={"events": [_event(task.id, project.id, uuid.uuid4())]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404

    task.submitted_at = datetime.now(timezone.utc) - timedelta(minutes=6)
    await db_session.flush()
    stale = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json={"events": [_event(task.id, project.id, uuid.uuid4())]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert stale.status_code == 404


@pytest.mark.asyncio
async def test_worker_revalidates_payload_and_deduplicates(
    db_session, super_admin, monkeypatch
):
    from app.db.models.task_event import TaskEvent
    from app.workers.task_events import _async_persist

    user, _ = super_admin
    project = _project(user.id, "P-TE-WORKER")
    task = _task(project.id, "T-TE-WORKER")
    db_session.add_all([project, task])
    await db_session.flush()
    event_id = uuid.uuid4()
    payload = _event(task.id, project.id, event_id)
    payload = {
        **payload,
        "id": payload.pop("client_id"),
        "user_id": str(user.id),
    }
    foreign = {**payload, "project_id": str(uuid.uuid4())}

    @asynccontextmanager
    async def fake_task_session():
        yield db_session

    monkeypatch.setattr("app.workers._db.task_session", fake_task_session)
    inserted = await _async_persist([payload, payload, foreign])

    assert inserted == 1
    assert (
        await db_session.scalar(
            select(func.count()).select_from(TaskEvent).where(TaskEvent.id == event_id)
        )
    ) == 1
