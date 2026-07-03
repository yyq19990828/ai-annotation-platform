"""I12 · Object Group 与批量编辑 router.

端点(均要求 ids 属于同一 task, 简化权限校验且符合工作台 UX):
- POST /annotations/bulk-update  批量 patch class_name / attributes / 状态位 / group_id
- POST /annotations/group        把 ids 合到新 group_id (走 tasks.next_group_seq +1 RETURNING)
- POST /annotations/ungroup      把 ids 的 group_id 置 null; 仅剩 1 个成员的 group 自动 orphan ungroup

v0.10.54 · annotations import:
- POST /projects/{project_id}/annotations/import  导入 AAP JSON annotations[] (ADR-0028)
"""

from __future__ import annotations

import logging
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.annotation import Annotation
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.deps import (
    assert_project_visible,
    get_current_user,
    get_db,
    require_project_owner,
    require_roles,
    require_scopes,
)
from app.schemas.aap_json import AAPImportResult
from app.schemas.annotation import (
    AnnotationBulkUpdateRequest,
    AnnotationBulkUpdateResponse,
)
from app.services.annotation import AnnotationService
from app.services.audit import AuditAction, AuditService

router = APIRouter()
logger = logging.getLogger(__name__)

_ANNOTATORS = (
    UserRole.SUPER_ADMIN,
    UserRole.PROJECT_ADMIN,
    UserRole.REVIEWER,
    UserRole.ANNOTATOR,
)
_REVIEWERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)
_LOCKED_STATUSES = {"review", "completed"}


def _assert_task_editable(task: Task, user: User | None) -> None:
    """复用 tasks.py 同名守卫的语义: review / completed 锁;
    reviewer 在 review 态可微调."""
    if task.status not in _LOCKED_STATUSES:
        return
    if task.status == "review" and user is not None and user.role in _REVIEWERS:
        return
    raise HTTPException(
        status_code=409,
        detail={"reason": "task_locked", "status": task.status},
    )


async def _load_single_task_for_ids(
    db: AsyncSession,
    ids: list[uuid.UUID],
) -> Task:
    """所有 ids 必须属于同一 task; 否则 422.
    返回该 task (供 _assert_task_editable 与 project_visible 校验)."""
    if not ids:
        raise HTTPException(status_code=422, detail="ids must not be empty")
    rows = (
        await db.execute(
            select(Annotation.id, Annotation.task_id).where(Annotation.id.in_(ids))
        )
    ).all()
    if len(rows) != len(ids):
        missing = set(ids) - {r.id for r in rows}
        raise HTTPException(
            status_code=404,
            detail=f"annotations not found: {sorted(str(m) for m in missing)}",
        )
    task_ids = {r.task_id for r in rows}
    if len(task_ids) != 1:
        raise HTTPException(
            status_code=422,
            detail="bulk operation requires all annotations belong to a single task",
        )
    task_id = next(iter(task_ids))
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id} not found")
    return task


@router.post(
    "/annotations/bulk-update",
    response_model=AnnotationBulkUpdateResponse,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def bulk_update_annotations(
    payload: AnnotationBulkUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """I12 · 批量更新 N 个标注. 失败整体回滚 (单事务).

    设计取舍:
    - 不允许 bulk 改 geometry (同一 geometry 应用到 N 个 shape 无意义)
    - 不允许 bulk 改 tool_unit_id (会破坏 class_name 校验链)
    - group_id 通过 explicit_clear 字段区分 "未提供" vs "显式清空"
    """
    task = await _load_single_task_for_ids(db, payload.ids)
    await assert_project_visible(task.project_id, db, user)
    _assert_task_editable(task, user)

    service = AnnotationService(db)
    updated = await service.bulk_update(
        payload.ids,
        class_name=payload.patch.class_name,
        attributes=payload.patch.attributes,
        z_order=payload.patch.z_order,
        is_locked=payload.patch.is_locked,
        is_hidden=payload.patch.is_hidden,
        group_id=payload.patch.group_id,
        group_id_explicit_clear=payload.patch.group_id_explicit_clear,
    )
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.ANNOTATION_BULK_UPDATE,
        target_type="task",
        target_id=task.id,
        request=request,
        status_code=200,
        detail={
            "annotation_ids": [str(i) for i in payload.ids],
            "patch": payload.patch.model_dump(exclude_none=True),
            "count": len(updated),
        },
    )
    await db.commit()
    return AnnotationBulkUpdateResponse(
        updated_ids=[a.id for a in updated],
        updated_count=len(updated),
    )


# v0.21.3 · 标注编组(Ctrl+G)持久化已删除:group/ungroup 端点下线,批量编辑退化为
# 前端临时多选(bulk-update 保留)。跨帧同一对象走 track_id(ADR-0045),不再用 group_id。


# ── v0.10.54 · annotations import (ADR-0028) ──────────────────────────


@router.post(
    "/projects/{project_id}/annotations/import",
    response_model=AAPImportResult,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def import_annotations(
    request: Request,
    file: UploadFile = File(...),
    format: str = Query("aap_json", pattern="^(aap_json)$"),
    dry_run: bool = Query(False),
    overwrite: bool = Form(False),
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AAPImportResult:
    """导入 AAP JSON envelope 中的 annotations[] 数组 (v0.10.54, ADR-0028).

    geometry 透传内部格式（无需 LS 转换），user_id 归当前操作者，
    source 保留原值，attributes._imported=true 溯源标记。
    """
    from app.services import async_job as async_job_svc
    from app.services.async_job_notify import notify_job_terminal
    from app.services.annotations_import import import_aap_json_annotations

    raw = await file.read()

    # async_jobs 双写（dry_run 不记录）
    aj_id: uuid.UUID | None = None
    if not dry_run:
        try:
            aj = await async_job_svc.create_job(
                db,
                kind="annotations_import",
                project_id=project.id,
                user_id=current_user.id,
                payload={
                    "format": format,
                    "size_bytes": len(raw),
                    "project_display_id": project.display_id,
                    "overwrite": overwrite,
                },
            )
            await async_job_svc.mark_running(db, aj.id)
            await db.commit()
            aj_id = aj.id
        except Exception:
            await db.rollback()
            aj_id = None

    try:
        result = await import_aap_json_annotations(
            db,
            project.id,
            raw,
            operator_user_id=current_user.id,
            overwrite=overwrite,
            dry_run=dry_run,
        )
    except ValueError as exc:
        if aj_id is not None:
            try:
                await async_job_svc.mark_failed(db, aj_id, error=str(exc))
                await notify_job_terminal(db, job_id=aj_id)
                await db.commit()
            except Exception:
                await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if aj_id is not None:
            try:
                await async_job_svc.mark_failed(db, aj_id, error=str(exc))
                await notify_job_terminal(db, job_id=aj_id)
                await db.commit()
            except Exception:
                await db.rollback()
        raise

    if not dry_run:
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.ANNOTATION_IMPORT,
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
                "overwrite": overwrite,
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
                await notify_job_terminal(db, job_id=aj_id)
            except Exception:
                pass
        await db.commit()

    return result
