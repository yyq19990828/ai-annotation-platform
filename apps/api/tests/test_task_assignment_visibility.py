"""Task-level assignment must control the annotator workbench scope."""

from __future__ import annotations

import uuid

import pytest

from app.core.security import create_access_token
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from tests.factory import create_project, create_user


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _task(
    db,
    *,
    project_id: uuid.UUID,
    display_id: str,
    batch_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
) -> Task:
    task = Task(
        project_id=project_id,
        batch_id=batch_id,
        assignee_id=assignee_id,
        display_id=display_id,
        file_name=f"{display_id}.jpg",
        file_path=f"items/{display_id}.jpg",
        file_type="image",
        status="pending",
    )
    db.add(task)
    await db.flush()
    return task


async def _apply_annotator_assignment(
    client,
    *,
    project_id: uuid.UUID,
    owner_token: str,
    task_ids: list[uuid.UUID],
    annotator_id: uuid.UUID,
) -> dict:
    payload = {
        "task_ids": [str(task_id) for task_id in task_ids],
        "annotator_id": str(annotator_id),
    }
    preview = await client.post(
        f"/api/v1/projects/{project_id}/data-manager/tasks/assignment-preview",
        headers=_bearer(owner_token),
        json=payload,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["eligible_count"] == len(task_ids)

    apply_payload = {**payload, "preview_version": preview.json()["preview_version"]}
    applied = await client.post(
        f"/api/v1/projects/{project_id}/data-manager/tasks/assignment-apply",
        headers=_bearer(owner_token),
        json=apply_payload,
    )
    assert applied.status_code == 200, applied.text
    assert set(applied.json()["succeeded"]) == {str(task_id) for task_id in task_ids}
    return applied.json()


async def _apply_reviewer_assignment(
    client,
    *,
    project_id: uuid.UUID,
    owner_token: str,
    task_id: uuid.UUID,
    reviewer_id: uuid.UUID | None,
) -> dict:
    payload = {
        "task_ids": [str(task_id)],
        "reviewer_id": str(reviewer_id) if reviewer_id is not None else None,
    }
    preview = await client.post(
        f"/api/v1/projects/{project_id}/data-manager/tasks/assignment-preview",
        headers=_bearer(owner_token),
        json=payload,
    )
    assert preview.status_code == 200, preview.text
    apply_payload = {**payload, "preview_version": preview.json()["preview_version"]}
    applied = await client.post(
        f"/api/v1/projects/{project_id}/data-manager/tasks/assignment-apply",
        headers=_bearer(owner_token),
        json=apply_payload,
    )
    assert applied.status_code == 200, applied.text
    return applied.json()


@pytest.mark.asyncio
async def test_task_assignment_scopes_batch_query_get_and_next(
    httpx_client_bound, db_session, super_admin, annotator
):
    owner, owner_token = super_admin
    batch_assignee, batch_assignee_token = annotator
    target = await create_user(
        db_session,
        "annotator",
        f"task-scope-target-{uuid.uuid4().hex[:8]}@test.local",
        "Task Scope Target",
    )
    target_token = create_access_token(subject=str(target.id), role=target.role)

    project = await create_project(db_session, owner_id=owner.id)
    db_session.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id=batch_assignee.id,
                role="annotator",
                assigned_by=owner.id,
            ),
            ProjectMember(
                project_id=project.id,
                user_id=target.id,
                role="annotator",
                assigned_by=owner.id,
            ),
        ]
    )
    batch = TaskBatch(
        project_id=project.id,
        display_id=f"B-TASK-SCOPE-{uuid.uuid4().hex[:8]}",
        name="task scope",
        status="active",
        annotator_id=batch_assignee.id,
    )
    db_session.add(batch)
    await db_session.flush()
    selected = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-TASK-SELECTED-{uuid.uuid4().hex[:8]}",
        batch_id=batch.id,
    )
    sibling = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-TASK-SIBLING-{uuid.uuid4().hex[:8]}",
        batch_id=batch.id,
    )
    await db_session.commit()

    assignment = await _apply_annotator_assignment(
        httpx_client_bound,
        project_id=project.id,
        owner_token=owner_token,
        task_ids=[selected.id],
        annotator_id=target.id,
    )
    assignment_item = assignment["items"][0]
    assert assignment_item["effective_before_annotator_id"] == str(batch_assignee.id)
    assert assignment_item["effective_after_annotator_id"] == str(target.id)

    target_list = await httpx_client_bound.get(
        f"/api/v1/tasks?project_id={project.id}&limit=200",
        headers=_bearer(target_token),
    )
    assert target_list.status_code == 200, target_list.text
    assert {item["id"] for item in target_list.json()["items"]} == {str(selected.id)}
    assert target_list.json()["total"] == 1

    target_query = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers=_bearer(target_token),
        json={"filter_json": {}},
    )
    assert target_query.status_code == 200, target_query.text
    assert {item["id"] for item in target_query.json()["items"]} == {str(selected.id)}
    assert target_query.json()["total"] == 1

    assert (
        await httpx_client_bound.get(
            f"/api/v1/tasks/{selected.id}", headers=_bearer(target_token)
        )
    ).status_code == 200
    assert (
        await httpx_client_bound.get(
            f"/api/v1/tasks/{sibling.id}", headers=_bearer(target_token)
        )
    ).status_code == 404

    claimed = await httpx_client_bound.get(
        f"/api/v1/tasks/next?project_id={project.id}&batch_id={batch.id}",
        headers=_bearer(target_token),
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["id"] == str(selected.id)

    # The old batch assignee cannot claim the reassigned task. Marking the
    # untouched sibling labeled makes a None result prove the selected task
    # itself was excluded from the candidate query.
    sibling.is_labeled = True
    await db_session.flush()
    old_assignee_next = await httpx_client_bound.get(
        f"/api/v1/tasks/next?project_id={project.id}&batch_id={batch.id}",
        headers=_bearer(batch_assignee_token),
    )
    assert old_assignee_next.status_code == 200, old_assignee_next.text
    assert old_assignee_next.json() is None
    assert (
        await httpx_client_bound.post(
            f"/api/v1/tasks/{selected.id}/lock",
            headers=_bearer(batch_assignee_token),
        )
    ).status_code == 404


@pytest.mark.asyncio
async def test_explicitly_assigned_unbatched_task_is_visible_and_claimable(
    httpx_client_bound, db_session, super_admin, annotator
):
    owner, owner_token = super_admin
    old_assignee, old_assignee_token = annotator
    target = await create_user(
        db_session,
        "annotator",
        f"unbatched-target-{uuid.uuid4().hex[:8]}@test.local",
        "Unbatched Target",
    )
    target_token = create_access_token(subject=str(target.id), role=target.role)
    project = await create_project(db_session, owner_id=owner.id)
    db_session.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id=old_assignee.id,
                role="annotator",
                assigned_by=owner.id,
            ),
            ProjectMember(
                project_id=project.id,
                user_id=target.id,
                role="annotator",
                assigned_by=owner.id,
            ),
        ]
    )
    task = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-TASK-UNBATCHED-{uuid.uuid4().hex[:8]}",
    )
    await db_session.commit()

    await _apply_annotator_assignment(
        httpx_client_bound,
        project_id=project.id,
        owner_token=owner_token,
        task_ids=[task.id],
        annotator_id=target.id,
    )

    listed = await httpx_client_bound.get(
        f"/api/v1/tasks?project_id={project.id}&unbatched=true&limit=200",
        headers=_bearer(target_token),
    )
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()["items"]] == [str(task.id)]
    query = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers=_bearer(target_token),
        json={"filter_json": {}},
    )
    assert query.status_code == 200, query.text
    assert [item["id"] for item in query.json()["items"]] == [str(task.id)]
    assert (
        await httpx_client_bound.get(
            f"/api/v1/tasks/{task.id}", headers=_bearer(target_token)
        )
    ).status_code == 200

    claimed = await httpx_client_bound.get(
        f"/api/v1/tasks/next?project_id={project.id}",
        headers=_bearer(target_token),
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["id"] == str(task.id)
    old_assignee_next = await httpx_client_bound.get(
        f"/api/v1/tasks/next?project_id={project.id}",
        headers=_bearer(old_assignee_token),
    )
    assert old_assignee_next.status_code == 200, old_assignee_next.text
    assert old_assignee_next.json() is None


@pytest.mark.asyncio
async def test_reviewer_assignment_reserves_review_claim_and_can_be_cleared(
    httpx_client_bound, db_session, super_admin, reviewer
):
    owner, owner_token = super_admin
    first_reviewer, _ = reviewer
    reserved_reviewer = await create_user(
        db_session,
        "reviewer",
        f"reserved-reviewer-{uuid.uuid4().hex[:8]}@test.local",
        "Reserved Reviewer",
    )
    reserved_token = create_access_token(
        subject=str(reserved_reviewer.id), role=reserved_reviewer.role
    )
    first_token = create_access_token(
        subject=str(first_reviewer.id), role=first_reviewer.role
    )
    project = await create_project(db_session, owner_id=owner.id)
    db_session.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id=first_reviewer.id,
                role="reviewer",
                assigned_by=owner.id,
            ),
            ProjectMember(
                project_id=project.id,
                user_id=reserved_reviewer.id,
                role="reviewer",
                assigned_by=owner.id,
            ),
        ]
    )
    batch = TaskBatch(
        project_id=project.id,
        display_id=f"B-REVIEW-SCOPE-{uuid.uuid4().hex[:8]}",
        name="review scope",
        status="reviewing",
        reviewer_id=first_reviewer.id,
    )
    db_session.add(batch)
    await db_session.flush()
    task = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-REVIEW-SCOPE-{uuid.uuid4().hex[:8]}",
        batch_id=batch.id,
    )
    task.status = "review"
    pool_task = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-REVIEW-POOL-{uuid.uuid4().hex[:8]}",
        batch_id=batch.id,
    )
    pool_task.status = "review"
    pending_task = await _task(
        db_session,
        project_id=project.id,
        display_id=f"T-REVIEW-PENDING-{uuid.uuid4().hex[:8]}",
        batch_id=batch.id,
    )
    await db_session.commit()

    reserved = await _apply_reviewer_assignment(
        httpx_client_bound,
        project_id=project.id,
        owner_token=owner_token,
        task_id=task.id,
        reviewer_id=reserved_reviewer.id,
    )
    assert reserved["succeeded"] == [str(task.id)]
    reserved_item = reserved["items"][0]
    assert reserved_item["effective_before_reviewer_id"] == str(first_reviewer.id)
    assert reserved_item["effective_after_reviewer_id"] == str(reserved_reviewer.id)

    other_claim = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/review/claim",
        headers=_bearer(first_token),
    )
    assert other_claim.status_code == 409, other_claim.text
    assert other_claim.json()["detail"]["reason"] == "task_review_assigned_to_other"
    own_claim = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/review/claim",
        headers=_bearer(reserved_token),
    )
    assert own_claim.status_code == 200, own_claim.text
    assert own_claim.json()["reviewer_id"] == str(reserved_reviewer.id)

    cleared = await _apply_reviewer_assignment(
        httpx_client_bound,
        project_id=project.id,
        owner_token=owner_token,
        task_id=task.id,
        reviewer_id=None,
    )
    assert cleared["succeeded"] == [str(task.id)]
    assert cleared["items"][0]["effective_after_reviewer_id"] == str(first_reviewer.id)
    reopened_claim = await httpx_client_bound.post(
        f"/api/v1/tasks/{task.id}/review/claim",
        headers=_bearer(first_token),
    )
    assert reopened_claim.status_code == 200, reopened_claim.text
    assert reopened_claim.json()["reviewer_id"] == str(first_reviewer.id)

    pool_claim = await httpx_client_bound.post(
        f"/api/v1/tasks/{pool_task.id}/review/claim",
        headers=_bearer(first_token),
    )
    assert pool_claim.status_code == 200, pool_claim.text
    pending_preview = await httpx_client_bound.post(
        f"/api/v1/projects/{project.id}/data-manager/tasks/assignment-preview",
        headers=_bearer(owner_token),
        json={
            "task_ids": [str(pending_task.id)],
            "reviewer_id": str(reserved_reviewer.id),
        },
    )
    assert pending_preview.status_code == 200, pending_preview.text
    assert pending_preview.json()["eligible_count"] == 0
    assert (
        pending_preview.json()["items"][0]["reason"]
        == "reviewer_assignment_requires_review"
    )
