"""Feedback root filtering, exact counts and recursive thread reads."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.db.models.annotation_feedback import AnnotationFeedback
from tests.factory import create_project, create_task


def _feedback(
    *,
    author_id,
    project_id,
    task_id,
    body: str,
    parent_id=None,
    status: str = "open",
    active: bool = True,
    created_at: datetime,
    kind: str = "issue",
):
    return AnnotationFeedback(
        id=uuid4(),
        kind=kind,
        anchor_type="task",
        project_id=project_id,
        task_id=task_id,
        body=body,
        author_id=author_id,
        status=status,
        thread_parent_id=parent_id,
        is_active=active,
        created_at=created_at,
    )


@pytest.mark.asyncio
async def test_feedback_roots_counts_and_deleted_intermediate_thread(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    project = await create_project(db_session, owner_id=user.id)
    task = await create_task(db_session, project_id=project.id)
    other_task = await create_task(db_session, project_id=project.id)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)

    root = _feedback(
        author_id=user.id,
        project_id=project.id,
        task_id=task.id,
        body="root",
        created_at=start,
    )
    resolved_root = _feedback(
        author_id=user.id,
        project_id=project.id,
        task_id=task.id,
        body="resolved root",
        status="resolved",
        created_at=start + timedelta(seconds=1),
    )
    first_reply = _feedback(
        author_id=user.id,
        project_id=project.id,
        task_id=task.id,
        body="first reply",
        parent_id=root.id,
        created_at=start + timedelta(seconds=2),
    )
    deleted_intermediate = _feedback(
        author_id=user.id,
        project_id=project.id,
        task_id=task.id,
        body="deleted intermediate",
        parent_id=root.id,
        active=False,
        created_at=start + timedelta(seconds=3),
    )
    surviving_grandchild = _feedback(
        author_id=user.id,
        project_id=project.id,
        task_id=task.id,
        body="surviving grandchild",
        parent_id=deleted_intermediate.id,
        created_at=start + timedelta(seconds=4),
    )
    deleted_root = _feedback(
        author_id=user.id,
        project_id=project.id,
        task_id=other_task.id,
        body="deleted root",
        active=False,
        created_at=start + timedelta(seconds=5),
    )
    orphan = _feedback(
        author_id=user.id,
        project_id=project.id,
        task_id=other_task.id,
        body="orphan descendant",
        parent_id=deleted_root.id,
        created_at=start + timedelta(seconds=6),
    )
    db_session.add_all(
        [
            root,
            resolved_root,
            first_reply,
            deleted_intermediate,
            surviving_grandchild,
            deleted_root,
            orphan,
        ]
    )
    await db_session.flush()
    headers = {"Authorization": f"Bearer {token}"}

    listed = await httpx_client.get(
        "/api/v1/feedbacks",
        params={
            "project_id": str(project.id),
            "task_id": str(task.id),
            "kind": "issue",
            "root_only": "true",
            "include_counts": "true",
        },
        headers=headers,
    )
    assert listed.status_code == 200, listed.text
    payload = listed.json()
    assert [item["id"] for item in payload["items"]] == [
        str(resolved_root.id),
        str(root.id),
    ]
    assert payload["items"][0]["author_name"] == user.name
    assert payload["total"] == 2
    assert payload["status_counts"] == {
        "open": 1,
        "resolved": 1,
        "wont_fix": 0,
    }

    all_rows = await httpx_client.get(
        "/api/v1/feedbacks",
        params={
            "project_id": str(project.id),
            "task_id": str(task.id),
            "kind": "issue",
            "include_counts": "true",
        },
        headers=headers,
    )
    assert all_rows.status_code == 200, all_rows.text
    all_payload = all_rows.json()
    ids = {item["id"] for item in all_payload["items"]}
    assert ids == {
        str(root.id),
        str(resolved_root.id),
        str(first_reply.id),
        str(surviving_grandchild.id),
    }
    assert all_payload["total"] == 4

    first_page = await httpx_client.get(
        f"/api/v1/feedbacks/{root.id}/thread",
        params={"limit": 1},
        headers=headers,
    )
    assert first_page.status_code == 200, first_page.text
    first_payload = first_page.json()
    assert first_payload["total"] == 2
    assert len(first_payload["items"]) == 1
    assert first_payload["items"][0]["id"] == str(surviving_grandchild.id)
    assert first_payload["items"][0]["thread_parent_id"] == str(deleted_intermediate.id)
    assert first_payload["items"][0]["body"] == "surviving grandchild"

    second_page = await httpx_client.get(
        f"/api/v1/feedbacks/{root.id}/thread",
        params={"limit": 1, "cursor": first_payload["next_cursor"]},
        headers=headers,
    )
    assert second_page.status_code == 200, second_page.text
    assert [item["id"] for item in second_page.json()["items"]] == [str(first_reply.id)]
    assert second_page.json()["next_cursor"] is None

    unavailable = await httpx_client.get(
        f"/api/v1/feedbacks/{deleted_root.id}/thread", headers=headers
    )
    assert unavailable.status_code == 404
    malformed = await httpx_client.get(
        "/api/v1/feedbacks",
        params={"project_id": str(project.id), "cursor": "not-a-cursor"},
        headers=headers,
    )
    assert malformed.status_code == 400
