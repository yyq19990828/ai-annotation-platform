"""v0.8.6 F6 · 失败预测管理与重试。

仅 super_admin / project_admin 可访问。

端点：
- ``GET /admin/failed-predictions?page&page_size&include_dismissed`` 列表（分页）
- ``POST /admin/failed-predictions/{id}/retry`` 异步重试，返回 202 Accepted；
  WebSocket 推 ``failed_prediction.retry.{started,succeeded,failed}`` 进度事件。
- ``POST /admin/failed-predictions/{id}/dismiss`` v0.8.8 · 永久放弃（soft-delete）。
- ``POST /admin/failed-predictions/{id}/restore`` v0.8.8 · 误操作恢复。

软上限 max=3 由本路由层判断（HTTP 409）。dismiss 后即使 retry_count < max 也不再
出现在默认列表（前端 toggle "显示已放弃" 才出）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, require_project_owner, require_roles
from app.db.enums import UserRole
from app.db.models.ml_backend import MLBackend
from app.db.models.prediction import FailedPrediction
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.schemas.aap_json import AAPImportResult
from app.services.audit import AuditAction, AuditService


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
    # v0.8.8 · 永久放弃时间戳；非空表示已被 admin dismiss
    dismissed_at: datetime | None = None
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
    include_dismissed: bool = Query(
        False,
        description="v0.8.8 · true 时同时返回已 dismiss 的失败预测；默认隐藏",
    ),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_MANAGERS)),
):
    base_filter = (
        FailedPrediction.dismissed_at.is_(None) if not include_dismissed else None
    )

    count_q = select(func.count()).select_from(FailedPrediction)
    if base_filter is not None:
        count_q = count_q.where(base_filter)
    total = (await db.execute(count_q)).scalar() or 0

    rows_q = (
        select(FailedPrediction, Task, Project, MLBackend)
        .outerjoin(Task, Task.id == FailedPrediction.task_id)
        .outerjoin(Project, Project.id == FailedPrediction.project_id)
        .outerjoin(MLBackend, MLBackend.id == FailedPrediction.ml_backend_id)
        .order_by(desc(FailedPrediction.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if base_filter is not None:
        rows_q = rows_q.where(base_filter)
    rows = (await db.execute(rows_q)).all()

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
                dismissed_at=fp.dismissed_at,
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
    if fp.dismissed_at is not None:
        raise HTTPException(
            status_code=409,
            detail="Failed prediction is dismissed; restore it before retry",
        )
    if (fp.retry_count or 0) >= MAX_RETRY_COUNT:
        raise HTTPException(
            status_code=409,
            detail=f"Max retries ({MAX_RETRY_COUNT}) exceeded",
        )

    # 投递 Celery task，前端通过 ws 推送获得进度
    from app.workers.predictions_retry import retry_failed_prediction as task_fn

    task_fn.delay(str(failed_id), str(current_user.id))
    return RetryResponse(status="queued", failed_id=failed_id)


class DismissResponse(BaseModel):
    status: str
    failed_id: uuid.UUID
    dismissed_at: datetime | None = None


@router.post(
    "/admin/failed-predictions/{failed_id}/dismiss",
    response_model=DismissResponse,
)
async def dismiss_failed_prediction(
    failed_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
) -> Any:
    """v0.8.8 · 永久放弃失败预测（soft-delete）。

    审计：``failed_prediction.dismissed``。重复调用幂等——已 dismiss 的行
    不更新 dismissed_at。
    """
    fp = await db.get(FailedPrediction, failed_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Failed prediction not found")
    if fp.dismissed_at is None:
        fp.dismissed_at = datetime.now(timezone.utc)
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.FAILED_PREDICTION_DISMISSED,
            target_type="failed_prediction",
            target_id=str(failed_id),
            request=request,
            detail={
                "project_id": str(fp.project_id),
                "error_type": fp.error_type,
                "retry_count": fp.retry_count or 0,
            },
        )
        await db.commit()
    return DismissResponse(
        status="dismissed",
        failed_id=failed_id,
        dismissed_at=fp.dismissed_at,
    )


@router.post(
    "/admin/failed-predictions/{failed_id}/restore",
    response_model=DismissResponse,
)
async def restore_failed_prediction(
    failed_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
) -> Any:
    """v0.8.8 · 误操作恢复：清空 ``dismissed_at``，让该行重回默认列表。"""
    fp = await db.get(FailedPrediction, failed_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Failed prediction not found")
    if fp.dismissed_at is not None:
        fp.dismissed_at = None
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.FAILED_PREDICTION_RESTORED,
            target_type="failed_prediction",
            target_id=str(failed_id),
            request=request,
            detail={
                "project_id": str(fp.project_id),
                "error_type": fp.error_type,
            },
        )
        await db.commit()
    return DismissResponse(
        status="restored",
        failed_id=failed_id,
        dismissed_at=None,
    )


# ── v0.10.15 · 外部预测导入 (COCO / AAP JSON) ─────────────────────────


@router.post(
    "/projects/{project_id}/predictions/import",
    response_model=AAPImportResult,
)
async def import_predictions(
    request: Request,
    file: UploadFile = File(...),
    format: str = Query("aap_json", pattern="^(aap_json|coco)$"),
    dry_run: bool = Query(False),
    model_version: str | None = Form(None),
    overwrite_existing: bool = Form(False),
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AAPImportResult:
    """外部模型预测结果导入端点 (v0.10.15).

    支持 COCO Detection 与平台原生 AAP JSON v1.0 两种 input format. 写入的
    Prediction 行 source='external_import', ml_backend_id=NULL.
    """

    from app.services import async_job as async_job_svc
    from app.services.predictions_import import import_aap_json, import_coco

    raw = await file.read()

    # v0.10.16 · async_jobs 双写（同步端点；dry_run 不记录）
    aj_id: uuid.UUID | None = None
    if not dry_run:
        try:
            aj = await async_job_svc.create_job(
                db,
                kind="predictions_import",
                project_id=project.id,
                user_id=current_user.id,
                payload={
                    "format": format,
                    "size_bytes": len(raw),
                    "overwrite_existing": overwrite_existing,
                    "model_version_fallback": model_version,
                },
            )
            await async_job_svc.mark_running(db, aj.id)
            await db.commit()
            aj_id = aj.id
        except Exception:
            await db.rollback()
            aj_id = None

    try:
        if format == "aap_json":
            result = await import_aap_json(
                db,
                project.id,
                raw,
                model_version_fallback=model_version,
                overwrite_existing=overwrite_existing,
                dry_run=dry_run,
            )
        else:
            result = await import_coco(
                db,
                project.id,
                raw,
                model_version_fallback=model_version,
                overwrite_existing=overwrite_existing,
                dry_run=dry_run,
            )
    except ValueError as exc:
        if aj_id is not None:
            try:
                await async_job_svc.mark_failed(db, aj_id, error=str(exc))
                await db.commit()
            except Exception:
                await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if aj_id is not None:
            try:
                await async_job_svc.mark_failed(db, aj_id, error=str(exc))
                await db.commit()
            except Exception:
                await db.rollback()
        raise

    if not dry_run:
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.PREDICTIONS_IMPORT,
            target_type="project",
            target_id=str(project.id),
            request=request,
            status_code=200,
            detail={
                "format": format,
                "project_display_id": project.display_id,
                "imported": result.imported,
                "skipped": result.skipped,
                "error_count": len(result.errors),
                "model_version_fallback": model_version,
                "overwrite_existing": overwrite_existing,
            },
        )
        if aj_id is not None:
            try:
                await async_job_svc.mark_complete(
                    db,
                    aj_id,
                    result={
                        "imported": result.imported,
                        "skipped": result.skipped,
                        "error_count": len(result.errors),
                    },
                )
            except Exception:
                pass
        await db.commit()

    return result
