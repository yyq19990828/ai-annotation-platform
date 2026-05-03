"""v0.6.9 · 通知中心 + BUG 反馈接入。"""
from __future__ import annotations

import uuid

import pytest

from app.db.models.bug_report import BugReport
from app.db.models.notification import Notification
from app.services.bug_report import BugReportService
from app.services.display_id import next_display_id
from app.services.notification import NotificationService
from sqlalchemy import select


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_bug(db, reporter_id: uuid.UUID, status: str = "new", assigned_to: uuid.UUID | None = None) -> BugReport:
    display_id = await next_display_id(db, "bug_reports")
    report = BugReport(
        id=uuid.uuid4(),
        display_id=display_id,
        reporter_id=reporter_id,
        route="/foo",
        user_role="annotator",
        title="t",
        description="d",
        severity="medium",
        status=status,
        assigned_to_id=assigned_to,
    )
    db.add(report)
    await db.flush()
    return report


@pytest.mark.asyncio
async def test_notify_writes_row_and_unread_count(db_session, annotator):
    user, _ = annotator
    svc = NotificationService(db_session)
    await svc.notify(
        user_id=user.id,
        type="bug_report.commented",
        target_type="bug_report",
        target_id=uuid.uuid4(),
        payload={"display_id": "B-1"},
    )
    assert await svc.unread_count(user.id) == 1

    items, total, unread = await svc.list_for_user(user.id)
    assert total == 1 and unread == 1
    assert items[0].read_at is None


@pytest.mark.asyncio
async def test_mark_read_and_mark_all(db_session, annotator):
    user, _ = annotator
    svc = NotificationService(db_session)
    n1 = await svc.notify(
        user_id=user.id, type="t", target_type="bug_report", target_id=uuid.uuid4()
    )
    n2 = await svc.notify(
        user_id=user.id, type="t", target_type="bug_report", target_id=uuid.uuid4()
    )

    assert await svc.mark_read(user.id, n1.id) is True
    assert await svc.unread_count(user.id) == 1

    # 已读再标 → False（rowcount=0）
    assert await svc.mark_read(user.id, n1.id) is False

    # 标记全部
    n = await svc.mark_all_read(user.id)
    assert n == 1  # 只剩 n2 未读
    assert await svc.unread_count(user.id) == 0


@pytest.mark.asyncio
async def test_admin_status_change_notifies_reporter(httpx_client_bound, db_session, annotator, super_admin):
    reporter, _ = annotator
    admin, admin_token = super_admin
    report = await _seed_bug(db_session, reporter.id, status="new")
    await db_session.commit()

    resp = await httpx_client_bound.patch(
        f"/api/v1/bug_reports/{report.id}",
        json={"status": "fixed", "resolution": "ok"},
        headers=_bearer(admin_token),
    )
    assert resp.status_code == 200

    rows = (await db_session.execute(
        select(Notification).where(Notification.user_id == reporter.id)
    )).scalars().all()
    assert len(rows) == 1
    n = rows[0]
    assert n.type == "bug_report.status_changed"
    assert n.payload["from_status"] == "new"
    assert n.payload["to_status"] == "fixed"
    assert n.payload["display_id"] == report.display_id


@pytest.mark.asyncio
async def test_reporter_reopen_notifies_assignee(httpx_client_bound, db_session, annotator, super_admin):
    reporter, reporter_token = annotator
    admin, _ = super_admin
    report = await _seed_bug(db_session, reporter.id, status="fixed", assigned_to=admin.id)
    await db_session.commit()

    resp = await httpx_client_bound.post(
        f"/api/v1/bug_reports/{report.id}/comments",
        json={"body": "依然有问题"},
        headers=_bearer(reporter_token),
    )
    assert resp.status_code == 201

    rows = (await db_session.execute(
        select(Notification).where(Notification.user_id == admin.id)
    )).scalars().all()
    assert len(rows) == 1
    n = rows[0]
    assert n.type == "bug_report.reopened"
    assert n.payload.get("reopen") is True
    assert n.payload.get("reopen_count") == 1
    assert n.payload.get("snippet") == "依然有问题"


@pytest.mark.asyncio
async def test_admin_comment_notifies_reporter(httpx_client_bound, db_session, annotator, super_admin):
    reporter, _ = annotator
    admin, admin_token = super_admin
    report = await _seed_bug(db_session, reporter.id, status="triaged", assigned_to=admin.id)
    await db_session.commit()

    resp = await httpx_client_bound.post(
        f"/api/v1/bug_reports/{report.id}/comments",
        json={"body": "在跟进"},
        headers=_bearer(admin_token),
    )
    assert resp.status_code == 201

    rows = (await db_session.execute(
        select(Notification).where(Notification.user_id == reporter.id)
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].type == "bug_report.commented"
    assert rows[0].payload["actor_role"] == "super_admin"


@pytest.mark.asyncio
async def test_notifications_endpoints_only_return_own(httpx_client_bound, db_session, annotator, reviewer):
    user_a, token_a = annotator
    user_b, _ = reviewer
    svc = NotificationService(db_session)
    await svc.notify(user_id=user_a.id, type="t", target_type="bug_report", target_id=uuid.uuid4())
    await svc.notify(user_id=user_b.id, type="t", target_type="bug_report", target_id=uuid.uuid4())
    await db_session.commit()

    resp = await httpx_client_bound.get("/api/v1/notifications", headers=_bearer(token_a))
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["unread"] == 1

    cnt = await httpx_client_bound.get("/api/v1/notifications/unread-count", headers=_bearer(token_a))
    assert cnt.status_code == 200
    assert cnt.json() == {"unread": 1}


@pytest.mark.asyncio
async def test_self_action_does_not_notify_self(httpx_client_bound, db_session, super_admin):
    """super_admin 自己改自己的状态不应通知自己（reporter == admin 同一人）。"""
    admin, admin_token = super_admin
    report = await _seed_bug(db_session, admin.id, status="new")
    await db_session.commit()

    resp = await httpx_client_bound.patch(
        f"/api/v1/bug_reports/{report.id}",
        json={"status": "triaged"},
        headers=_bearer(admin_token),
    )
    assert resp.status_code == 200

    rows = (await db_session.execute(
        select(Notification).where(Notification.user_id == admin.id)
    )).scalars().all()
    assert len(rows) == 0
