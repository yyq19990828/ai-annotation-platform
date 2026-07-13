from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks import _assert_task_visible
from app.db.enums import UserRole
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.db.models.video_tracker_job import (
    VideoTrackerJob,
    VideoTrackerJobStatus,
)
from app.deps import get_current_user, get_db, require_roles
from app.schemas.video_tracker_job import TrackerJobStatus, VideoTrackerJobOut
from app.services.audit import AuditAction, AuditService
from app.services.scheduler import is_privileged_for_project
from app.services.raster_mask_storage import load_coco_rle
from app.services.video_tracker_job_service import (
    accept_tracker_job,
    cancel_tracker_job,
    discard_tracker_job,
    get_tracker_job,
    tracker_job_out,
)

router = APIRouter()


class VideoTrackerJobListItem(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    project_id: uuid.UUID
    project_name: str | None = None
    project_display_id: str | None = None
    dataset_item_id: uuid.UUID
    annotation_id: uuid.UUID | None = None
    segment_id: uuid.UUID | None = None
    created_by: uuid.UUID | None = None
    status: TrackerJobStatus
    model_key: str
    direction: str
    from_frame: int
    to_frame: int
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


class VideoTrackerJobCounts(BaseModel):
    queued: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0
    cancelled: int = 0
    # v0.21.28 · 候选/接受流状态计数。
    pending_review: int = 0
    accepted: int = 0
    discarded: int = 0


class VideoTrackerJobsResponse(BaseModel):
    items: list[VideoTrackerJobListItem]
    next_cursor: str | None = None
    counts: VideoTrackerJobCounts


class VideoTrackerPreviewResult(BaseModel):
    """候选预览的逐帧结果。形状与 video_tracker_runner._serialize_results 一致
    (TrackerFrameResult → dict)。必需/默认刻意对齐 _deserialize_results 的容错读取
    (frame_index 必需, 其余可缺省), 避免 typed 响应对部分 staged 行过严而 500。"""

    frame_index: int
    geometry: dict | None = None
    confidence: float | None = None
    outside: bool = False
    instance_id: str | None = None
    primary: bool = False


class VideoTrackerJobPreview(BaseModel):
    """v0.21.28 · 候选预览: job 暂存的逐帧结果, 供前端在接受前渲染候选叠加。"""

    job_id: uuid.UUID
    status: TrackerJobStatus
    annotation_id: uuid.UUID | None = None
    results: list[VideoTrackerPreviewResult] = []
    grid_step: int = 1
    output_geometry: str = "bbox"


def _encode_cursor(created_at: datetime, job_id: uuid.UUID) -> str:
    payload = {"c": created_at.isoformat(), "i": str(job_id)}
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        return datetime.fromisoformat(payload["c"]), uuid.UUID(payload["i"])
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"invalid cursor: {exc}")


_ANNOTATORS = (
    UserRole.SUPER_ADMIN,
    UserRole.PROJECT_ADMIN,
    UserRole.REVIEWER,
    UserRole.ANNOTATOR,
)


async def _load_visible_job_task(
    db: AsyncSession, job_id: uuid.UUID, user: User
) -> tuple[Task, VideoTrackerJobOut]:
    row = await get_tracker_job(db, job_id)
    task = await db.get(Task, row.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    await _assert_task_visible(db, task, user)
    return task, tracker_job_out(row)


async def _assert_can_cancel(
    db: AsyncSession,
    task: Task,
    body: VideoTrackerJobOut,
    user: User,
) -> None:
    project = await db.get(Project, task.project_id)
    if body.created_by == user.id or (
        project and is_privileged_for_project(user, project)
    ):
        return
    raise HTTPException(
        status_code=403, detail="Video tracker job belongs to another user"
    )


@router.get("", response_model=VideoTrackerJobsResponse)
async def list_video_tracker_jobs(
    project_id: uuid.UUID | None = Query(default=None),
    status: VideoTrackerJobStatus | None = Query(default=None),
    model_key: str | None = Query(default=None, max_length=80),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(
        require_roles(UserRole.PROJECT_ADMIN, UserRole.SUPER_ADMIN)
    ),
) -> VideoTrackerJobsResponse:
    """列 video_tracker_jobs 时间线 (created_at DESC + cursor 分页) + 按 status 聚合计数.

    project_id 过滤需 join Task (VideoTrackerJob 无 project_id 列)。
    counts 在当前 project_id/model_key 过滤下 (忽略 status/cursor) 分组统计。
    """

    # 当前过滤条件 (project/model_key), 不含 status/cursor — counts 与列表共用.
    base_conds = []
    if model_key is not None:
        base_conds.append(VideoTrackerJob.model_key == model_key)
    needs_task_join = project_id is not None
    if project_id is not None:
        base_conds.append(Task.project_id == project_id)
    if current_admin.role == UserRole.PROJECT_ADMIN:
        # 项目管理员的全局列表与计数只能覆盖自己拥有的项目；显式传入他人项目 id
        # 也只会得到空交集，不能借列表或 counts 枚举跨项目任务。
        base_conds.append(
            Task.project_id.in_(
                select(Project.id).where(Project.owner_id == current_admin.id)
            )
        )
        needs_task_join = True

    # 聚合计数: select status, count(*) group by status (带 project/model_key 过滤).
    counts_stmt = select(VideoTrackerJob.status, func.count()).group_by(
        VideoTrackerJob.status
    )
    if needs_task_join:
        counts_stmt = counts_stmt.join(Task, VideoTrackerJob.task_id == Task.id)
    if base_conds:
        counts_stmt = counts_stmt.where(and_(*base_conds))
    cres = await db.execute(counts_stmt)
    counts = VideoTrackerJobCounts()
    for st, cnt in cres.all():
        if hasattr(counts, st):
            setattr(counts, st, cnt)

    # 列表查询: base 过滤 + status + cursor 复合分页.
    list_conds = list(base_conds)
    if status is not None:
        list_conds.append(VideoTrackerJob.status == status.value)
    if cursor:
        cursor_created, cursor_id = _decode_cursor(cursor)
        list_conds.append(
            or_(
                VideoTrackerJob.created_at < cursor_created,
                and_(
                    VideoTrackerJob.created_at == cursor_created,
                    VideoTrackerJob.id < cursor_id,
                ),
            )
        )

    stmt = select(VideoTrackerJob, Task.project_id).join(
        Task, VideoTrackerJob.task_id == Task.id
    )
    if list_conds:
        stmt = stmt.where(and_(*list_conds))
    stmt = stmt.order_by(
        VideoTrackerJob.created_at.desc(), VideoTrackerJob.id.desc()
    ).limit(limit + 1)

    res = await db.execute(stmt)
    rows = res.all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    if not rows:
        return VideoTrackerJobsResponse(items=[], next_cursor=None, counts=counts)

    project_ids = list({pid for _, pid in rows})
    pres = await db.execute(select(Project).where(Project.id.in_(project_ids)))
    projects_by_id = {p.id: p for p in pres.scalars().all()}

    items: list[VideoTrackerJobListItem] = []
    for job, pid in rows:
        proj = projects_by_id.get(pid)
        items.append(
            VideoTrackerJobListItem(
                id=job.id,
                task_id=job.task_id,
                project_id=pid,
                project_name=proj.name if proj else None,
                project_display_id=getattr(proj, "display_id", None) if proj else None,
                dataset_item_id=job.dataset_item_id,
                annotation_id=job.annotation_id,
                segment_id=job.segment_id,
                created_by=job.created_by,
                status=job.status,
                model_key=job.model_key,
                direction=job.direction,
                from_frame=job.from_frame,
                to_frame=job.to_frame,
                error_message=job.error_message,
                started_at=job.started_at,
                completed_at=job.completed_at,
                created_at=job.created_at,
            )
        )

    last_job = rows[-1][0]
    next_cursor = _encode_cursor(last_job.created_at, last_job.id) if has_more else None

    return VideoTrackerJobsResponse(items=items, next_cursor=next_cursor, counts=counts)


@router.get("/{job_id}", response_model=VideoTrackerJobOut)
async def get_video_tracker_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, body = await _load_visible_job_task(db, job_id, current_user)
    return body


@router.delete("/{job_id}", response_model=VideoTrackerJobOut)
async def cancel_video_tracker_job(
    job_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task, body = await _load_visible_job_task(db, job_id, current_user)
    await _assert_can_cancel(db, task, body, current_user)
    body = await cancel_tracker_job(db, job_id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_TRACKER_JOB_CANCEL,
        target_type="video_tracker_job",
        target_id=job_id,
        request=request,
        status_code=200,
        detail={"task_id": str(task.id), "status": body.status},
    )
    await db.commit()
    return body


@router.post("/{job_id}/accept", response_model=VideoTrackerJobOut)
async def accept_video_tracker_job(
    job_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.21.28 · 接受候选: 把 job 暂存结果落库 (主实例回填源轨迹 + 新轨迹建), status=ACCEPTED。"""
    task, body = await _load_visible_job_task(db, job_id, current_user)
    await _assert_can_cancel(db, task, body, current_user)
    body = await accept_tracker_job(db, job_id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_TRACKER_JOB_ACCEPT,
        target_type="video_tracker_job",
        target_id=job_id,
        request=request,
        status_code=200,
        detail={"task_id": str(task.id), "status": body.status},
    )
    await db.commit()
    return body


@router.post("/{job_id}/discard", response_model=VideoTrackerJobOut)
async def discard_video_tracker_job(
    job_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.21.28 · 丢弃候选: status=DISCARDED, 清 staged_result, annotation 零改动。"""
    task, body = await _load_visible_job_task(db, job_id, current_user)
    await _assert_can_cancel(db, task, body, current_user)
    body = await discard_tracker_job(db, job_id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_TRACKER_JOB_DISCARD,
        target_type="video_tracker_job",
        target_id=job_id,
        request=request,
        status_code=200,
        detail={"task_id": str(task.id), "status": body.status},
    )
    await db.commit()
    return body


@router.get("/{job_id}/preview", response_model=VideoTrackerJobPreview)
async def get_video_tracker_job_preview(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.21.28 · 候选预览: 返回 job 暂存的逐帧结果 (接受前渲染候选叠加用)。无 staged → 空。"""
    row = await get_tracker_job(db, job_id)
    task = await db.get(Task, row.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    await _assert_task_visible(db, task, current_user)
    staged = row.staged_result or {}
    return VideoTrackerJobPreview(
        job_id=row.id,
        status=row.status,
        annotation_id=row.annotation_id,
        results=staged.get("results") or [],
        grid_step=int(staged.get("grid_step", 1)),
        output_geometry=staged.get("output_geometry", "bbox"),
    )


@router.get("/{job_id}/mask-content/{sha256}")
async def get_video_tracker_mask_content(
    job_id: uuid.UUID,
    sha256: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    row = await get_tracker_job(db, job_id)
    task = await db.get(Task, row.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    await _assert_task_visible(db, task, current_user)
    reference = next(
        (
            (result.get("geometry") or {}).get("mask")
            for result in ((row.staged_result or {}).get("results") or [])
            if ((result.get("geometry") or {}).get("mask") or {}).get("sha256")
            == sha256
        ),
        None,
    )
    if reference is None:
        raise HTTPException(status_code=404, detail="mask candidate not found")
    try:
        payload = load_coco_rle(reference)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=f"mask object is invalid: {exc}") from exc
    return JSONResponse(
        payload,
        headers={"Cache-Control": "private, max-age=300", "ETag": f'"{sha256}"'},
    )
