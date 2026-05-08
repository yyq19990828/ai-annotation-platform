from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, cast, Date
from app.deps import get_db, require_roles
from app.db.models.user import User
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.annotation import Annotation
from app.db.models.audit_log import AuditLog
from app.db.models.task_batch import TaskBatch
from app.db.models.task_event import TaskEvent
from app.db.enums import UserRole, TaskStatus
from app.schemas.dashboard import (
    AdminDashboardStats,
    RegistrationDayPoint,
    ReviewerDashboardStats,
    ReviewTaskItem,
    ReviewingBatchItem,
    AnnotatorDashboardStats,
    MyBatchItem,
    RecentReviewItem,
    AdminPeopleList,
    AdminPersonItem,
    AdminPersonDetail,
    PredictionCostStats,
    BackendCostBreakdown,
    ReviewerMiniStats,
)
from app.db.models.project_member import ProjectMember
from app.db.models.prediction import Prediction, PredictionMeta, FailedPrediction
from app.db.models.ml_backend import MLBackend
from app.services.user_brief import resolve_briefs_with_project_role

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
        select(func.count())
        .select_from(Annotation)
        .where(Annotation.is_active.is_(True))
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

    # v0.9.5 · pre_annotated 批次计数（Sidebar 徽章 + AdminDashboard 卡片共用）
    from app.db.models.task_batch import TaskBatch
    from app.db.enums import BatchStatus

    pre_annotated_batches = (
        await db.execute(
            select(func.count())
            .select_from(TaskBatch)
            .where(TaskBatch.status == BatchStatus.PRE_ANNOTATED)
        )
    ).scalar() or 0

    # v0.8.1 · 过去 30 天注册来源（按日聚合 audit_logs.action='user.register'）
    cutoff_30d = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=29)
    reg_rows = (
        await db.execute(
            select(
                func.date_trunc("day", AuditLog.created_at).label("day"),
                func.count()
                .filter(AuditLog.detail_json["method"].astext == "open_registration")
                .label("open_count"),
                func.count()
                .filter(AuditLog.detail_json.has_key("invitation_id"))  # noqa: W601
                .label("invite_count"),
            )
            .where(
                AuditLog.action == "user.register",
                AuditLog.created_at >= cutoff_30d,
            )
            .group_by("day")
            .order_by("day")
        )
    ).all()
    by_day_map = {
        r.day.date().isoformat(): (int(r.open_count or 0), int(r.invite_count or 0))
        for r in reg_rows
    }
    registration_by_day: list[RegistrationDayPoint] = []
    for i in range(30):
        d = (cutoff_30d + timedelta(days=i)).date().isoformat()
        open_n, invite_n = by_day_map.get(d, (0, 0))
        registration_by_day.append(
            RegistrationDayPoint(date=d, open_count=open_n, invite_count=invite_n)
        )

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
        registration_by_day=registration_by_day,
        pre_annotated_batches=int(pre_annotated_batches),
    )


@router.get("/reviewer", response_model=ReviewerDashboardStats)
async def reviewer_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)
    ),
):
    pending_result = await db.execute(
        select(func.count()).select_from(Task).where(Task.status == TaskStatus.REVIEW)
    )
    pending_review_count = pending_result.scalar() or 0

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    today_reviewed_result = await db.execute(
        select(func.count())
        .select_from(Task)
        .where(
            Task.status == TaskStatus.COMPLETED,
            Task.updated_at >= today_start,
        )
    )
    today_reviewed = today_reviewed_result.scalar() or 0

    total_completed_result = await db.execute(
        select(func.count())
        .select_from(Task)
        .where(Task.status == TaskStatus.COMPLETED)
    )
    total_completed = total_completed_result.scalar() or 0

    total_all_reviewed = total_completed + pending_review_count
    approval_rate = (
        (total_completed / total_all_reviewed * 100) if total_all_reviewed > 0 else 0.0
    )

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
    # v0.7.1 B-18：扩展为「reviewing 批次 ∪ 任意 review_tasks > 0 的批次」，让单任务级提交质检
    # 也能在 ReviewPage 的批次树里看到，避免 reviewer 找不到入口。
    batch_rows = (
        await db.execute(
            select(TaskBatch, Project.name)
            .join(Project, TaskBatch.project_id == Project.id)
            .where(
                or_(
                    TaskBatch.status == "reviewing",
                    TaskBatch.review_tasks > 0,
                )
            )
            .where(TaskBatch.status.in_(["active", "annotating", "reviewing"]))
            .order_by(Project.name, TaskBatch.updated_at.desc())
            .limit(100)
        )
    ).all()
    # v0.7.2 · 单值语义 — 一 batch 一标注员，直接 IN 查询 user
    project_user_map: dict = {}
    for b, _ in batch_rows:
        if b.annotator_id is not None:
            project_user_map.setdefault(b.project_id, set()).add(b.annotator_id)
    briefs_by_project: dict = {}
    for pid, uids in project_user_map.items():
        briefs_by_project[pid] = await resolve_briefs_with_project_role(db, pid, uids)

    reviewing_batches = []
    for b, pname in batch_rows:
        per_proj = briefs_by_project.get(b.project_id, {})
        annotator = per_proj.get(str(b.annotator_id)) if b.annotator_id else None
        reviewing_batches.append(
            ReviewingBatchItem(
                batch_id=str(b.id),
                batch_display_id=b.display_id,
                batch_name=b.name,
                project_id=str(b.project_id),
                project_name=pname,
                total_tasks=b.total_tasks,
                review_tasks=b.review_tasks,
                completed_tasks=b.completed_tasks,
                annotator=annotator,
            )
        )

    # v0.8.4 · 效率看板 L2 扩展
    # 平均审核耗时（中位） = reviewed_at - reviewer_claimed_at（自己审过的任务）
    review_duration_row = (
        await db.execute(
            select(
                func.percentile_cont(0.5)
                .within_group(
                    (
                        func.extract(
                            "epoch", Task.reviewed_at - Task.reviewer_claimed_at
                        )
                        * 1000
                    ).asc()
                )
                .label("median_ms")
            ).where(
                Task.reviewer_id == current_user.id,
                Task.reviewer_claimed_at.isnot(None),
                Task.reviewed_at.isnot(None),
            )
        )
    ).first()
    median_review_duration_ms = (
        int(review_duration_row.median_ms)
        if review_duration_row and review_duration_row.median_ms
        else None
    )

    # 二次返修率：自己 approve 的 task（task.reviewer_id == me 且 status==completed）
    # 后又被 reopen（reopened_count > 0）的比例
    reopen_after_row = (
        await db.execute(
            select(
                func.count()
                .filter(Task.status == TaskStatus.COMPLETED)
                .label("approved_n"),
                func.count()
                .filter(
                    Task.status == TaskStatus.COMPLETED,
                    Task.reopened_count > 0,
                )
                .label("reopened_n"),
            ).where(Task.reviewer_id == current_user.id)
        )
    ).first()
    approved_n = int(reopen_after_row.approved_n or 0) if reopen_after_row else 0
    reopen_after_approve_rate = (
        round((reopen_after_row.reopened_n or 0) / approved_n * 100, 1)
        if approved_n > 0
        else None
    )

    # 7 日审核数 sparkline
    daily_review_counts: list[int] = []
    for i in range(6, -1, -1):
        ds = today_start - timedelta(days=i)
        de = ds + timedelta(days=1)
        n = (
            await db.execute(
                select(func.count())
                .select_from(Task)
                .where(
                    Task.reviewer_id == current_user.id,
                    Task.reviewed_at.isnot(None),
                    Task.reviewed_at >= ds,
                    Task.reviewed_at < de,
                )
            )
        ).scalar() or 0
        daily_review_counts.append(int(n))

    # 周环比
    week_start_r = today_start - timedelta(days=today_start.weekday())
    last_week_start_r = week_start_r - timedelta(days=7)
    this_week_n = (
        await db.execute(
            select(func.count())
            .select_from(Task)
            .where(
                Task.reviewer_id == current_user.id,
                Task.reviewed_at.isnot(None),
                Task.reviewed_at >= week_start_r,
            )
        )
    ).scalar() or 0
    last_week_n = (
        await db.execute(
            select(func.count())
            .select_from(Task)
            .where(
                Task.reviewer_id == current_user.id,
                Task.reviewed_at.isnot(None),
                Task.reviewed_at >= last_week_start_r,
                Task.reviewed_at < week_start_r,
            )
        )
    ).scalar() or 0
    weekly_compare_pct_r: float | None
    if last_week_n > 0:
        weekly_compare_pct_r = round((this_week_n - last_week_n) / last_week_n * 100, 1)
    elif this_week_n > 0:
        weekly_compare_pct_r = 100.0
    else:
        weekly_compare_pct_r = None

    return ReviewerDashboardStats(
        pending_review_count=pending_review_count,
        today_reviewed=today_reviewed,
        approval_rate=round(approval_rate, 1),
        approval_rate_24h=round(approval_rate_24h, 1),
        total_reviewed=total_completed,
        pending_tasks=pending_tasks,
        reviewing_batches=reviewing_batches,
        median_review_duration_ms=median_review_duration_ms,
        reopen_after_approve_rate=reopen_after_approve_rate,
        weekly_compare_pct=weekly_compare_pct_r,
        daily_review_counts=daily_review_counts,
    )


@router.get("/reviewer/today-mini", response_model=ReviewerMiniStats)
async def reviewer_today_mini(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)
    ),
):
    """v0.8.7 F5.3 · ReviewWorkbench 右侧栏 mini 仪表轻量端点。

    - approved_today / rejected_today: 自己当日 approve/reject 的次数（基于 Task.reviewer_id）
    - avg_review_seconds: 自己当日审过的任务（reviewer_claimed_at → reviewed_at）平均耗时秒数
    20s 自动 refetch（前端 query staleTime）。
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # reject 流程：task.status 落回 in_progress，但 task.reject_reason 有值。
    # approve 流程：task.status = completed。
    # 当日审核耗时按 (reviewed_at - reviewer_claimed_at) 平均。
    counts = (
        await db.execute(
            select(
                func.count()
                .filter(Task.status == TaskStatus.COMPLETED)
                .label("approved"),
                func.count()
                .filter(
                    Task.status == TaskStatus.IN_PROGRESS,
                    Task.reject_reason.isnot(None),
                )
                .label("rejected"),
                func.avg(
                    func.extract("epoch", Task.reviewed_at - Task.reviewer_claimed_at)
                ).label("avg_seconds"),
            ).where(
                Task.reviewer_id == current_user.id,
                Task.reviewed_at.isnot(None),
                Task.reviewed_at >= today_start,
            )
        )
    ).first()

    return ReviewerMiniStats(
        approved_today=int(counts.approved or 0) if counts else 0,
        rejected_today=int(counts.rejected or 0) if counts else 0,
        avg_review_seconds=(
            float(counts.avg_seconds)
            if counts and counts.avg_seconds is not None
            else None
        ),
    )


@router.get("/me/recent-reviews", response_model=list[RecentReviewItem])
async def my_recent_reviews(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)
    ),
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
    current_user: User = Depends(
        require_roles(
            UserRole.SUPER_ADMIN,
            UserRole.PROJECT_ADMIN,
            UserRole.REVIEWER,
            UserRole.ANNOTATOR,
        )
    ),
):
    assigned_result = await db.execute(
        select(func.count())
        .select_from(Task)
        .where(
            Task.assignee_id == current_user.id,
            Task.status.in_([TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
        )
    )
    assigned_tasks = assigned_result.scalar() or 0

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())

    today_completed_result = await db.execute(
        select(func.count())
        .select_from(Annotation)
        .where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
            Annotation.created_at >= today_start,
        )
    )
    today_completed = today_completed_result.scalar() or 0

    weekly_completed_result = await db.execute(
        select(func.count())
        .select_from(Annotation)
        .where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
            Annotation.created_at >= week_start,
        )
    )
    weekly_completed = weekly_completed_result.scalar() or 0

    total_completed_result = await db.execute(
        select(func.count())
        .select_from(Annotation)
        .where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
        )
    )
    total_completed = total_completed_result.scalar() or 0

    ai_derived_result = await db.execute(
        select(func.count())
        .select_from(Annotation)
        .where(
            Annotation.user_id == current_user.id,
            Annotation.is_active.is_(True),
            Annotation.parent_prediction_id.isnot(None),
        )
    )
    ai_derived = ai_derived_result.scalar() or 0
    personal_accuracy = (
        ((total_completed - ai_derived) / total_completed * 100)
        if total_completed > 0
        else 100.0
    )

    daily_counts = []
    for i in range(6, -1, -1):
        day_start = today_start - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        day_result = await db.execute(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.user_id == current_user.id,
                Annotation.is_active.is_(True),
                Annotation.created_at >= day_start,
                Annotation.created_at < day_end,
            )
        )
        daily_counts.append(day_result.scalar() or 0)

    # v0.8.4 · 效率看板 L2 字段：基于 Task.assigned_at / submitted_at / reopened_count
    # 中位单题耗时（仅本人 + assigned_at IS NOT NULL + submitted_at 在过去 30d）
    cutoff_30d = now - timedelta(days=30)
    duration_rows = (
        await db.execute(
            select(
                func.percentile_cont(0.5)
                .within_group(
                    (
                        func.extract("epoch", Task.submitted_at - Task.assigned_at)
                        * 1000
                    ).asc()
                )
                .label("median_ms")
            ).where(
                Task.assignee_id == current_user.id,
                Task.assigned_at.isnot(None),
                Task.submitted_at.isnot(None),
                Task.submitted_at >= cutoff_30d,
            )
        )
    ).first()
    median_duration_ms = (
        int(duration_rows.median_ms)
        if duration_rows and duration_rows.median_ms
        else None
    )

    # 退回率 / 重审次数：仅本人，submitted_at 不为空（已提交过的任务）
    reopen_row = (
        await db.execute(
            select(
                func.count().label("submitted_n"),
                func.count().filter(Task.reopened_count > 0).label("reopened_n"),
                func.coalesce(func.avg(Task.reopened_count), 0.0).label("reopen_avg"),
            ).where(
                Task.assignee_id == current_user.id,
                Task.submitted_at.isnot(None),
            )
        )
    ).first()
    submitted_n = int(reopen_row.submitted_n or 0) if reopen_row else 0
    rejected_rate = (
        round((reopen_row.reopened_n or 0) / submitted_n * 100, 1)
        if submitted_n > 0
        else None
    )
    reopened_avg = (
        round(float(reopen_row.reopen_avg), 2)
        if reopen_row and reopen_row.reopen_avg is not None
        else None
    )

    # 周环比：本周完成 vs 上周完成
    last_week_start = week_start - timedelta(days=7)
    last_week_n = (
        await db.execute(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.user_id == current_user.id,
                Annotation.is_active.is_(True),
                Annotation.created_at >= last_week_start,
                Annotation.created_at < week_start,
            )
        )
    ).scalar() or 0
    weekly_compare_pct: float | None
    if last_week_n > 0:
        weekly_compare_pct = round(
            (weekly_completed - last_week_n) / last_week_n * 100, 1
        )
    elif weekly_completed > 0:
        weekly_compare_pct = 100.0  # 上周 0 → 本周有量 → +100%
    else:
        weekly_compare_pct = None

    # 周目标：ProjectMember.weekly_target → User.weekly_target_default → 200
    weekly_target = getattr(current_user, "weekly_target_default", None) or 200

    # v0.8.4.1 hotfix · 接通 task_events 真实数据（与 0.8.3 心跳基座并行开发遗留）
    # active_minutes_today: 当日累计 duration_ms / 60000
    active_ms_row = (
        await db.execute(
            select(func.coalesce(func.sum(TaskEvent.duration_ms), 0).label("ms")).where(
                TaskEvent.user_id == current_user.id,
                TaskEvent.started_at >= today_start,
            )
        )
    ).first()
    active_minutes_today = int((active_ms_row.ms if active_ms_row else 0) // 60000)

    # v0.8.5 · 24-bar 当日专注时段：按 EXTRACT(hour) 聚合 duration_ms → 分钟
    hour_rows = (
        await db.execute(
            select(
                func.extract("hour", TaskEvent.started_at).label("hour"),
                func.coalesce(func.sum(TaskEvent.duration_ms), 0).label("ms"),
            )
            .where(
                TaskEvent.user_id == current_user.id,
                TaskEvent.started_at >= today_start,
                TaskEvent.started_at < today_start + timedelta(days=1),
            )
            .group_by(func.extract("hour", TaskEvent.started_at))
        )
    ).all()
    hour_map = {int(r.hour): int(r.ms // 60000) for r in hour_rows}
    hour_buckets = [hour_map.get(h, 0) for h in range(24)]

    # streak_days: 从今天倒推 distinct UTC 日期连续计数（30 天上限）
    streak_cutoff = today_start - timedelta(days=29)
    day_expr = cast(func.timezone("UTC", TaskEvent.started_at), Date)
    day_rows = (
        await db.execute(
            select(day_expr.label("d"))
            .where(
                TaskEvent.user_id == current_user.id,
                TaskEvent.started_at >= streak_cutoff,
            )
            .distinct()
        )
    ).all()
    day_set = {r.d for r in day_rows}
    streak_days = 0
    cursor = today_start.date()
    while cursor in day_set:
        streak_days += 1
        cursor -= timedelta(days=1)

    return AnnotatorDashboardStats(
        assigned_tasks=assigned_tasks,
        today_completed=today_completed,
        weekly_completed=weekly_completed,
        total_completed=total_completed,
        personal_accuracy=round(personal_accuracy, 1),
        daily_counts=daily_counts,
        median_duration_ms=median_duration_ms,
        rejected_rate=rejected_rate,
        reopened_avg=reopened_avg,
        weekly_compare_pct=weekly_compare_pct,
        weekly_target=weekly_target,
        active_minutes_today=active_minutes_today,
        streak_days=streak_days,
        hour_buckets=hour_buckets,
    )


@router.get("/annotator/batches", response_model=list[MyBatchItem])
async def my_batches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_roles(
            UserRole.SUPER_ADMIN,
            UserRole.PROJECT_ADMIN,
            UserRole.REVIEWER,
            UserRole.ANNOTATOR,
        )
    ),
):
    """v0.7.1 B-17 · 标注员视角的「我的批次」：仅返回当前用户被分派、且处于
    active / annotating / rejected / reviewing 的批次。让标注员从 dashboard
    一眼看到自己手里的批次进度，并直接「提交质检」/ 查看 reviewer 留言。

    super_admin 看到所有同状态批次（便于演示 / 调试）；其他角色按 annotator_id 过滤（v0.7.2 单值）。"""
    visible_statuses = ["active", "annotating", "rejected", "reviewing"]

    q = (
        select(TaskBatch, Project.name, Project.id)
        .join(Project, TaskBatch.project_id == Project.id)
        .where(TaskBatch.status.in_(visible_statuses))
    )
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.where(TaskBatch.annotator_id == current_user.id)
    q = q.order_by(Project.name, TaskBatch.created_at.desc()).limit(100)

    rows = (await db.execute(q)).all()

    # v0.7.2 · 单值语义 — 一 batch 一审核员
    project_user_map: dict = {}
    for b, _, _ in rows:
        if b.reviewer_id is not None:
            project_user_map.setdefault(b.project_id, set()).add(b.reviewer_id)
    briefs_by_project: dict = {}
    for pid, uids in project_user_map.items():
        briefs_by_project[pid] = await resolve_briefs_with_project_role(db, pid, uids)

    items = []
    for b, pname, pid in rows:
        per_proj = briefs_by_project.get(b.project_id, {})
        reviewer = per_proj.get(str(b.reviewer_id)) if b.reviewer_id else None
        items.append(
            MyBatchItem(
                batch_id=str(b.id),
                batch_display_id=b.display_id,
                batch_name=b.name,
                project_id=str(pid),
                project_name=pname,
                status=b.status,
                total_tasks=b.total_tasks,
                completed_tasks=b.completed_tasks,
                review_tasks=b.review_tasks,
                approved_tasks=b.approved_tasks,
                rejected_tasks=b.rejected_tasks,
                progress_pct=round(
                    (b.completed_tasks / b.total_tasks * 100) if b.total_tasks else 0.0,
                    1,
                ),
                review_feedback=b.review_feedback,
                reviewed_at=b.reviewed_at.isoformat() if b.reviewed_at else None,
                reviewer=reviewer,
            )
        )
    return items


# ─── v0.8.4 · 管理员人员看板 ───────────────────────────────────────────────────


def _percentile_rank(values: list[float], target: float) -> int:
    """简易团队分位（0-100）：value 在排序后处于的百分位。"""
    if not values:
        return 50
    below = sum(1 for v in values if v < target)
    return int(round(below / len(values) * 100))


def _period_window(period: str) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        return today, now
    if period == "1m":
        return today - timedelta(days=30), now
    if period == "4w":
        return today - timedelta(days=28), now
    # default: 7d / week
    return today - timedelta(days=6), now


@router.get("/admin/people", response_model=AdminPeopleList)
async def admin_people_list(
    role: str | None = Query(None),
    project: str | None = Query(None),
    period: str = Query("7d"),
    sort: str = Query("throughput"),
    q: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    """v0.8.4 · 全员效率卡片网格数据。

    role 过滤：annotator / reviewer / both（默认 both）
    period: today / 7d / 4w / 1m
    sort: throughput / quality / activity / weekly_compare
    """
    start, _end = _period_window(period)
    week_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    week_start = week_start - timedelta(days=week_start.weekday())
    last_week_start = week_start - timedelta(days=7)

    # 拉用户
    user_q = select(User).where(User.is_active.is_(True))
    if role == "annotator":
        user_q = user_q.where(User.role.in_([UserRole.ANNOTATOR, UserRole.SUPER_ADMIN]))
    elif role == "reviewer":
        user_q = user_q.where(
            User.role.in_(
                [UserRole.REVIEWER, UserRole.PROJECT_ADMIN, UserRole.SUPER_ADMIN]
            )
        )
    if q:
        like = f"%{q}%"
        user_q = user_q.where(or_(User.name.ilike(like), User.email.ilike(like)))
    users = (await db.execute(user_q)).scalars().all()

    if not users:
        return AdminPeopleList(items=[], total=0, period=period)

    user_ids = [u.id for u in users]

    # 项目隶属计数
    pm_rows = (
        await db.execute(
            select(ProjectMember.user_id, func.count().label("n"))
            .where(ProjectMember.user_id.in_(user_ids))
            .group_by(ProjectMember.user_id)
        )
    ).all()
    pm_count_map = {r.user_id: int(r.n) for r in pm_rows}

    # 标注吞吐（period 内）
    ann_rows = (
        await db.execute(
            select(Annotation.user_id, func.count().label("n"))
            .where(
                Annotation.user_id.in_(user_ids),
                Annotation.is_active.is_(True),
                Annotation.created_at >= start,
            )
            .group_by(Annotation.user_id)
        )
    ).all()
    ann_count_map = {r.user_id: int(r.n) for r in ann_rows}

    # 审核吞吐（reviewer）
    rev_rows = (
        await db.execute(
            select(Task.reviewer_id, func.count().label("n"))
            .where(
                Task.reviewer_id.in_(user_ids),
                Task.reviewed_at.isnot(None),
                Task.reviewed_at >= start,
            )
            .group_by(Task.reviewer_id)
        )
    ).all()
    rev_count_map = {r.reviewer_id: int(r.n) for r in rev_rows}

    # 上周对比（标注员）
    last_week_rows = (
        await db.execute(
            select(Annotation.user_id, func.count().label("n"))
            .where(
                Annotation.user_id.in_(user_ids),
                Annotation.is_active.is_(True),
                Annotation.created_at >= last_week_start,
                Annotation.created_at < week_start,
            )
            .group_by(Annotation.user_id)
        )
    ).all()
    last_week_map = {r.user_id: int(r.n) for r in last_week_rows}

    this_week_rows = (
        await db.execute(
            select(Annotation.user_id, func.count().label("n"))
            .where(
                Annotation.user_id.in_(user_ids),
                Annotation.is_active.is_(True),
                Annotation.created_at >= week_start,
            )
            .group_by(Annotation.user_id)
        )
    ).all()
    this_week_map = {r.user_id: int(r.n) for r in this_week_rows}

    # 退回率（标注员）
    reopen_rows = (
        await db.execute(
            select(
                Task.assignee_id,
                func.count().label("submitted_n"),
                func.count().filter(Task.reopened_count > 0).label("reopened_n"),
            )
            .where(
                Task.assignee_id.in_(user_ids),
                Task.submitted_at.isnot(None),
            )
            .group_by(Task.assignee_id)
        )
    ).all()
    reopen_map = {
        r.assignee_id: (int(r.submitted_n or 0), int(r.reopened_n or 0))
        for r in reopen_rows
    }

    # 7 日 sparkline（统一按 annotation 创建数；reviewer 用 reviewed_at）
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    daily_buckets: dict = {}  # user_id → [7 ints]
    for i in range(6, -1, -1):
        ds = today_start - timedelta(days=i)
        de = ds + timedelta(days=1)
        rows = (
            await db.execute(
                select(Annotation.user_id, func.count().label("n"))
                .where(
                    Annotation.user_id.in_(user_ids),
                    Annotation.is_active.is_(True),
                    Annotation.created_at >= ds,
                    Annotation.created_at < de,
                )
                .group_by(Annotation.user_id)
            )
        ).all()
        per_user = {r.user_id: int(r.n) for r in rows}
        for uid in user_ids:
            daily_buckets.setdefault(uid, []).append(per_user.get(uid, 0))

    # v0.8.4.1 hotfix · 7d active_minutes 团队分位（替换 activity_score=50 占位）
    seven_d_start = today_start - timedelta(days=6)
    active_rows = (
        await db.execute(
            select(
                TaskEvent.user_id,
                func.coalesce(func.sum(TaskEvent.duration_ms), 0).label("ms"),
            )
            .where(
                TaskEvent.user_id.in_(user_ids),
                TaskEvent.started_at >= seven_d_start,
            )
            .group_by(TaskEvent.user_id)
        )
    ).all()
    active_minutes_map = {r.user_id: int((r.ms or 0) // 60000) for r in active_rows}

    # 计算分位
    def _is_reviewer_role(u: User) -> bool:
        return u.role in (
            UserRole.REVIEWER,
            UserRole.PROJECT_ADMIN,
            UserRole.SUPER_ADMIN,
        )

    throughputs = []
    quality_scores = []
    activity_minutes_list = []
    for u in users:
        if _is_reviewer_role(u) and u.role != UserRole.ANNOTATOR:
            throughputs.append(rev_count_map.get(u.id, 0))
        else:
            throughputs.append(ann_count_map.get(u.id, 0))
        sub_n, reop_n = reopen_map.get(u.id, (0, 0))
        rejected_rate = (reop_n / sub_n * 100) if sub_n > 0 else 0.0
        quality_scores.append(100.0 - min(100.0, rejected_rate))
        activity_minutes_list.append(active_minutes_map.get(u.id, 0))

    items: list[AdminPersonItem] = []
    for idx, u in enumerate(users):
        is_reviewer = u.role in (UserRole.REVIEWER, UserRole.PROJECT_ADMIN)
        main_metric = throughputs[idx]
        main_label = (
            f"本周{period if period != '7d' else ''}审核数"
            if is_reviewer
            else f"本周{period if period != '7d' else ''}完成数"
        )

        sub_n, reop_n = reopen_map.get(u.id, (0, 0))
        rejected_rate: float | None = (
            round((reop_n / sub_n * 100), 1) if sub_n > 0 else None
        )

        last_n = last_week_map.get(u.id, 0)
        this_n = this_week_map.get(u.id, 0)
        if last_n > 0:
            wcp: float | None = round((this_n - last_n) / last_n * 100, 1)
        elif this_n > 0:
            wcp = 100.0
        else:
            wcp = None

        alerts: list[str] = []
        if rejected_rate is not None and rejected_rate > 15:
            alerts.append("high_rejected")
        if wcp is not None and wcp < -30:
            alerts.append("drop_30")

        items.append(
            AdminPersonItem(
                user_id=str(u.id),
                name=u.name,
                email=u.email,
                role=u.role,
                status=u.status,
                project_count=pm_count_map.get(u.id, 0),
                main_metric=main_metric,
                main_metric_label=main_label,
                weekly_compare_pct=wcp,
                throughput_score=_percentile_rank(throughputs, throughputs[idx]),
                quality_score=_percentile_rank(quality_scores, quality_scores[idx]),
                activity_score=_percentile_rank(
                    activity_minutes_list, activity_minutes_list[idx]
                ),
                sparkline_7d=daily_buckets.get(u.id, [0] * 7),
                rejected_rate=rejected_rate,
                alerts=alerts,
            )
        )

    # 排序
    if sort == "quality":
        items.sort(key=lambda it: it.quality_score, reverse=True)
    elif sort == "activity":
        items.sort(key=lambda it: it.activity_score, reverse=True)
    elif sort == "weekly_compare":
        items.sort(key=lambda it: it.weekly_compare_pct or -999, reverse=True)
    else:
        items.sort(key=lambda it: it.main_metric, reverse=True)

    # 简易项目过滤：如指定 project，只返回 project_members 包含该项目的用户
    if project:
        try:
            import uuid as _u

            pid = _u.UUID(project)
            allowed = (
                (
                    await db.execute(
                        select(ProjectMember.user_id).where(
                            ProjectMember.project_id == pid
                        )
                    )
                )
                .scalars()
                .all()
            )
            allowed_set = {str(x) for x in allowed}
            items = [it for it in items if it.user_id in allowed_set]
        except (ValueError, TypeError):
            pass

    return AdminPeopleList(items=items, total=len(items), period=period)


@router.get("/admin/people/{user_id}", response_model=AdminPersonDetail)
async def admin_person_detail(
    user_id: str,
    period: str = Query("4w"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    """v0.8.4 · 个人详情：4 周趋势、耗时直方图、项目分布、timeline。"""
    import uuid as _u

    try:
        uid = _u.UUID(user_id)
    except (ValueError, TypeError):
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="invalid user_id")

    user = await db.get(User, uid)
    if not user or not user.is_active:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="user not found")

    start, _end = _period_window(period)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # 总产出
    throughput = (
        await db.execute(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.user_id == uid,
                Annotation.is_active.is_(True),
                Annotation.created_at >= start,
            )
        )
    ).scalar() or 0

    # 4 周趋势（每周一点）
    trend_throughput: list[int] = []
    trend_quality: list[int] = []
    for w in range(3, -1, -1):
        ws = today_start - timedelta(days=today_start.weekday()) - timedelta(weeks=w)
        we = ws + timedelta(weeks=1)
        n = (
            await db.execute(
                select(func.count())
                .select_from(Annotation)
                .where(
                    Annotation.user_id == uid,
                    Annotation.is_active.is_(True),
                    Annotation.created_at >= ws,
                    Annotation.created_at < we,
                )
            )
        ).scalar() or 0
        trend_throughput.append(int(n))
        # 质量：1 - 当周 reopen 率
        reopen_row = (
            await db.execute(
                select(
                    func.count().label("sn"),
                    func.count().filter(Task.reopened_count > 0).label("rn"),
                ).where(
                    Task.assignee_id == uid,
                    Task.submitted_at.isnot(None),
                    Task.submitted_at >= ws,
                    Task.submitted_at < we,
                )
            )
        ).first()
        sn = int(reopen_row.sn or 0) if reopen_row else 0
        rn = int(reopen_row.rn or 0) if reopen_row else 0
        q = 100 if sn == 0 else max(0, 100 - int(rn / sn * 100))
        trend_quality.append(q)

    # 项目分布
    proj_rows = (
        await db.execute(
            select(
                Annotation.project_id,
                Project.name,
                func.count().label("n"),
            )
            .join(Project, Annotation.project_id == Project.id)
            .where(
                Annotation.user_id == uid,
                Annotation.is_active.is_(True),
                Annotation.created_at >= start,
            )
            .group_by(Annotation.project_id, Project.name)
            .order_by(func.count().desc())
        )
    ).all()
    project_distribution = [
        {"project_id": str(r.project_id), "project_name": r.name, "count": int(r.n)}
        for r in proj_rows
    ]

    # 耗时直方图：从 task_events 拉本人的 annotate kind
    from app.db.models.task_event import TaskEvent

    duration_rows = (
        (
            await db.execute(
                select(TaskEvent.duration_ms).where(
                    TaskEvent.user_id == uid,
                    TaskEvent.kind == "annotate",
                    TaskEvent.started_at >= start,
                )
            )
        )
        .scalars()
        .all()
    )
    durations = [int(d) for d in duration_rows if d is not None]
    duration_histogram: list[dict] = []
    p50: int | None = None
    p95: int | None = None
    if durations:
        durations_sorted = sorted(durations)
        peak = durations_sorted[-1]
        # 10 桶 [0..peak]
        if peak > 0:
            step = max(1, peak // 10)
            buckets = [0] * 10
            for d in durations:
                idx = min(9, d // step)
                buckets[idx] += 1
            for i, c in enumerate(buckets):
                duration_histogram.append(
                    {"upper_ms": int((i + 1) * step), "count": int(c)}
                )
        p50 = int(durations_sorted[len(durations_sorted) // 2])
        p95_idx = max(0, int(len(durations_sorted) * 0.95) - 1)
        p95 = int(durations_sorted[p95_idx])

    # timeline：最近 50 条 audit_logs
    timeline_rows = (
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.actor_id == uid)
                .where(
                    AuditLog.action.in_(
                        [
                            "task.submit",
                            "task.approve",
                            "task.reject",
                            "task.reopen",
                            "task.create_annotation",
                        ]
                    )
                )
                .order_by(AuditLog.created_at.desc())
                .limit(50)
            )
        )
        .scalars()
        .all()
    )
    timeline = []
    for a in timeline_rows:
        target_id = (
            a.target_id
            if a.target_id and a.target_type == "task"
            else (a.detail_json or {}).get("task_id")
        )
        timeline.append(
            {
                "at": a.created_at.isoformat() if a.created_at else "",
                "action": a.action,
                "task_id": str(target_id) if target_id else None,
                "task_display_id": (a.detail_json or {}).get("task_display_id"),
                "detail": (a.detail_json or {}).get("reason"),
            }
        )

    # 综合分（throughput + quality / 2，活跃暂用 50）
    quality_score = trend_quality[-1] if trend_quality else 50
    composite = int(round((min(100, throughput) + quality_score + 50) / 3))

    proj_count = (
        await db.execute(
            select(func.count())
            .select_from(ProjectMember)
            .where(ProjectMember.user_id == uid)
        )
    ).scalar() or 0

    # 周环比
    last_week_start = (
        today_start - timedelta(days=today_start.weekday()) - timedelta(weeks=1)
    )
    week_start_dt = last_week_start + timedelta(weeks=1)
    last_n = (
        await db.execute(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.user_id == uid,
                Annotation.is_active.is_(True),
                Annotation.created_at >= last_week_start,
                Annotation.created_at < week_start_dt,
            )
        )
    ).scalar() or 0
    this_n = (
        await db.execute(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.user_id == uid,
                Annotation.is_active.is_(True),
                Annotation.created_at >= week_start_dt,
            )
        )
    ).scalar() or 0
    if last_n > 0:
        wcp = round((this_n - last_n) / last_n * 100, 1)
    elif this_n > 0:
        wcp = 100.0
    else:
        wcp = None

    return AdminPersonDetail(
        user_id=str(user.id),
        name=user.name,
        email=user.email,
        role=user.role,
        project_count=int(proj_count),
        throughput=int(throughput),
        quality_score=int(quality_score),
        active_minutes=None,
        composite_score=int(composite),
        weekly_compare_pct=wcp,
        trend_throughput=trend_throughput,
        trend_quality=trend_quality,
        project_distribution=project_distribution,
        duration_histogram=duration_histogram,
        p50_duration_ms=p50,
        p95_duration_ms=p95,
        timeline=timeline,
    )


# ── v0.8.6 F4 · 预测成本卡片 ─────────────────────────────────────────


_RANGE_DAYS = {"7d": 7, "30d": 30}


@router.get("/admin/prediction-cost-stats", response_model=PredictionCostStats)
async def prediction_cost_stats(
    range: str = Query("30d", pattern="^(7d|30d)$"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    """v0.8.6 F4 · 过去 N 天预测调用数 / 平均耗时 / 失败率 / 总成本。

    数据来源：predictions × prediction_metas × failed_predictions × ml_backends。
    异常时降级返回零，避免 Dashboard 因聚合失败黑屏。
    """
    days = _RANGE_DAYS.get(range, 30)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    try:
        # 主聚合：调用数 / avg / p50 / p95 / p99 / total_cost / total_tokens
        # v0.8.7 F2 · 加 PERCENTILE_CONT(p50/p95/p99) WITHIN GROUP；postgres 原生支持。
        main = (
            await db.execute(
                select(
                    func.count(Prediction.id).label("total"),
                    func.avg(PredictionMeta.inference_time_ms).label("avg_ms"),
                    func.percentile_cont(0.5)
                    .within_group(PredictionMeta.inference_time_ms.asc())
                    .label("p50_ms"),
                    func.percentile_cont(0.95)
                    .within_group(PredictionMeta.inference_time_ms.asc())
                    .label("p95_ms"),
                    func.percentile_cont(0.99)
                    .within_group(PredictionMeta.inference_time_ms.asc())
                    .label("p99_ms"),
                    func.coalesce(func.sum(PredictionMeta.total_cost), 0.0).label(
                        "total_cost"
                    ),
                    func.coalesce(func.sum(PredictionMeta.total_tokens), 0).label(
                        "total_tokens"
                    ),
                )
                .select_from(Prediction)
                .outerjoin(
                    PredictionMeta, PredictionMeta.prediction_id == Prediction.id
                )
                .where(Prediction.created_at >= cutoff)
            )
        ).one()

        # 失败数
        failed_count = (
            await db.execute(
                select(func.count(FailedPrediction.id)).where(
                    FailedPrediction.created_at >= cutoff
                )
            )
        ).scalar() or 0

        # by_backend
        rows = (
            await db.execute(
                select(
                    Prediction.ml_backend_id,
                    MLBackend.name,
                    func.count(Prediction.id),
                    func.coalesce(func.sum(PredictionMeta.total_cost), 0.0),
                    func.avg(PredictionMeta.inference_time_ms),
                )
                .select_from(Prediction)
                .outerjoin(
                    PredictionMeta, PredictionMeta.prediction_id == Prediction.id
                )
                .outerjoin(MLBackend, MLBackend.id == Prediction.ml_backend_id)
                .where(Prediction.created_at >= cutoff)
                .group_by(Prediction.ml_backend_id, MLBackend.name)
            )
        ).all()

        # 失败按 backend
        failed_by_backend_rows = (
            await db.execute(
                select(FailedPrediction.ml_backend_id, func.count(FailedPrediction.id))
                .where(FailedPrediction.created_at >= cutoff)
                .group_by(FailedPrediction.ml_backend_id)
            )
        ).all()
        failed_by_backend = {bid: int(c) for bid, c in failed_by_backend_rows}

        by_backend = [
            BackendCostBreakdown(
                backend_id=bid,
                backend_name=name,
                predictions=int(cnt),
                failures=failed_by_backend.get(bid, 0),
                total_cost=float(cost or 0.0),
                avg_inference_time_ms=(float(avg_ms) if avg_ms is not None else None),
            )
            for bid, name, cnt, cost, avg_ms in rows
        ]

        total = int(main.total or 0)
        denom = total + failed_count
        failure_rate = (failed_count / denom) if denom else 0.0

        return PredictionCostStats(
            range=range,
            total_predictions=total,
            failed_predictions=failed_count,
            failure_rate=round(failure_rate, 4),
            avg_inference_time_ms=(
                float(main.avg_ms) if main.avg_ms is not None else None
            ),
            p50_inference_time_ms=(
                float(main.p50_ms) if main.p50_ms is not None else None
            ),
            p95_inference_time_ms=(
                float(main.p95_ms) if main.p95_ms is not None else None
            ),
            p99_inference_time_ms=(
                float(main.p99_ms) if main.p99_ms is not None else None
            ),
            total_cost=float(main.total_cost or 0.0),
            total_tokens=int(main.total_tokens or 0),
            by_backend=by_backend,
        )
    except Exception:
        # 数据量异常或 schema 漂移时降级，避免 Dashboard 黑屏
        return PredictionCostStats(range=range)
