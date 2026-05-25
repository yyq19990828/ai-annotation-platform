"""I18 · AnnotationFeedback 统一表 service + schema 测试."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.annotation_feedback import AnnotationFeedbackCreate
from app.services.feedback import FeedbackService
from tests.factory import create_project, create_task


def test_pixel_anchor_requires_position():
    with pytest.raises(ValidationError):
        AnnotationFeedbackCreate(
            kind="issue",
            anchor_type="pixel",
            project_id="00000000-0000-0000-0000-000000000001",
            task_id="00000000-0000-0000-0000-000000000002",
            body="missing position",
        )


def test_project_anchor_rejects_task_id():
    with pytest.raises(ValidationError):
        AnnotationFeedbackCreate(
            kind="comment",
            anchor_type="project",
            project_id="00000000-0000-0000-0000-000000000001",
            task_id="00000000-0000-0000-0000-000000000002",
            body="should fail",
        )


def test_annotation_anchor_requires_both_ids():
    with pytest.raises(ValidationError):
        AnnotationFeedbackCreate(
            kind="comment",
            anchor_type="annotation",
            project_id="00000000-0000-0000-0000-000000000001",
            task_id="00000000-0000-0000-0000-000000000002",
            body="missing annotation_id",
        )


@pytest.mark.asyncio
async def test_feedback_create_and_list(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = FeedbackService(db_session)
    issue = await svc.create(
        author_id=user.id,
        kind="issue",
        anchor_type="pixel",
        project_id=proj.id,
        task_id=task.id,
        annotation_id=None,
        anchor_position={"x": 0.5, "y": 0.3},
        severity="warn",
        title="漏标了一片区域",
        body="左上角缺一个人",
        attachments=[],
        thread_parent_id=None,
    )
    await db_session.flush()

    rows, cursor = await svc.list_paged(project_id=proj.id, limit=10)
    assert len(rows) == 1
    assert rows[0].id == issue.id
    assert rows[0].anchor_position["x"] == 0.5
    assert cursor is None


@pytest.mark.asyncio
async def test_feedback_patch_status_sets_resolved_at(db_session, super_admin):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    svc = FeedbackService(db_session)
    issue = await svc.create(
        author_id=user.id,
        kind="issue",
        anchor_type="task",
        project_id=proj.id,
        task_id=task.id,
        annotation_id=None,
        anchor_position=None,
        severity="info",
        title="t",
        body="b",
        attachments=[],
        thread_parent_id=None,
    )
    await db_session.flush()

    updated = await svc.patch(issue.id, actor_id=user.id, status="resolved")
    assert updated.status == "resolved"
    assert updated.resolved_at is not None
    assert updated.resolved_by_id == user.id

    reopened = await svc.patch(issue.id, actor_id=user.id, status="open")
    assert reopened.status == "open"
    assert reopened.resolved_at is None
    assert reopened.resolved_by_id is None


# ----------------------------------------------------------------------
# ADR-0027 第二段 (v0.10.20) · view 与双写 mirror 测试
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mirror_bug_report_creates_feedback(db_session, super_admin):
    """BugReportService.create 同事务 mirror 到 annotation_feedbacks (kind=bug)."""
    from sqlalchemy import select

    from app.db.models.annotation_feedback import AnnotationFeedback
    from app.services.bug_report import BugReportService

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    bug_svc = BugReportService(db_session)
    await bug_svc.create(
        reporter_id=user.id,
        user_role="super_admin",
        project_id=proj.id,
        task_id=task.id,
        route="/workbench",
        title="按钮无响应",
        description="点保存没反应",
        severity="high",
        status="new",
    )
    await db_session.flush()

    rows = (
        (
            await db_session.execute(
                select(AnnotationFeedback).where(AnnotationFeedback.kind == "bug")
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    mirror = rows[0]
    assert mirror.anchor_type == "task"
    assert mirror.task_id == task.id
    assert mirror.project_id == proj.id
    assert mirror.title == "按钮无响应"
    assert mirror.body == "点保存没反应"
    assert mirror.severity == "high"
    assert mirror.author_id == user.id


@pytest.mark.asyncio
async def test_mirror_bug_report_skips_when_project_null(db_session, super_admin):
    """无 project_id 的 bug (登录页等) 不 mirror, 仅写 bug_reports."""
    from sqlalchemy import select

    from app.db.models.annotation_feedback import AnnotationFeedback
    from app.services.bug_report import BugReportService

    user, _ = super_admin

    bug_svc = BugReportService(db_session)
    await bug_svc.create(
        reporter_id=user.id,
        user_role="super_admin",
        route="/login",
        title="登录失败",
        description="点击登录无响应",
        severity="medium",
        status="new",
    )
    await db_session.flush()

    rows = (
        (
            await db_session.execute(
                select(AnnotationFeedback).where(AnnotationFeedback.kind == "bug")
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


@pytest.mark.asyncio
async def test_mirror_task_reject_creates_feedback(db_session, super_admin):
    """FeedbackService.mirror_task_reject 同事务 mirror (kind=reject)."""
    from sqlalchemy import select

    from app.db.models.annotation_feedback import AnnotationFeedback

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    task.reject_reason = "标错了"
    task.reject_reason_type = "wrong_label"
    await db_session.flush()

    svc = FeedbackService(db_session)
    await svc.mirror_task_reject(task, reviewer_id=user.id)
    await db_session.flush()

    rows = (
        (
            await db_session.execute(
                select(AnnotationFeedback).where(AnnotationFeedback.kind == "reject")
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    mirror = rows[0]
    assert mirror.anchor_type == "task"
    assert mirror.task_id == task.id
    assert mirror.body == "标错了"
    assert mirror.severity == "wrong_label"


@pytest.mark.asyncio
async def test_view_unions_sources(db_session, super_admin):
    """v_annotation_feedback_unified UNION ALL 4 数据源, source_table 列正确分组."""
    from sqlalchemy import text

    from app.services.bug_report import BugReportService

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    # 1. annotation_feedbacks 直接源 (kind=issue)
    svc = FeedbackService(db_session)
    await svc.create(
        author_id=user.id,
        kind="issue",
        anchor_type="task",
        project_id=proj.id,
        task_id=task.id,
        annotation_id=None,
        anchor_position=None,
        severity="info",
        title="t",
        body="b",
        attachments=[],
        thread_parent_id=None,
    )
    # 2. bug_reports → 同事务 mirror feedback (此处 view 应同时映出旧表行 + mirror 行)
    await BugReportService(db_session).create(
        reporter_id=user.id,
        user_role="super_admin",
        project_id=proj.id,
        task_id=task.id,
        route="/workbench",
        title="bug",
        description="desc",
        severity="medium",
        status="new",
    )
    # 3. tasks reject (legacy 字段直接设, 同时调 mirror)
    task.status = "rejected"
    task.reject_reason = "标错了"
    task.reject_reason_type = "wrong_label"
    from datetime import datetime, timezone

    task.reviewed_at = datetime.now(timezone.utc)
    await svc.mirror_task_reject(task, reviewer_id=user.id)
    await db_session.flush()

    rows = (
        await db_session.execute(
            text(
                "SELECT source_table, COUNT(*) FROM v_annotation_feedback_unified "
                "WHERE project_id = :pid GROUP BY source_table ORDER BY source_table"
            ),
            {"pid": proj.id},
        )
    ).all()
    counts = {r[0]: r[1] for r in rows}
    # annotation_feedbacks: 3 行 (issue + bug mirror + reject mirror)
    assert counts.get("annotation_feedbacks") == 3
    # bug_reports: 1 行
    assert counts.get("bug_reports") == 1
    # tasks_reject: 1 行 (task.status=rejected + reject_reason 非空)
    assert counts.get("tasks_reject") == 1


# ----------------------------------------------------------------------
# v0.11.0 · ADR-0027 双写一致性对账 cron 测试
# ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compute_feedback_drift_zero_when_mirrored(db_session, super_admin):
    """正常态：bug/reject 均经双写 mirror → compute_feedback_drift 全 0。"""
    from datetime import datetime, timezone

    from app.services.bug_report import BugReportService
    from app.services.feedback_reconcile import compute_feedback_drift

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    # bug → BugReportService.create 同事务 mirror
    await BugReportService(db_session).create(
        reporter_id=user.id,
        user_role="super_admin",
        project_id=proj.id,
        task_id=task.id,
        route="/workbench",
        title="bug",
        description="desc",
        severity="medium",
        status="new",
    )
    # reject → 设字段 + mirror
    task.status = "rejected"
    task.reject_reason = "标错了"
    task.reject_reason_type = "wrong_label"
    task.reviewed_at = datetime.now(timezone.utc)
    await FeedbackService(db_session).mirror_task_reject(task, reviewer_id=user.id)
    await db_session.flush()

    drift = await compute_feedback_drift(db_session)
    assert sum(len(v["missing_ids"]) for v in drift.values()) == 0
    assert drift["bug_reports"]["missing_ids"] == []
    assert drift["tasks_reject"]["missing_ids"] == []
    # bug_reports expected/actual 对齐：1 旧表行 ↔ 1 mirror 行
    assert drift["bug_reports"]["expected"] == 1
    assert drift["bug_reports"]["actual"] == 1


@pytest.mark.asyncio
async def test_reconcile_detects_drift_and_notifies(
    db_session, super_admin, monkeypatch
):
    """人为制造 drift（插 bug 不 mirror）→ 检出 missing=1 + notify_many 被调用。"""
    import uuid as _uuid

    from app.db.models.bug_report import BugReport
    from app.services.feedback_reconcile import compute_feedback_drift
    from app.services.notification import NotificationService
    from app.workers.feedback_reconcile import run_reconcile

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    await db_session.flush()

    # 直接插旧表行，跳过 BugReportService.create 的双写 → 制造漂移
    db_session.add(
        BugReport(
            id=_uuid.uuid4(),
            display_id="B-DRIFT-1",
            reporter_id=user.id,
            route="/workbench",
            user_role="super_admin",
            project_id=proj.id,
            task_id=None,
            title="orphan bug",
            description="never mirrored",
            severity="high",
            status="new",
        )
    )
    await db_session.flush()

    drift = await compute_feedback_drift(db_session)
    assert len(drift["bug_reports"]["missing_ids"]) == 1
    assert drift["bug_reports"]["expected"] == 1
    assert drift["bug_reports"]["actual"] == 0

    # run_reconcile：drift>0 应写 audit + 调 notify_many 通知 superadmin
    calls: list[dict] = []
    orig = NotificationService.notify_many

    async def _spy(self, **kwargs):
        calls.append(kwargs)
        return await orig(self, **kwargs)

    monkeypatch.setattr(NotificationService, "notify_many", _spy)

    result = await run_reconcile(db_session)
    assert result["total_missing"] == 1
    assert len(calls) == 1
    assert calls[0]["type"] == "feedback.reconcile_drift"
    assert user.id in calls[0]["user_ids"]
    assert calls[0]["payload"]["total_missing"] == 1
    assert calls[0]["payload"]["missing_by_source"]["bug_reports"] == 1
