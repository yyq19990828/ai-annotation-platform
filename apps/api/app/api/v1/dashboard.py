from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from app.deps import get_db, get_current_user, require_roles
from app.db.models.user import User
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.annotation import Annotation
from app.db.models.audit_log import AuditLog
from app.db.enums import UserRole, TaskStatus
from app.schemas.dashboard import (
    AdminDashboardStats,
    ReviewerDashboardStats,
    ReviewTaskItem,
    AnnotatorDashboardStats,
    RecentReviewItem,
)

router = APIRouter()


@router.get("/admin", response_model=AdminDashboardStats)
async def admin_dashboard(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    users_result = await db.execute(select(User).where(User.is_active.is_(True)))
    users = users_result.scalars().all()
    total_users = len(users)
    active_users = sum(1 for u in users if u.status == "online")

    role_distribution: dict[str, int] = {}
    for u in users:
        role_distribution[u.role] = role_distribution.get(u.role, 0) + 1

    projects_result = await db.execute(select(Project))
    projects = projects_result.scalars().all()
    total_projects = len(projects)
    projects_in_progress = sum(1 for p in projects if p.status == "in_progress")
    projects_completed = sum(1 for p in projects if p.status == "completed")
    projects_pending_review = sum(1 for p in projects if p.status == "pending_review")
    projects_archived = sum(1 for p in projects if p.status == "archived")

    total_tasks_result = await db.execute(select(func.count()).select_from(Task))
    total_tasks = total_tasks_result.scalar() or 0

    total_annotations_result = await db.execute(
        select(func.count()).select_from(Annotation).where(Annotation.is_active.is_(True))
    )
    total_annotations = total_annotations_result.scalar() or 0

    ml_total = 0
    ml_connected = 0
    try:
        from app.db.models.ml_backend import MLBackend
        ml_result = await db.execute(select(MLBackend))
        ml_backends = ml_result.scalars().all()
        ml_total = len(ml_backends)
        ml_connected = sum(1 for m in ml_backends if m.state == "connected")
    except Exception:
        pass

    return AdminDashboardStats(
        total_users=total_users,
        active_users=active_users,
        total_projects=total_projects,
        projects_in_progress=projects_in_progress,
        projects_completed=projects_completed,
        projects_pending_review=projects_pending_review,
        projects_archived=projects_archived,
        total_tasks=total_tasks,
        total_annotations=total_annotations,
        ml_backends_total=ml_total,
        ml_backends_connected=ml_connected,
        role_distribution=role_distribution,
    )


@router.get("/reviewer", response_model=ReviewerDashboardStats)
async def reviewer_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER
    )),
):
    pending_result = await db.execute(
        select(func.count()).select_from(Task).where(Task.status == TaskStatus.REVIEW)
    )
    pending_review_count = pending_result.scalar() or 0

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    today_reviewed_result = await db.execute(
        select(func.count()).select_from(Task).where(
            Task.status == TaskStatus.COMPLETED,
            Task.updated_at >= today_start,
        )
    )
    today_reviewed = today_reviewed_result.scalar() or 0

    total_completed_result = await db.execute(
        select(func.count()).select_from(Task).where(Task.status == TaskStatus.COMPLETED)
    )
    total_completed = total_completed_result.scalar() or 0

    total_all_reviewed = total_completed + pending_review_count
    approval_rate = (total_completed / total_all_reviewed * 100) if total_all_reviewed > 0 else 0.0

    # v0.6.6 · 24h 滚动通过率：基于 audit_logs 中过去 24h 的 task.approve / task.reject 计数
    cutoff_24h = now - timedelta(hours=24)
    rate_24h_result = await db.execute(
        select(
            func.count().filter(AuditLog.action == "task.approve").label("approve_n"),
            func.count().filter(AuditLog.action == "task.reject").label("reject_n"),
        ).where(AuditLog.created_at >= cutoff_24h)
    )
    row = rate_24h_result.one()
    approve_n = row.approve_n or 0
    reject_n = row.reject_n or 0
    denom_24h = approve_n + reject_n
    approval_rate_24h = (approve_n / denom_24h * 100) if denom_24h > 0 else 0.0

    pending_tasks_result = await db.execute(
        select(Task, Project.name)
        .join(Project, Task.project_id == Project.id)
        .where(Task.status == TaskStatus.REVIEW)
        .order_by(Task.updated_at.desc())
        .limit(50)
    )
    pending_tasks = [
        ReviewTaskItem(
            task_id=str(t.id),
            task_display_id=t.display_id,
            file_name=t.file_name,
            project_id=str(t.project_id),
            project_name=pname,
            total_annotations=t.total_annotations,
            total_predictions=t.total_predictions,
            updated_at=t.updated_at.isoformat() if t.updated_at else None,
        )
        for t, pname in pending_tasks_result.all()
    ]

    # v0.7.0：批次级聚合 — 列出处于 reviewing 状态的批次（reviewer 跨批次审核）。
    from app.db.models.task_batch import TaskBatch
    from app.schemas.dashboard import ReviewingBatchItem  # 新 schema 见下
    batch_rows = (await db.execute(
        select(TaskBatch, Project.name)
        .join(Project, TaskBatch.project_id == Project.id)
        .where(TaskBatch.status == "reviewing")
        .order_by(TaskBatch.updated_at.desc())
        .limit(20)
    )).all()
    reviewing_batches = [
        ReviewingBatchItem(
            batch_id=str(b.id),
            batch_display_id=b.display_id,
            batch_name=b.name,
            project_id=str(b.project_id),
            project_name=pname,
            total_tasks=b.total_tasks,
            review_tasks=b.review_tasks,
            completed_tasks=b.completed_tasks,
        )
        for b, pname in batch_rows
    ]

    return ReviewerDashboardStats(
        pending_review_count=pending_review_count,
        today_reviewed=today_reviewed,
        approval_rate=round(approval_rate, 1),
        approval_rate_24h=round(approval_rate_24h, 1),
        total_reviewed=total_completed,
        pending_tasks=pending_tasks,
        reviewing_batches=reviewing_batches,
    )


@router.get("/me/recent-reviews", response_model=list[RecentReviewItem])
async def my_recent_reviews(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER
    )),
):
    """v0.6.6 · 当前 reviewer 最近审核过的任务（已 approve / reject 落定的）。

    依据 Task.reviewer_id + Task.reviewed_at（v0.6.5 状态机字段）。
    """
    result = await db.execute(
        select(Task, Project.name)
        .join(Project, Task.project_id == Project.id)
        .where(Task.reviewer_id == current_user.id)
        .where(Task.reviewed_at.isnot(None))
        .order_by(Task.reviewed_at.desc())
        .limit(limit)
    )
    return [
        RecentReviewItem(
            task_id=str(t.id),
            task_display_id=t.display_id,
            file_name=t.file_name,
            project_id=str(t.project_id),
            project_name=pname,
            status=t.status,
            reviewed_at=t.reviewed_at.isoformat() if t.reviewed_at else None,
        )
        for t, pname in result.all()
    ]


@router.get("/annotator", response_model=AnnotatorDashboardStats)
async def annotator_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER, UserRole.ANNOTATOR
    )),
):
    assigned_result = await db.execute(
        select(func.count()).select_from(Task).where(
            Task.assignee_id == current_user.id,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
        )
    )
    assigned_tasks = assigned_result.scalar() or 0

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())

    today_completed_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
            Annotation.created_at >= today_start,
        )
    )
    today_completed = today_completed_result.scalar() or 0

    weekly_completed_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
            Annotation.created_at >= week_start,
        )
    )
    weekly_completed = weekly_completed_result.scalar() or 0

    total_completed_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
        )
    )
    total_completed = total_completed_result.scalar() or 0

    ai_derived_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
            Annotation.parent_prediction_id.isnot(None),
        )
    )
    ai_derived = ai_derived_result.scalar() or 0
    personal_accuracy = ((total_completed - ai_derived) / total_completed * 100) if total_completed > 0 else 100.0

    daily_counts = []
    for i in range(6, -1, -1):
        day_start = today_start - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        day_result = await db.execute(
            select(func.count()).select_from(Annotation).where(
                Annotation.user_id == current_user.id,
                Annotation.is_active.is_(True),
                Annotation.created_at >= day_start,
                Annotation.created_at < day_end,
            )
        )
        daily_counts.append(day_result.scalar() or 0)

    return AnnotatorDashboardStats(
        assigned_tasks=assigned_tasks,
        today_completed=today_completed,
        weekly_completed=weekly_completed,
        total_completed=total_completed,
        personal_accuracy=round(personal_accuracy, 1),
        daily_counts=daily_counts,
    )
