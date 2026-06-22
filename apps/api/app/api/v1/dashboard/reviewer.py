from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from app.deps import (
    get_db,
    require_roles,
)
from app.db.models.user import User
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.dataset import DatasetItem
from app.db.models.audit_log import AuditLog
from app.db.models.task_batch import TaskBatch
from app.services.storage import storage_service
from app.db.enums import UserRole, TaskStatus
from app.schemas.dashboard import (
    ReviewerDashboardStats,
    ReviewTaskItem,
    ReviewingBatchItem,
    RecentReviewItem,
    ReviewerMiniStats,
)
from app.services.user_brief import resolve_briefs_with_project_role

router = APIRouter()


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

    # 批次封面缩略图：每个 batch 取最早一张「有缩略图」的任务作封面（DISTINCT ON）。
    # 缩略图口径与 tasks/_shared.py 一致：dataset 导入的任务缩略图存在 DatasetItem 上，
    # Task.thumbnail_path 为空，故需 LEFT JOIN + COALESCE。
    cover_map: dict = {}
    cover_batch_ids = [b.id for b, _ in batch_rows]
    if cover_batch_ids:
        eff_thumb = func.coalesce(DatasetItem.thumbnail_path, Task.thumbnail_path)
        eff_blur = func.coalesce(DatasetItem.blurhash, Task.blurhash)
        cover_rows = await db.execute(
            select(Task.batch_id, eff_thumb, eff_blur)
            .outerjoin(DatasetItem, DatasetItem.id == Task.dataset_item_id)
            .where(
                Task.batch_id.in_(cover_batch_ids),
                eff_thumb.is_not(None),
            )
            .order_by(Task.batch_id, Task.created_at.asc())
            .distinct(Task.batch_id)
        )
        cover_map = {row[0]: (row[1], row[2]) for row in cover_rows.all()}

    reviewing_batches = []
    for b, pname in batch_rows:
        per_proj = briefs_by_project.get(b.project_id, {})
        annotator = per_proj.get(str(b.annotator_id)) if b.annotator_id else None
        cover_path, cover_blurhash = cover_map.get(b.id, (None, None))
        thumbnail_url: str | None = None
        if cover_path:
            thumb_bucket = storage_service.bucket_for_cache_key(
                cover_path, default=storage_service.bucket
            )
            try:
                thumbnail_url = storage_service.generate_download_url(
                    cover_path, bucket=thumb_bucket
                )
            except Exception:
                thumbnail_url = None
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
                thumbnail_url=thumbnail_url,
                cover_blurhash=cover_blurhash,
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
