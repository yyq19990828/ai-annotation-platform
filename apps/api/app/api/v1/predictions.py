"""v0.8.6 F6 · 失败预测管理与重试。

仅 super_admin / project_admin 可访问。

端点：
- ``GET /admin/failed-predictions?page&page_size`` 列表（分页）
- ``POST /admin/failed-predictions/{id}/retry`` 异步重试，返回 202 Accepted；
  WebSocket 推 ``failed_prediction.retry.{started,succeeded,failed}`` 进度事件。

软上限 max=3 由本路由层判断（HTTP 409）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_roles
from app.db.enums import UserRole
from app.db.models.ml_backend import MLBackend
from app.db.models.prediction import FailedPrediction
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User


router = APIRouter()

MAX_RETRY_COUNT = 3
_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


class FailedPredictionItem(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID | None
    task_display_id: str | None = None
    project_id: uuid.UUID
    project_name: str | None = None
    ml_backend_id: uuid.UUID | None
    backend_name: str | None = None
    model_version: str | None
    error_type: str
    message: str
    retry_count: int
    last_retry_at: datetime | None
    created_at: datetime


class FailedPredictionList(BaseModel):
    items: list[FailedPredictionItem]
    total: int
    page: int
    page_size: int


class RetryResponse(BaseModel):
    status: str
    failed_id: uuid.UUID


@router.get("/admin/failed-predictions", response_model=FailedPredictionList)
async def list_failed_predictions(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_MANAGERS)),
):
    total = (
        await db.execute(select(func.count()).select_from(FailedPrediction))
    ).scalar() or 0

    rows = (
        await db.execute(
            select(FailedPrediction, Task, Project, MLBackend)
            .outerjoin(Task, Task.id == FailedPrediction.task_id)
            .outerjoin(Project, Project.id == FailedPrediction.project_id)
            .outerjoin(MLBackend, MLBackend.id == FailedPrediction.ml_backend_id)
            .order_by(desc(FailedPrediction.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()

    items: list[FailedPredictionItem] = []
    for fp, t, p, b in rows:
        items.append(
            FailedPredictionItem(
                id=fp.id,
                task_id=fp.task_id,
                task_display_id=t.display_id if t else None,
                project_id=fp.project_id,
                project_name=p.name if p else None,
                ml_backend_id=fp.ml_backend_id,
                backend_name=b.name if b else None,
                model_version=fp.model_version,
                error_type=fp.error_type,
                message=fp.message,
                retry_count=fp.retry_count or 0,
                last_retry_at=fp.last_retry_at,
                created_at=fp.created_at,
            )
        )
    return FailedPredictionList(
        items=items, total=int(total), page=page, page_size=page_size
    )


@router.post(
    "/admin/failed-predictions/{failed_id}/retry",
    status_code=202,
    response_model=RetryResponse,
)
async def retry_failed_prediction(
    failed_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
) -> Any:
    fp = await db.get(FailedPrediction, failed_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Failed prediction not found")
    if (fp.retry_count or 0) >= MAX_RETRY_COUNT:
        raise HTTPException(
            status_code=409,
            detail=f"Max retries ({MAX_RETRY_COUNT}) exceeded",
        )

    # 投递 Celery task，前端通过 ws 推送获得进度
    from app.workers.predictions_retry import retry_failed_prediction as task_fn

    task_fn.delay(str(failed_id), str(current_user.id))
    return RetryResponse(status="queued", failed_id=failed_id)
