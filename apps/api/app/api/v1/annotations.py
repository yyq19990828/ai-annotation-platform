"""I12 · Object Group 与批量编辑 router.

端点(均要求 ids 属于同一 task, 简化权限校验且符合工作台 UX):
- POST /annotations/bulk-update  批量 patch class_name / attributes / 状态位 / group_id
- POST /annotations/group        把 ids 合到新 group_id (走 tasks.next_group_seq +1 RETURNING)
- POST /annotations/ungroup      把 ids 的 group_id 置 null; 仅剩 1 个成员的 group 自动 orphan ungroup
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.annotation import Annotation
from app.db.models.task import Task
from app.db.models.user import User
from app.deps import assert_project_visible, get_db, require_roles
from app.schemas.annotation import (
    AnnotationBulkUpdateRequest,
    AnnotationBulkUpdateResponse,
    AnnotationGroupRequest,
    AnnotationGroupResponse,
    AnnotationUngroupRequest,
    AnnotationUngroupResponse,
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
        is_occluded=payload.patch.is_occluded,
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


@router.post(
    "/annotations/group",
    response_model=AnnotationGroupResponse,
)
async def group_annotations(
    payload: AnnotationGroupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """I12 · 把 ids 合到新 group; 走 tasks.next_group_seq +1 RETURNING."""
    task = await _load_single_task_for_ids(db, payload.ids)
    if task.id != payload.task_id:
        raise HTTPException(
            status_code=422,
            detail=f"payload task_id mismatch (ids belong to task {task.id})",
        )
    await assert_project_visible(task.project_id, db, user)
    _assert_task_editable(task, user)

    service = AnnotationService(db)
    new_group_id, rows = await service.group(payload.ids, task.id)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.ANNOTATION_GROUP,
        target_type="task",
        target_id=task.id,
        request=request,
        status_code=200,
        detail={
            "group_id": new_group_id,
            "annotation_ids": [str(r.id) for r in rows],
        },
    )
    await db.commit()
    return AnnotationGroupResponse(
        group_id=new_group_id,
        affected_ids=[r.id for r in rows],
    )


@router.post(
    "/annotations/ungroup",
    response_model=AnnotationUngroupResponse,
)
async def ungroup_annotations(
    payload: AnnotationUngroupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """I12 · 把 ids 的 group_id 置 null; orphan group (仅剩 1 个) 自动级联清理."""
    task = await _load_single_task_for_ids(db, payload.ids)
    await assert_project_visible(task.project_id, db, user)
    _assert_task_editable(task, user)

    service = AnnotationService(db)
    cleared, orphans = await service.ungroup(payload.ids)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.ANNOTATION_UNGROUP,
        target_type="task",
        target_id=task.id,
        request=request,
        status_code=200,
        detail={
            "cleared_ids": [str(i) for i in cleared],
            "auto_cleared_orphans": [str(i) for i in orphans],
        },
    )
    await db.commit()
    return AnnotationUngroupResponse(
        cleared_ids=cleared,
        auto_cleared_orphans=orphans,
    )
