"""Durable idempotency for task annotation creation."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.db.models.annotation import Annotation
from app.db.models.annotation_operation import AnnotationOperation
from tests.factory import create_project, create_task


def _bearer(token: str, **extra: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", **extra}


def _payload() -> dict:
    return {
        "annotation_type": "bbox",
        "class_name": "car",
        "geometry": {"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
    }


async def _seed(db_session, super_admin):
    user, token = super_admin
    project = await create_project(db_session, owner_id=user.id)
    task = await create_task(db_session, project_id=project.id, status="in_progress")
    return task, token


@pytest.mark.asyncio
async def test_create_annotation_replays_durable_receipt(
    httpx_client, db_session, super_admin
):
    task, token = await _seed(db_session, super_admin)
    key = f"offline-create-{uuid.uuid4()}"
    headers = _bearer(token, **{"Idempotency-Key": key})

    first = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_payload(),
        headers=headers,
    )
    second = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_payload(),
        headers=headers,
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert second.json() == first.json()

    count = await db_session.scalar(
        select(func.count())
        .select_from(Annotation)
        .where(Annotation.task_id == task.id)
    )
    assert count == 1
    operation = await db_session.scalar(
        select(AnnotationOperation).where(
            AnnotationOperation.task_id == task.id,
            AnnotationOperation.actor_id == super_admin[0].id,
            AnnotationOperation.idempotency_key == key,
        )
    )
    assert operation is not None
    assert operation.kind == "create_annotation"
    assert operation.response_json == first.json()


@pytest.mark.asyncio
async def test_create_annotation_rejects_key_reuse_with_changed_request(
    httpx_client, db_session, super_admin
):
    task, token = await _seed(db_session, super_admin)
    key = f"offline-create-{uuid.uuid4()}"
    headers = _bearer(token, **{"Idempotency-Key": key})

    first = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_payload(),
        headers=headers,
    )
    changed = {**_payload(), "class_name": "person"}
    conflict = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=changed,
        headers=headers,
    )

    assert first.status_code == 201, first.text
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["detail"]["reason"] == "idempotency_conflict"
    count = await db_session.scalar(
        select(func.count())
        .select_from(Annotation)
        .where(Annotation.task_id == task.id)
    )
    assert count == 1


@pytest.mark.asyncio
async def test_create_annotation_without_key_keeps_legacy_behavior(
    httpx_client, db_session, super_admin
):
    task, token = await _seed(db_session, super_admin)
    headers = _bearer(token)

    first = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_payload(),
        headers=headers,
    )
    second = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_payload(),
        headers=headers,
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert second.json()["id"] != first.json()["id"]
    count = await db_session.scalar(
        select(func.count())
        .select_from(Annotation)
        .where(Annotation.task_id == task.id)
    )
    assert count == 2


@pytest.mark.asyncio
async def test_create_annotation_rejects_invalid_idempotency_key(
    httpx_client, db_session, super_admin
):
    task, token = await _seed(db_session, super_admin)
    response = await httpx_client.post(
        f"/api/v1/tasks/{task.id}/annotations",
        json=_payload(),
        headers=_bearer(token, **{"Idempotency-Key": " "}),
    )

    assert response.status_code == 400, response.text
    count = await db_session.scalar(
        select(func.count())
        .select_from(Annotation)
        .where(Annotation.task_id == task.id)
    )
    assert count == 0
