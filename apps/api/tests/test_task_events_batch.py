"""v0.8.4 · POST /auth/me/task-events:batch + admin/people endpoints 烟测。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest


@pytest.mark.asyncio
async def test_task_events_batch_sync_fallback(httpx_client, annotator, db_session):
    """task_events_async = False 时走 sync fallback；行应直接落库。"""
    from app.config import settings
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.db.models.task_event import TaskEvent
    from sqlalchemy import select, func

    user, token = annotator
    project = Project(
        id=uuid.uuid4(),
        display_id="P-TE",
        name="te-proj",
        type_label="图像检测",
        type_key="image-det",
        owner_id=user.id,
    )
    db_session.add(project)
    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id="T-TE",
        file_name="x.jpg",
        file_path="/x",
    )
    db_session.add(task)
    await db_session.flush()

    settings.task_events_async = False
    try:
        now = datetime.now(timezone.utc)
        payload = {
            "events": [
                {
                    "task_id": str(task.id),
                    "project_id": str(project.id),
                    "kind": "annotate",
                    "started_at": (now - timedelta(seconds=30)).isoformat(),
                    "ended_at": now.isoformat(),
                    "duration_ms": 30000,
                    "annotation_count": 2,
                    "was_rejected": False,
                }
            ]
        }
        r = await httpx_client.post(
            "/api/v1/auth/me/task-events:batch",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accepted"] == 1
        assert body["queued_async"] is False
    finally:
        settings.task_events_async = True

    # 行落库（同 SAVEPOINT 可见）
    n = (
        await db_session.execute(
            select(func.count())
            .select_from(TaskEvent)
            .where(TaskEvent.user_id == user.id)
        )
    ).scalar()
    assert n == 1


@pytest.mark.asyncio
async def test_task_events_batch_validation(httpx_client, annotator):
    """ended_at < started_at → 422。"""
    user, token = annotator
    now = datetime.now(timezone.utc)
    payload = {
        "events": [
            {
                "task_id": str(uuid.uuid4()),
                "project_id": str(uuid.uuid4()),
                "kind": "annotate",
                "started_at": now.isoformat(),
                "ended_at": (now - timedelta(seconds=10)).isoformat(),
                "duration_ms": 1000,
            }
        ]
    }
    r = await httpx_client.post(
        "/api/v1/auth/me/task-events:batch",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_people_list_super_admin_only(httpx_client, annotator):
    """非 super_admin 访问 /admin/people → 403。"""
    _, token = annotator
    r = await httpx_client.get(
        "/api/v1/dashboard/admin/people",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_people_list_returns_users(httpx_client, super_admin, annotator):
    """super_admin 调用 /admin/people 至少能看到自己 + annotator fixture。"""
    _, super_token = super_admin
    r = await httpx_client.get(
        "/api/v1/dashboard/admin/people?period=7d",
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body
    emails = [it["email"] for it in body["items"]]
    assert "admin@test.local" in emails
    assert "anno@test.local" in emails
    # 每张卡片需要的字段
    for it in body["items"]:
        for k in [
            "user_id",
            "name",
            "role",
            "main_metric",
            "throughput_score",
            "quality_score",
            "activity_score",
            "sparkline_7d",
            "alerts",
        ]:
            assert k in it, f"missing {k}"
        assert len(it["sparkline_7d"]) == 7


@pytest.mark.asyncio
async def test_annotator_dashboard_active_minutes_streak_from_task_events(
    httpx_client, annotator, db_session
):
    """v0.8.4.1 hotfix · 接通 task_events 后，active_minutes_today / streak_days
    应基于真实事件（不再是 None 占位）。"""
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.db.models.task_event import TaskEvent

    user, token = annotator
    project = Project(
        id=uuid.uuid4(),
        display_id="P-AM",
        name="am-proj",
        type_label="图像检测",
        type_key="image-det",
        owner_id=user.id,
    )
    db_session.add(project)
    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id="T-AM",
        file_name="x.jpg",
        file_path="/x",
    )
    db_session.add(task)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # 当日两条事件 → active_minutes_today = (60_000 + 120_000) / 60_000 = 3
    db_session.add_all(
        [
            TaskEvent(
                id=uuid.uuid4(),
                task_id=task.id,
                user_id=user.id,
                project_id=project.id,
                kind="annotate",
                started_at=today_start + timedelta(hours=1),
                ended_at=today_start + timedelta(hours=1, minutes=1),
                duration_ms=60_000,
                annotation_count=1,
                was_rejected=False,
            ),
            TaskEvent(
                id=uuid.uuid4(),
                task_id=task.id,
                user_id=user.id,
                project_id=project.id,
                kind="annotate",
                started_at=today_start + timedelta(hours=2),
                ended_at=today_start + timedelta(hours=2, minutes=2),
                duration_ms=120_000,
                annotation_count=2,
                was_rejected=False,
            ),
            # 昨天也有事件 → streak_days = 2
            TaskEvent(
                id=uuid.uuid4(),
                task_id=task.id,
                user_id=user.id,
                project_id=project.id,
                kind="annotate",
                started_at=today_start - timedelta(hours=10),
                ended_at=today_start - timedelta(hours=10) + timedelta(minutes=1),
                duration_ms=60_000,
                annotation_count=1,
                was_rejected=False,
            ),
            # 前天没事件 → streak 在第 3 天断开（总 streak = 2）
        ]
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/dashboard/annotator",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["active_minutes_today"] == 3
    assert body["streak_days"] == 2


@pytest.mark.asyncio
async def test_admin_people_activity_score_from_task_events(
    httpx_client, super_admin, annotator, db_session
):
    """v0.8.4.1 hotfix · activity_score 接通 task_events 后，活跃用户应高于不活跃用户。"""
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.db.models.task_event import TaskEvent

    super_user, super_token = super_admin
    anno_user, _ = annotator
    project = Project(
        id=uuid.uuid4(),
        display_id="P-AS",
        name="as-proj",
        type_label="图像检测",
        type_key="image-det",
        owner_id=super_user.id,
    )
    db_session.add(project)
    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id="T-AS",
        file_name="x.jpg",
        file_path="/x",
    )
    db_session.add(task)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    # annotator 7d 内 30 分钟活跃，super_admin 0 → annotator 分位 > super_admin
    db_session.add(
        TaskEvent(
            id=uuid.uuid4(),
            task_id=task.id,
            user_id=anno_user.id,
            project_id=project.id,
            kind="annotate",
            started_at=now - timedelta(hours=2),
            ended_at=now - timedelta(hours=2) + timedelta(minutes=30),
            duration_ms=30 * 60_000,
            annotation_count=5,
            was_rejected=False,
        )
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/dashboard/admin/people?period=7d",
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    by_email = {it["email"]: it for it in body["items"]}
    # 活跃用户 activity_score 严格 > 非活跃用户
    assert by_email["anno@test.local"]["activity_score"] > by_email[
        "admin@test.local"
    ]["activity_score"]


@pytest.mark.asyncio
async def test_admin_people_detail_404(httpx_client, super_admin):
    _, super_token = super_admin
    r = await httpx_client.get(
        f"/api/v1/dashboard/admin/people/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_admin_people_detail_ok(httpx_client, super_admin, annotator):
    _, super_token = super_admin
    user, _ = annotator
    r = await httpx_client.get(
        f"/api/v1/dashboard/admin/people/{user.id}?period=4w",
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == str(user.id)
    assert "trend_throughput" in body
    assert len(body["trend_throughput"]) == 4
    assert "duration_histogram" in body
