"""Frozen review-evidence guard on batch decisions (B2-owned regression).

Covers the single-batch ``transition`` and ``reject`` paths, the bulk
approve/reject summary shape, and a concurrent/stale batch row.  A successful
decision requires complete frozen non-self contributor evidence; unknown legacy
evidence (409) and self review (403) block the decision before any mutation.

Requires the isolated PostgreSQL test database.
"""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.security import create_access_token
from app.db.models.project_member import ProjectMember
from app.db.models.task_batch import TaskBatch
from app.db.models.user import User
from tests.factory import create_batch, create_project, create_task, create_user

pytestmark = pytest.mark.asyncio


def _headers(user: User) -> dict[str, str]:
    token = create_access_token(subject=str(user.id), role=user.role)
    return {"Authorization": f"Bearer {token}"}


async def _seed(
    db,
    owner: User,
    *,
    evidence: str,
    batch_status: str = "reviewing",
    batch_name: str = "evidence batch",
):
    """One reviewer membership, one batch and one review task.

    ``evidence="frozen"`` freezes a non-self round attributed to ``owner``;
    ``"unknown"`` leaves the legacy task without evidence; ``"self"`` freezes a
    round whose contributor is the acting reviewer.
    """
    reviewer = await create_user(
        db, "employee", f"batch-rev-{uuid.uuid4()}@test.local", "Reviewer"
    )
    project = await create_project(db, owner_id=owner.id, name="Batch evidence")
    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=reviewer.id,
            role="reviewer",
            assigned_by=owner.id,
        )
    )
    batch = await create_batch(db, project_id=project.id, status=batch_status)
    batch.name = batch_name
    task = await create_task(db, project_id=project.id, status="review")
    task.batch_id = batch.id
    task.reviewer_id = reviewer.id
    if evidence == "frozen":
        task.review_round_id = uuid.uuid4()
        task.annotation_contributor_ids = []
        task.review_contributor_ids = [str(owner.id)]
        task.review_submitter_id = owner.id
    elif evidence == "self":
        task.review_round_id = uuid.uuid4()
        task.annotation_contributor_ids = []
        task.review_contributor_ids = [str(reviewer.id)]
        task.review_submitter_id = reviewer.id
    await db.flush()
    return reviewer, project, batch, task


async def test_transition_to_approved_blocks_unknown_evidence(
    httpx_client: httpx.AsyncClient, super_admin, db_session
):
    owner, _ = super_admin
    reviewer, project, batch, _task = await _seed(db_session, owner, evidence="unknown")
    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/batches/{batch.id}/transition",
        headers=_headers(reviewer),
        json={"target_status": "approved"},
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["reason"] == "review_contributors_unknown"
    await db_session.refresh(batch)
    assert batch.status == "reviewing"


async def test_transition_to_rejected_blocks_self_review(
    httpx_client: httpx.AsyncClient, super_admin, db_session
):
    owner, _ = super_admin
    reviewer, project, batch, _task = await _seed(db_session, owner, evidence="self")
    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/batches/{batch.id}/transition",
        headers=_headers(reviewer),
        json={"target_status": "rejected"},
    )
    assert response.status_code == 403, response.text
    assert response.json()["detail"]["reason"] == "self_review_denied"
    await db_session.refresh(batch)
    assert batch.status == "reviewing"


async def test_bulk_approve_preserves_per_batch_summary(
    httpx_client: httpx.AsyncClient, super_admin, db_session
):
    owner, _ = super_admin
    reviewer, project, good_batch, _good = await _seed(
        db_session, owner, evidence="frozen", batch_name="good"
    )
    # A second batch in the SAME project with unknown evidence.
    bad_batch = await create_batch(
        db_session, project_id=project.id, status="reviewing"
    )
    bad_batch.name = "bad"
    bad_task = await create_task(db_session, project_id=project.id, status="review")
    bad_task.batch_id = bad_batch.id
    bad_task.reviewer_id = reviewer.id
    await db_session.flush()
    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/batches/bulk-approve",
        headers=_headers(reviewer),
        json={"batch_ids": [str(good_batch.id), str(bad_batch.id)]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [str(value) for value in body["succeeded"]] == [str(good_batch.id)]
    assert body["failed"] == [
        {"batch_id": str(bad_batch.id), "reason": "review_contributors_unknown"}
    ]
    await db_session.refresh(good_batch)
    await db_session.refresh(bad_batch)
    assert good_batch.status == "approved"
    assert bad_batch.status == "reviewing"


async def test_batch_decision_busy_returns_conflict(
    test_engine, app_module, super_admin, db_session
):
    owner, _ = super_admin
    reviewer, project, batch, _task = await _seed(db_session, owner, evidence="frozen")
    await db_session.commit()

    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    async with maker() as writer:
        await writer.execute(
            select(TaskBatch).where(TaskBatch.id == batch.id).with_for_update()
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app_module), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/api/v1/projects/{project.id}/batches/{batch.id}/transition",
                headers=_headers(reviewer),
                json={"target_status": "approved"},
            )
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["reason"] == "batch_decision_busy"
        await writer.rollback()
