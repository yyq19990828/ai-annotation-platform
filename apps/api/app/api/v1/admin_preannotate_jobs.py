"""v0.9.8 · /admin/preannotate-jobs — 完整 prediction job 历史.

与 /admin/preannotate-queue 区分:
- /preannotate-queue: 当前 pre_annotated 批次快照 (v0.9.6 既有, 不动)
- /preannotate-jobs:  prediction_jobs 全量历史 (含已结束 / 重置 / 失败 job)

支持过滤: project_id / status / from / to / search (prompt ILIKE 子串).
Cursor 分页: 复合 (started_at DESC, id DESC), base64-json 编码.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.prediction_job import PredictionJob
from app.db.models.project import Project
from app.db.models.user import User
from app.deps import get_db, require_roles

router = APIRouter()


class PredictionJobOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    project_name: str | None = None
    project_display_id: str | None = None
    batch_id: uuid.UUID | None = None
    ml_backend_id: uuid.UUID
    prompt: str
    output_mode: str
    status: str
    total_tasks: int
    success_count: int
    failed_count: int
    started_at: datetime
    completed_at: datetime | None = None
    duration_ms: int | None = None
    total_cost: float | None = None
    error_message: str | None = None


class PredictionJobsResponse(BaseModel):
    items: list[PredictionJobOut]
    next_cursor: str | None = None


def _encode_cursor(started_at: datetime, job_id: uuid.UUID) -> str:
    payload = {"s": started_at.isoformat(), "i": str(job_id)}
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        return datetime.fromisoformat(payload["s"]), uuid.UUID(payload["i"])
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"invalid cursor: {exc}")


@router.get("/admin/preannotate-jobs", response_model=PredictionJobsResponse)
async def list_preannotate_jobs(
    project_id: uuid.UUID | None = Query(default=None),
    status: Literal["running", "completed", "failed"] | None = Query(default=None),
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_roles(UserRole.PROJECT_ADMIN, UserRole.SUPER_ADMIN)),
) -> PredictionJobsResponse:
    """列 prediction_jobs 时间线, started_at DESC + cursor 分页."""

    stmt = select(PredictionJob).order_by(
        PredictionJob.started_at.desc(), PredictionJob.id.desc()
    )

    conds = []
    if project_id is not None:
        conds.append(PredictionJob.project_id == project_id)
    if status is not None:
        conds.append(PredictionJob.status == status)
    if from_ is not None:
        conds.append(PredictionJob.started_at >= from_)
    if to is not None:
        conds.append(PredictionJob.started_at <= to)
    if search:
        conds.append(PredictionJob.prompt.ilike(f"%{search}%"))

    if cursor:
        cursor_started, cursor_id = _decode_cursor(cursor)
        # (started_at, id) < (cursor_started, cursor_id) 在 DESC 排序里
        conds.append(
            or_(
                PredictionJob.started_at < cursor_started,
                and_(
                    PredictionJob.started_at == cursor_started,
                    PredictionJob.id < cursor_id,
                ),
            )
        )

    if conds:
        stmt = stmt.where(and_(*conds))

    # 多取 1 条判断是否还有下一页
    stmt = stmt.limit(limit + 1)

    res = await db.execute(stmt)
    rows = list(res.scalars().all())

    has_more = len(rows) > limit
    rows = rows[:limit]

    if not rows:
        return PredictionJobsResponse(items=[], next_cursor=None)

    project_ids = list({r.project_id for r in rows})
    pres = await db.execute(select(Project).where(Project.id.in_(project_ids)))
    projects_by_id = {p.id: p for p in pres.scalars().all()}

    items: list[PredictionJobOut] = []
    for r in rows:
        proj = projects_by_id.get(r.project_id)
        items.append(
            PredictionJobOut(
                id=r.id,
                project_id=r.project_id,
                project_name=proj.name if proj else None,
                project_display_id=getattr(proj, "display_id", None) if proj else None,
                batch_id=r.batch_id,
                ml_backend_id=r.ml_backend_id,
                prompt=r.prompt,
                output_mode=r.output_mode,
                status=r.status,
                total_tasks=r.total_tasks,
                success_count=r.success_count,
                failed_count=r.failed_count,
                started_at=r.started_at,
                completed_at=r.completed_at,
                duration_ms=r.duration_ms,
                total_cost=float(r.total_cost) if r.total_cost is not None else None,
                error_message=r.error_message,
            )
        )

    next_cursor = _encode_cursor(rows[-1].started_at, rows[-1].id) if has_more else None

    return PredictionJobsResponse(items=items, next_cursor=next_cursor)
