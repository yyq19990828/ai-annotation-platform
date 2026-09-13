from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.db.models.annotation import Annotation
from app.db.models.audit_log import AuditLog
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_event import TaskEvent


def _project(owner_id: uuid.UUID) -> Project:
    suffix = uuid.uuid4().hex[:8]
    return Project(
        id=uuid.uuid4(),
        display_id=f"P-PP-{suffix}",
        name="Performance project",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
    )


def _task(
    project_id: uuid.UUID, *, status: str, assignee_id=None, reviewer_id=None
) -> Task:
    suffix = uuid.uuid4().hex[:8]
    return Task(
        id=uuid.uuid4(),
        project_id=project_id,
        display_id=f"T-PP-{suffix}",
        file_name="image.jpg",
        file_path="image.jpg",
        status=status,
        assignee_id=assignee_id,
        reviewer_id=reviewer_id,
        tags=[],
    )


def _audit(
    *,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    at: datetime,
    round_id: uuid.UUID | None = None,
    contributors: list[uuid.UUID] | None = None,
    **detail,
) -> AuditLog:
    payload = {"project_id": str(project_id), **detail}
    if round_id is not None:
        payload["review_round_id"] = str(round_id)
    if contributors is not None:
        payload["contributor_ids"] = [str(value) for value in contributors]
    return AuditLog(
        actor_id=actor_id,
        action=action,
        target_type="task",
        target_id=str(task_id),
        status_code=200,
        detail_json=payload,
        created_at=at,
    )


async def _member(db, project_id, user, role, owner_id):
    db.add(
        ProjectMember(
            project_id=project_id,
            user_id=user.id,
            role=role,
            assigned_by=owner_id,
        )
    )


@pytest.mark.asyncio
async def test_members_http_roster_metrics_empty_search_and_safe_csv(
    httpx_client, db_session, project_admin, annotator, reviewer
):
    from tests.conftest import _create_user

    owner, token = project_admin
    annotator_user, _ = annotator
    reviewer_user, _ = reviewer
    reviewer_user.is_active = False
    removed_user, _ = await _create_user(
        db_session,
        "annotator",
        f"removed-{uuid.uuid4().hex[:8]}@test.local",
        "=Removed",
    )
    annotator_user.name = "=Annotator"
    project = _project(owner.id)
    db_session.add(project)
    await db_session.flush()
    await _member(db_session, project.id, annotator_user, "annotator", owner.id)
    await _member(db_session, project.id, reviewer_user, "reviewer", owner.id)

    start = datetime(2026, 9, 10, tzinfo=timezone.utc)
    task = _task(project.id, status="completed", assignee_id=annotator_user.id)
    task_round = uuid.uuid4()
    task.first_review_eligible = True
    task.first_reviewed_at = start - timedelta(days=1)
    task.first_review_result = "rejected"
    task.first_review_contributor_ids = [str(annotator_user.id)]
    task.review_round_id = task_round
    db_session.add(task)
    review_task = _task(project.id, status="review", reviewer_id=reviewer_user.id)
    db_session.add(review_task)
    fresh_task = _task(project.id, status="rejected", assignee_id=annotator_user.id)
    fresh_round = uuid.uuid4()
    fresh_task.first_review_eligible = True
    fresh_task.first_reviewed_at = start + timedelta(hours=2)
    fresh_task.first_review_result = "rejected"
    fresh_task.first_review_contributor_ids = [str(annotator_user.id)]
    fresh_task.review_round_id = fresh_round
    db_session.add(fresh_task)
    legacy_task = _task(project.id, status="completed", assignee_id=annotator_user.id)
    legacy_round = uuid.uuid4()
    legacy_task.first_review_eligible = None
    legacy_task.review_round_id = legacy_round
    db_session.add(legacy_task)
    removed_task = _task(project.id, status="completed", assignee_id=removed_user.id)
    db_session.add(removed_task)
    await db_session.flush()

    db_session.add_all(
        [
            Annotation(
                task_id=task.id,
                project_id=project.id,
                user_id=annotator_user.id,
                class_name="car",
                annotation_type="bbox",
                track_id="trk-1",
                geometry={"type": "bbox"},
                source="manual",
                attributes={},
                created_at=start + timedelta(hours=1),
            ),
            Annotation(
                task_id=task.id,
                project_id=project.id,
                user_id=annotator_user.id,
                class_name="person",
                annotation_type="bbox",
                track_id="trk-1",
                geometry={"type": "bbox"},
                source="manual",
                attributes={"_imported": True},
                created_at=start + timedelta(hours=1),
            ),
            Annotation(
                task_id=removed_task.id,
                project_id=project.id,
                user_id=removed_user.id,
                class_name="bus",
                annotation_type="polygon",
                geometry={"type": "polygon"},
                source="manual",
                attributes={},
                created_at=start + timedelta(hours=1),
            ),
        ]
    )
    first_round = uuid.uuid4()
    db_session.add_all(
        [
            _audit(
                project_id=project.id,
                task_id=task.id,
                actor_id=annotator_user.id,
                action="task.submit",
                at=start - timedelta(days=1),
                round_id=first_round,
                contributors=[annotator_user.id],
            ),
            _audit(
                project_id=project.id,
                task_id=task.id,
                actor_id=annotator_user.id,
                action="task.submit",
                at=start + timedelta(hours=1),
                round_id=task_round,
                contributors=[annotator_user.id],
            ),
            _audit(
                project_id=project.id,
                task_id=task.id,
                actor_id=reviewer_user.id,
                action="task.approve",
                at=start + timedelta(hours=2),
                round_id=task_round,
                contributors=[annotator_user.id],
                result="approved",
            ),
            _audit(
                project_id=project.id,
                task_id=task.id,
                actor_id=reviewer_user.id,
                action="task.approve",
                at=start + timedelta(hours=3),
                round_id=task_round,
                contributors=[annotator_user.id],
                result="approved",
            ),
            _audit(
                project_id=project.id,
                task_id=fresh_task.id,
                actor_id=annotator_user.id,
                action="task.submit",
                at=start + timedelta(hours=1),
                round_id=fresh_round,
                contributors=[annotator_user.id],
            ),
            _audit(
                project_id=project.id,
                task_id=fresh_task.id,
                actor_id=reviewer_user.id,
                action="task.reject",
                at=start + timedelta(hours=2),
                round_id=fresh_round,
                contributors=[annotator_user.id],
                reason_type="missing",
                result="rejected",
            ),
            _audit(
                project_id=project.id,
                task_id=legacy_task.id,
                actor_id=annotator_user.id,
                action="task.submit",
                at=start + timedelta(hours=1),
                round_id=legacy_round,
                contributors=[annotator_user.id],
            ),
            _audit(
                project_id=project.id,
                task_id=legacy_task.id,
                actor_id=reviewer_user.id,
                action="task.approve",
                at=start + timedelta(hours=2),
                round_id=legacy_round,
                contributors=[annotator_user.id],
                result="approved",
            ),
            _audit(
                project_id=project.id,
                task_id=removed_task.id,
                actor_id=removed_user.id,
                action="task.submit",
                at=start + timedelta(hours=1),
                round_id=uuid.uuid4(),
                contributors=[removed_user.id],
            ),
        ]
    )
    await db_session.flush()

    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "from": start.isoformat(),
        "to": (start + timedelta(days=1)).isoformat(),
        "timezone": "UTC",
        "work_type": "annotation",
        "account_status": "all",
        "include_historical": "false",
        "limit": "100",
    }
    response = await httpx_client.get(
        f"/api/v1/projects/{project.id}/performance/members",
        params=params,
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    items = {item["user_id"]: item for item in body["items"]}
    assert str(owner.id) in items
    assert str(annotator_user.id) in items
    assert items[str(annotator_user.id)]["account_status"] == "active"
    metrics = items[str(annotator_user.id)]["metrics"]
    assert metrics["submitted_tasks"]["value"] == 3
    assert metrics["resubmissions"]["value"] == 1
    assert metrics["approved_task_outcomes"]["value"] == 2
    assert metrics["first_review_pass_rate"]["value"] == 0.0
    assert metrics["first_review_pass_rate"]["denominator"] == 1
    assert metrics["first_review_pass_rate"]["coverage"] == "complete"
    assert metrics["retained_objects"]["value"] == 1
    assert metrics["contributed_tasks"]["value"] == 1
    assert items[str(reviewer_user.id)]["account_status"] == "inactive"
    assert items[str(owner.id)]["metrics"]["submitted_tasks"]["value"] == 0
    assert str(removed_user.id) not in items
    assert body["coverage"]["state"] == "partial"
    assert body["project_totals"]["first_review_pass_rate"] == {
        "value": 0.0,
        "unit": "percent",
        "numerator": 0,
        "denominator": 1,
        "coverage": "partial",
    }

    detail = await httpx_client.get(
        f"/api/v1/projects/{project.id}/performance/members/{annotator_user.id}",
        params=params,
        headers=headers,
    )
    assert detail.status_code == 200, detail.text
    source_counts = {
        row["source"]: row["count"] for row in detail.json()["source_distribution"]
    }
    assert source_counts == {"manual": 1, "imported": 1}
    geometry_counts = {
        row["annotation_type"]: row["count"]
        for row in detail.json()["geometry_distribution"]
    }
    assert geometry_counts == {"bbox": 2}

    historical = await httpx_client.get(
        f"/api/v1/projects/{project.id}/performance/members",
        params={**params, "include_historical": "true"},
        headers=headers,
    )
    assert historical.status_code == 200, historical.text
    historical_items = {item["user_id"] for item in historical.json()["items"]}
    assert str(removed_user.id) in historical_items

    empty = await httpx_client.get(
        f"/api/v1/projects/{project.id}/performance/members",
        params={**params, "q": "no-such-member"},
        headers=headers,
    )
    assert empty.status_code == 200, empty.text
    assert empty.json()["items"] == []

    csv_response = await httpx_client.get(
        f"/api/v1/projects/{project.id}/performance/export",
        params=params,
        headers=headers,
    )
    assert csv_response.status_code == 200, csv_response.text
    csv_text = csv_response.content.decode("utf-8")
    assert csv_text.startswith("\ufeff# Scope from:")
    assert f"# Scope to: {(start + timedelta(days=1)).isoformat()}" in csv_text
    assert "submitted_tasks.value" in csv_text
    assert "'=Annotator" in csv_text


@pytest.mark.asyncio
async def test_members_http_is_owner_or_super_admin_only(
    httpx_client, db_session, project_admin, annotator
):
    owner, _ = project_admin
    foreign, foreign_token = annotator
    project = _project(owner.id)
    db_session.add(project)
    await db_session.flush()
    response = await httpx_client.get(
        f"/api/v1/projects/{project.id}/performance/members",
        params={
            "work_type": "annotation",
            "account_status": "all",
            "include_historical": "false",
        },
        headers={"Authorization": f"Bearer {foreign_token}"},
    )
    assert response.status_code == 403, response.text
    assert foreign.id != owner.id


@pytest.mark.asyncio
async def test_members_http_qualified_time_clips_and_unions_sessions(
    httpx_client, db_session, project_admin, annotator
):
    owner, token = project_admin
    worker, _ = annotator
    project = _project(owner.id)
    db_session.add(project)
    await db_session.flush()
    await _member(db_session, project.id, worker, "annotator", owner.id)
    task = _task(project.id, status="in_progress", assignee_id=worker.id)
    db_session.add(task)
    await db_session.flush()
    start = datetime(2026, 9, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    db_session.add_all(
        [
            TaskEvent(
                task_id=task.id,
                user_id=worker.id,
                project_id=project.id,
                kind="annotate",
                started_at=start - timedelta(minutes=10),
                ended_at=start + timedelta(minutes=20),
                duration_ms=1_800_000,
                collection_source="session",
                collection_coverage="qualified",
            ),
            TaskEvent(
                task_id=task.id,
                user_id=worker.id,
                project_id=project.id,
                kind="annotate",
                started_at=start + timedelta(minutes=10),
                ended_at=start + timedelta(minutes=30),
                duration_ms=1_200_000,
                collection_source="session",
                collection_coverage="qualified",
            ),
            TaskEvent(
                task_id=task.id,
                user_id=worker.id,
                project_id=project.id,
                kind="annotate",
                started_at=start + timedelta(minutes=40),
                ended_at=start + timedelta(minutes=50),
                duration_ms=600_000,
                collection_source="legacy",
                collection_coverage="unverified_collection",
            ),
            TaskEvent(
                task_id=task.id,
                user_id=worker.id,
                project_id=project.id,
                kind="review",
                started_at=start + timedelta(minutes=15),
                ended_at=start + timedelta(minutes=25),
                duration_ms=600_000,
                collection_source="session",
                collection_coverage="qualified",
            ),
            TaskEvent(
                task_id=task.id,
                user_id=owner.id,
                project_id=project.id,
                kind="review",
                started_at=start + timedelta(minutes=5),
                ended_at=start + timedelta(minutes=15),
                duration_ms=600_000,
                collection_source="legacy",
                collection_coverage="unverified_collection",
            ),
        ]
    )
    await db_session.flush()
    response = await httpx_client.get(
        f"/api/v1/projects/{project.id}/performance/members",
        params={
            "from": start.isoformat(),
            "to": end.isoformat(),
            "timezone": "UTC",
            "work_type": "annotation",
            "account_status": "all",
            "include_historical": "false",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    item = next(
        item for item in response.json()["items"] if item["user_id"] == str(worker.id)
    )
    assert item["metrics"]["recorded_time_minutes"] == {
        "value": 30.0,
        "unit": "minutes",
        "numerator": None,
        "denominator": None,
        "coverage": "partial",
    }
    assert item["metrics"]["recorded_review_minutes"]["value"] == 10.0
    assert item["metrics"]["recorded_review_minutes"]["coverage"] == "complete"
    owner_item = next(
        item for item in response.json()["items"] if item["user_id"] == str(owner.id)
    )
    assert owner_item["metrics"]["recorded_review_minutes"]["value"] is None
    assert owner_item["metrics"]["recorded_review_minutes"]["coverage"] == "unknown"
    assert response.json()["project_totals"]["recorded_time_minutes"]["value"] == 30.0


@pytest.mark.asyncio
async def test_members_http_volume_uses_bounded_grouped_queries(
    httpx_client, db_session, test_engine, project_admin, annotator
):
    owner, token = project_admin
    worker, _ = annotator
    project = _project(owner.id)
    db_session.add(project)
    await db_session.flush()
    await _member(db_session, project.id, worker, "annotator", owner.id)
    db_session.add_all(
        [
            _task(project.id, status="pending", assignee_id=worker.id)
            for _ in range(2_000)
        ]
    )
    await db_session.flush()

    statements: list[str] = []

    def before_cursor_execute(
        conn, cursor, statement, parameters, context, executemany
    ):
        statements.append(statement)

    event.listen(
        test_engine.sync_engine, "before_cursor_execute", before_cursor_execute
    )
    started = time.perf_counter()
    try:
        response = await httpx_client.get(
            f"/api/v1/projects/{project.id}/performance/members",
            params={
                "from": "2026-09-10T00:00:00Z",
                "to": "2026-09-11T00:00:00Z",
                "timezone": "UTC",
                "work_type": "annotation",
                "account_status": "all",
                "include_historical": "false",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        event.remove(
            test_engine.sync_engine, "before_cursor_execute", before_cursor_execute
        )
    elapsed = time.perf_counter() - started
    print(
        f"project performance volume: {len(statements)} SQL statements, "
        f"{elapsed:.3f}s for 2,000 tasks"
    )
    assert response.status_code == 200, response.text
    assert response.json()["project_totals"]["current_backlog"]["value"] == 2_000
    assert elapsed < 5.0
    task_selects = [
        statement.lower()
        for statement in statements
        if " from tasks" in statement.lower()
    ]
    assert len(task_selects) <= 3
    assert not any(
        "select tasks.id, tasks.status" in statement for statement in task_selects
    )
