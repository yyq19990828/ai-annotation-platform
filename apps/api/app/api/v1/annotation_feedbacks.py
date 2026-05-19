"""I18 · AnnotationFeedback 统一反馈表 router.

端点:
- GET    /feedbacks?project_id=&task_id=&annotation_id=&kind=&anchor_type=&status=&cursor=
- POST   /feedbacks                         创建 (issue/comment/bug/reject)
- PATCH  /feedbacks/{id}                    改 status/severity/title/body
- DELETE /feedbacks/{id}                    软删 (is_active=false)
- POST   /feedbacks/{id}/replies            子评论 (thread_parent_id 链)
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.annotation_feedback import AnnotationFeedback
from app.db.models.user import User
from app.deps import assert_project_visible, get_db, require_roles
from app.schemas.annotation_feedback import (
    AnnotationFeedbackCreate,
    AnnotationFeedbackListPage,
    AnnotationFeedbackOut,
    AnnotationFeedbackPatch,
    AnnotationFeedbackReply,
)
from app.services.audit import AuditAction, AuditService
from app.services.feedback import FeedbackService
from app.services.user_brief import resolve_briefs

router = APIRouter()
logger = logging.getLogger(__name__)

_ALL = (
    UserRole.SUPER_ADMIN,
    UserRole.PROJECT_ADMIN,
    UserRole.REVIEWER,
    UserRole.ANNOTATOR,
)


async def _to_out(
    db: AsyncSession, entry: AnnotationFeedback
) -> AnnotationFeedbackOut:
    briefs = await resolve_briefs(db, [entry.author_id])
    brief = briefs.get(entry.author_id)
    return AnnotationFeedbackOut(
        id=entry.id,
        kind=entry.kind,
        anchor_type=entry.anchor_type,
        project_id=entry.project_id,
        task_id=entry.task_id,
        annotation_id=entry.annotation_id,
        anchor_position=entry.anchor_position,
        status=entry.status,
        severity=entry.severity,
        title=entry.title,
        body=entry.body,
        author_id=entry.author_id,
        author_name=brief.user_name if brief else None,
        attachments=entry.attachments or [],
        thread_parent_id=entry.thread_parent_id,
        is_active=entry.is_active,
        resolved_at=entry.resolved_at,
        resolved_by_id=entry.resolved_by_id,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.get("/feedbacks", response_model=AnnotationFeedbackListPage)
async def list_feedbacks(
    project_id: uuid.UUID = Query(...),
    task_id: uuid.UUID | None = None,
    annotation_id: uuid.UUID | None = None,
    kind: str | None = None,
    anchor_type: str | None = None,
    status: str | None = None,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ALL)),
):
    await assert_project_visible(project_id, db, user)
    svc = FeedbackService(db)
    rows, next_cursor = await svc.list_paged(
        project_id=project_id,
        task_id=task_id,
        annotation_id=annotation_id,
        kind=kind,
        anchor_type=anchor_type,
        status=status,
        cursor=cursor,
        limit=limit,
    )
    # 一次解析全部 author
    author_ids = {r.author_id for r in rows}
    briefs = await resolve_briefs(db, list(author_ids))
    items: list[AnnotationFeedbackOut] = []
    for r in rows:
        brief = briefs.get(r.author_id)
        items.append(
            AnnotationFeedbackOut(
                id=r.id,
                kind=r.kind,
                anchor_type=r.anchor_type,
                project_id=r.project_id,
                task_id=r.task_id,
                annotation_id=r.annotation_id,
                anchor_position=r.anchor_position,
                status=r.status,
                severity=r.severity,
                title=r.title,
                body=r.body,
                author_id=r.author_id,
                author_name=brief.user_name if brief else None,
                attachments=r.attachments or [],
                thread_parent_id=r.thread_parent_id,
                is_active=r.is_active,
                resolved_at=r.resolved_at,
                resolved_by_id=r.resolved_by_id,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )
    return AnnotationFeedbackListPage(items=items, next_cursor=next_cursor)


@router.post("/feedbacks", response_model=AnnotationFeedbackOut)
async def create_feedback(
    payload: AnnotationFeedbackCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ALL)),
):
    await assert_project_visible(payload.project_id, db, user)
    svc = FeedbackService(db)
    entry = await svc.create(
        author_id=user.id,
        kind=payload.kind,
        anchor_type=payload.anchor_type,
        project_id=payload.project_id,
        task_id=payload.task_id,
        annotation_id=payload.annotation_id,
        anchor_position=(
            payload.anchor_position.model_dump() if payload.anchor_position else None
        ),
        severity=payload.severity,
        title=payload.title,
        body=payload.body,
        attachments=payload.attachments,
        thread_parent_id=payload.thread_parent_id,
    )
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.FEEDBACK_CREATED,
        target_type="feedback",
        target_id=entry.id,
        request=request,
        status_code=200,
        detail={
            "kind": entry.kind,
            "anchor_type": entry.anchor_type,
            "project_id": str(entry.project_id),
            "task_id": str(entry.task_id) if entry.task_id else None,
            "annotation_id": (
                str(entry.annotation_id) if entry.annotation_id else None
            ),
        },
    )
    await db.commit()
    await db.refresh(entry)
    return await _to_out(db, entry)


@router.patch("/feedbacks/{feedback_id}", response_model=AnnotationFeedbackOut)
async def patch_feedback(
    feedback_id: uuid.UUID,
    payload: AnnotationFeedbackPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ALL)),
):
    entry = await db.get(AnnotationFeedback, feedback_id)
    if entry is None or not entry.is_active:
        raise HTTPException(status_code=404, detail="feedback not found")
    await assert_project_visible(entry.project_id, db, user)
    # 只有作者 / project_admin / super_admin 可改; reviewer 可改 status (闭环 issue).
    is_author = entry.author_id == user.id
    is_admin = user.role in (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)
    is_reviewer = user.role == UserRole.REVIEWER
    if not (is_author or is_admin or (is_reviewer and payload.status is not None)):
        raise HTTPException(status_code=403, detail="not allowed")
    svc = FeedbackService(db)
    old_status = entry.status
    updated = await svc.patch(
        feedback_id,
        actor_id=user.id,
        status=payload.status,
        severity=payload.severity,
        title=payload.title,
        body=payload.body,
    )
    if payload.status is not None and payload.status != old_status:
        await AuditService.log(
            db,
            actor=user,
            action=AuditAction.FEEDBACK_STATUS_CHANGED,
            target_type="feedback",
            target_id=feedback_id,
            request=request,
            status_code=200,
            detail={"from": old_status, "to": payload.status},
        )
    await db.commit()
    await db.refresh(updated)
    return await _to_out(db, updated)


@router.delete("/feedbacks/{feedback_id}", status_code=204)
async def delete_feedback(
    feedback_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ALL)),
):
    entry = await db.get(AnnotationFeedback, feedback_id)
    if entry is None or not entry.is_active:
        raise HTTPException(status_code=404, detail="feedback not found")
    await assert_project_visible(entry.project_id, db, user)
    is_author = entry.author_id == user.id
    is_admin = user.role in (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)
    if not (is_author or is_admin):
        raise HTTPException(status_code=403, detail="not allowed")
    svc = FeedbackService(db)
    await svc.soft_delete(feedback_id)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.FEEDBACK_DELETED,
        target_type="feedback",
        target_id=feedback_id,
        request=request,
        status_code=204,
        detail=None,
    )
    await db.commit()


@router.post(
    "/feedbacks/{feedback_id}/replies", response_model=AnnotationFeedbackOut
)
async def reply_feedback(
    feedback_id: uuid.UUID,
    payload: AnnotationFeedbackReply,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*_ALL)),
):
    parent = await db.get(AnnotationFeedback, feedback_id)
    if parent is None or not parent.is_active:
        raise HTTPException(status_code=404, detail="feedback not found")
    await assert_project_visible(parent.project_id, db, user)
    svc = FeedbackService(db)
    # 子评论继承 parent 的 anchor; kind 强制为 comment.
    reply = await svc.create(
        author_id=user.id,
        kind="comment",
        anchor_type=parent.anchor_type,
        project_id=parent.project_id,
        task_id=parent.task_id,
        annotation_id=parent.annotation_id,
        anchor_position=parent.anchor_position,
        severity=None,
        title=None,
        body=payload.body,
        attachments=payload.attachments,
        thread_parent_id=parent.id,
    )
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.FEEDBACK_CREATED,
        target_type="feedback",
        target_id=reply.id,
        request=request,
        status_code=200,
        detail={"reply_to": str(parent.id)},
    )
    await db.commit()
    await db.refresh(reply)
    return await _to_out(db, reply)
