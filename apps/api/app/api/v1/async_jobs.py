"""v0.10.16 · 统一异步任务表 API（ROADMAP §1.7）。

GET /async-jobs        列表（仅 owner 可见，super_admin 可见全部）
GET /async-jobs/{id}   详情
POST /async-jobs/{id}/cancel  软取消（MVP 仅 predictions_import / audit_archive）
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.async_job import AsyncJob, AsyncJobStatus
from app.db.models.project import Project
from app.db.models.user import User
from app.deps import get_current_user, get_db
from app.schemas.async_job import AsyncJobListResponse, AsyncJobOut

router = APIRouter()

# MVP 范围：仅这两类支持取消（kind 集合见 §1.7 计划）
CANCELLABLE_KINDS = {"predictions_import", "audit_archive"}

AsyncJobStatusParam = Literal["pending", "running", "completed", "failed", "cancelled"]


async def _to_async_job_out(
    db: AsyncSession,
    job: AsyncJob,
    project_cache: dict[uuid.UUID, Project | None] | None = None,
) -> AsyncJobOut:
    project: Project | None = None
    if job.project_id is not None:
        if project_cache is None:
            project = await db.get(Project, job.project_id)
        else:
            if job.project_id not in project_cache:
                project_cache[job.project_id] = await db.get(Project, job.project_id)
            project = project_cache[job.project_id]

    payload_project_display_id = None
    if isinstance(job.payload, dict):
        raw_display_id = job.payload.get("project_display_id")
        if isinstance(raw_display_id, str):
            payload_project_display_id = raw_display_id

    return AsyncJobOut.model_validate(job).model_copy(
        update={
            "project_display_id": (
                project.display_id if project else payload_project_display_id
            ),
            "project_name": project.name if project else None,
        }
    )


@router.get("/async-jobs", response_model=AsyncJobListResponse)
async def list_async_jobs(
    status: list[AsyncJobStatusParam] | None = Query(default=None),
    kind: str | None = Query(None),
    project_id: uuid.UUID | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AsyncJobListResponse:
    """v0.10.16 · 当前用户可见 async_jobs 列表（super_admin 可见全部）。

    顺序：created_at DESC。前端铃铛走 polling，默认拉最近 50 行。
    """
    stmt = select(AsyncJob)
    count_stmt = select(func.count()).select_from(AsyncJob)

    if current_user.role != UserRole.SUPER_ADMIN.value:
        stmt = stmt.where(AsyncJob.user_id == current_user.id)
        count_stmt = count_stmt.where(AsyncJob.user_id == current_user.id)

    if status:
        stmt = stmt.where(AsyncJob.status.in_(status))
        count_stmt = count_stmt.where(AsyncJob.status.in_(status))
    if kind:
        stmt = stmt.where(AsyncJob.kind == kind)
        count_stmt = count_stmt.where(AsyncJob.kind == kind)
    if project_id:
        stmt = stmt.where(AsyncJob.project_id == project_id)
        count_stmt = count_stmt.where(AsyncJob.project_id == project_id)
    search_text = search.strip() if search else ""
    if search_text:
        pattern = f"%{search_text}%"
        search_filter = or_(
            AsyncJob.payload["prompt"].astext.ilike(pattern),
            AsyncJob.payload["batch_display_id"].astext.ilike(pattern),
            AsyncJob.payload["model_key"].astext.ilike(pattern),
        )
        stmt = stmt.where(search_filter)
        count_stmt = count_stmt.where(search_filter)

    stmt = stmt.order_by(AsyncJob.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    total = (await db.execute(count_stmt)).scalar_one()
    project_cache: dict[uuid.UUID, Project | None] = {}

    return AsyncJobListResponse(
        items=[await _to_async_job_out(db, r, project_cache) for r in rows],
        total=total,
    )


@router.get("/async-jobs/{job_id}", response_model=AsyncJobOut)
async def get_async_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AsyncJobOut:
    job = await db.get(AsyncJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="async_job not found")
    if (
        current_user.role != UserRole.SUPER_ADMIN.value
        and job.user_id != current_user.id
    ):
        raise HTTPException(status_code=403, detail="not your job")
    return await _to_async_job_out(db, job)


@router.post("/async-jobs/{job_id}/cancel")
async def cancel_async_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.10.16 · 软取消。MVP 仅支持 predictions_import / audit_archive。

    batch_predict / video_tracker 走 domain 真值表（PredictionJob / VideoTrackerJob）
    自己的取消机制；本端点不动 Celery revoke。
    """
    job = await db.get(AsyncJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="async_job not found")
    if (
        current_user.role != UserRole.SUPER_ADMIN.value
        and job.user_id != current_user.id
    ):
        raise HTTPException(status_code=403, detail="not your job")
    if job.kind not in CANCELLABLE_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"kind={job.kind} not cancellable in v0.10.16 MVP",
        )
    if job.status not in {AsyncJobStatus.PENDING.value, AsyncJobStatus.RUNNING.value}:
        raise HTTPException(
            status_code=409,
            detail=f"cannot cancel terminal job (status={job.status})",
        )

    from app.services import async_job as async_job_svc

    await async_job_svc.mark_cancelled(db, job.id)
    await db.commit()
    return {"status": "cancelled", "id": str(job_id)}
