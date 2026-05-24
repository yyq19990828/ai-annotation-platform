"""v0.10.16 · 统一异步任务表 API（ROADMAP §1.7）。

GET /async-jobs        列表（仅 owner 可见，super_admin 可见全部）
GET /async-jobs/{id}   详情
POST /async-jobs/{id}/cancel  软取消
"""

from __future__ import annotations

import logging
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
from app.schemas.async_job import (
    AsyncJobListResponse,
    AsyncJobOut,
    AsyncJobRetryFailedResponse,
)

router = APIRouter()
log = logging.getLogger(__name__)

# v0.10.51 · batch_predict 支持协作取消；predictions_import / audit_archive 保持软取消。
CANCELLABLE_KINDS = {"batch_predict", "predictions_import", "audit_archive"}
RETRY_FAILED_KINDS = {"batch_predict"}

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
    kind: list[str] | None = Query(default=None),
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
        stmt = stmt.where(AsyncJob.kind.in_(kind))
        count_stmt = count_stmt.where(AsyncJob.kind.in_(kind))
    if project_id:
        stmt = stmt.where(AsyncJob.project_id == project_id)
        count_stmt = count_stmt.where(AsyncJob.project_id == project_id)
    search_text = search.strip() if search else ""
    if search_text:
        pattern = f"%{search_text}%"
        search_filter = or_(
            AsyncJob.payload["prompt"].astext.ilike(pattern),
            AsyncJob.payload["batch_display_id"].astext.ilike(pattern),
            AsyncJob.payload["task_display_id"].astext.ilike(pattern),
            AsyncJob.payload["model_key"].astext.ilike(pattern),
            AsyncJob.payload["ml_backend_name"].astext.ilike(pattern),
            AsyncJob.payload["error_type"].astext.ilike(pattern),
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
    """v0.10.51 · 软取消。

    batch_predict 走协作取消：写 cancel_requested 标记并 revoke(terminate=False)，
    worker 在下一条预测边界落 cancelled 终态；video_tracker 仍走自身取消路径。
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
            detail=f"kind={job.kind} not cancellable",
        )
    if job.status not in {AsyncJobStatus.PENDING.value, AsyncJobStatus.RUNNING.value}:
        raise HTTPException(
            status_code=409,
            detail=f"cannot cancel terminal job (status={job.status})",
        )

    from app.services import async_job as async_job_svc
    from app.services.async_job_notify import notify_job_terminal

    if job.kind == "batch_predict":
        if job.celery_task_id:
            try:
                from app.workers.celery_app import celery_app

                celery_app.control.revoke(job.celery_task_id, terminate=False)
            except Exception:
                log.exception("batch_predict revoke failed job=%s", job.id)

        total_tasks = _payload_int(job.payload or {}, "total_tasks") or 0
        if job.status == AsyncJobStatus.PENDING.value:
            await async_job_svc.mark_cancelled(
                db,
                job.id,
                result={
                    "success_count": 0,
                    "failed_count": 0,
                    "done_count": 0,
                    "skipped_count": total_tasks,
                    "cancelled_at_index": 0,
                },
            )
            await notify_job_terminal(db, job_id=job.id)
            await db.commit()
            return {"status": "cancelled", "id": str(job_id)}

        await async_job_svc.request_cancel(db, job.id)
        await db.commit()
        return {"status": "cancel_requested", "id": str(job_id)}

    await async_job_svc.mark_cancelled(db, job.id)
    await notify_job_terminal(db, job_id=job.id)
    await db.commit()
    return {"status": "cancelled", "id": str(job_id)}


@router.post(
    "/async-jobs/{job_id}/retry-failed",
    status_code=202,
    response_model=AsyncJobRetryFailedResponse,
)
async def retry_failed_async_job_items(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AsyncJobRetryFailedResponse:
    if current_user.role not in {
        UserRole.SUPER_ADMIN.value,
        UserRole.PROJECT_ADMIN.value,
    }:
        raise HTTPException(status_code=403, detail="requires project admin")

    job = await db.get(AsyncJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="async_job not found")
    if (
        current_user.role != UserRole.SUPER_ADMIN.value
        and job.user_id != current_user.id
    ):
        raise HTTPException(status_code=403, detail="not your job")
    if job.kind not in RETRY_FAILED_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"kind={job.kind} does not support failed item retry",
        )

    failed_ids = _payload_uuid_list(job.result or {}, "failed_prediction_ids")
    if not failed_ids:
        raise HTTPException(
            status_code=409,
            detail="no retryable failed prediction ids recorded for this job",
        )

    from app.api.v1.predictions import MAX_RETRY_COUNT
    from app.db.models.prediction import FailedPrediction
    from app.workers.predictions_retry import retry_failed_prediction as task_fn

    rows = (
        (
            await db.execute(
                select(FailedPrediction).where(FailedPrediction.id.in_(failed_ids))
            )
        )
        .scalars()
        .all()
    )
    by_id = {row.id: row for row in rows}
    queued = 0
    skipped = 0
    for failed_id in failed_ids:
        row = by_id.get(failed_id)
        if (
            row is None
            or row.dismissed_at is not None
            or (row.retry_count or 0) >= MAX_RETRY_COUNT
        ):
            skipped += 1
            continue
        task_fn.delay(str(failed_id), str(current_user.id))
        queued += 1

    if queued == 0:
        raise HTTPException(
            status_code=409,
            detail="no retryable failed predictions remain for this job",
        )

    return AsyncJobRetryFailedResponse(
        status="queued",
        job_id=job_id,
        queued=queued,
        skipped=skipped,
    )


def _payload_int(payload: dict, key: str) -> int | None:
    value = payload.get(key)
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _payload_uuid_list(payload: dict, key: str) -> list[uuid.UUID]:
    value = payload.get(key)
    if not isinstance(value, list):
        return []
    out: list[uuid.UUID] = []
    for item in value:
        if not isinstance(item, str):
            continue
        try:
            out.append(uuid.UUID(item))
        except ValueError:
            continue
    return out
