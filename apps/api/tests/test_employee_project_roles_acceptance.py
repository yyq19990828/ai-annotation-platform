"""Coordinator-owned HTTP acceptance for one employee across three projects."""

import uuid

import pytest

from app.core.security import create_access_token
from app.db.models.project_member import ProjectMember
from tests.factory import create_batch, create_project, create_task, create_user


@pytest.mark.asyncio
async def test_employee_annotates_a_reviews_b_and_cannot_access_c(
    httpx_client, db_session
):
    owners = [
        await create_user(
            db_session, "project_admin", f"owner-{uuid.uuid4()}@test.local", name
        )
        for name in ("Owner A", "Owner B")
    ]
    employee, colleague = [
        await create_user(
            db_session, "employee", f"staff-{uuid.uuid4()}@test.local", name
        )
        for name in ("Employee U", "Employee V")
    ]
    project_a = await create_project(db_session, owner_id=owners[0].id, name="A")
    project_b = await create_project(db_session, owner_id=owners[1].id, name="B")
    project_c = await create_project(db_session, owner_id=owners[1].id, name="C")
    for project, owner, annotator, reviewer in (
        (project_a, owners[0], employee, colleague),
        (project_b, owners[1], colleague, employee),
    ):
        db_session.add_all(
            ProjectMember(
                project_id=project.id,
                user_id=user.id,
                role=role,
                assigned_by=owner.id,
            )
            for user, role in ((annotator, "annotator"), (reviewer, "reviewer"))
        )

    batch_a = await create_batch(
        db_session, project_id=project_a.id, status="annotating"
    )
    batch_a.annotator_id, batch_a.reviewer_id = employee.id, colleague.id
    task_a = await create_task(
        db_session, project_id=project_a.id, status="in_progress"
    )
    task_a.batch_id, task_a.assignee_id = batch_a.id, employee.id

    batch_b = await create_batch(
        db_session, project_id=project_b.id, status="reviewing"
    )
    batch_b.annotator_id, batch_b.reviewer_id = colleague.id, employee.id
    task_b = await create_task(db_session, project_id=project_b.id, status="review")
    task_b.batch_id, task_b.assignee_id = batch_b.id, colleague.id
    task_b.reviewer_id = employee.id
    task_b.annotation_contributor_ids = [str(colleague.id)]
    task_b.review_contributor_ids = [str(colleague.id)]
    task_b.review_submitter_id = colleague.id
    task_b.review_round_id = uuid.uuid4()
    pending_b = await create_task(db_session, project_id=project_b.id)
    pending_b.assignee_id = colleague.id
    task_c = await create_task(db_session, project_id=project_c.id)
    # Assignment alone must not grant project authority.
    task_c.assignee_id = employee.id
    await db_session.flush()

    headers = {
        "Authorization": "Bearer "
        + create_access_token(subject=str(employee.id), role="employee")
    }
    annotation = {
        "annotation_type": "bbox",
        "class_name": "car",
        "geometry": {"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
    }
    for task, operation, payload in (
        (task_a, "review/claim", None),
        (pending_b, "annotations", annotation),
        (task_c, "annotations", annotation),
    ):
        response = await httpx_client.post(
            f"/api/v1/tasks/{task.id}/{operation}", headers=headers, json=payload
        )
        expected = 404 if task is task_c else 403
        assert response.status_code == expected, response.text
    hidden = await httpx_client.get(f"/api/v1/tasks/{task_c.id}", headers=headers)
    assert hidden.status_code == 404, hidden.text

    for operation, payload, expected in (
        ("lock", None, 200),
        ("annotations", annotation, 201),
        ("submit", None, 200),
    ):
        response = await httpx_client.post(
            f"/api/v1/tasks/{task_a.id}/{operation}", headers=headers, json=payload
        )
        assert response.status_code == expected, response.text
    for operation in ("review/claim", "review/approve"):
        response = await httpx_client.post(
            f"/api/v1/tasks/{task_b.id}/{operation}", headers=headers
        )
        assert response.status_code == 200, response.text

    await db_session.refresh(task_a)
    await db_session.refresh(task_b)
    await db_session.refresh(employee)
    assert task_a.status == "review"
    assert str(employee.id) in task_a.review_contributor_ids
    assert task_b.status == "completed"
    assert employee.role == "employee"
