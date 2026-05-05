"""v0.7.2 · GET /annotations/{id}/history — 单个标注框的全生命周期时间线。

合并 3 类事件：
1. audit_logs.target_type='annotation' AND target_id=:id（create/update/delete/comment_*）
2. annotation_comments（即使被软删，仍按 created_at 显示一条 + delete 事件单独一条）
3. 关联 task 的关键 audit（task.approve / task.reject / task.reopen / task.review_claim
   / task.submit / task.withdraw）— 这些事件直接影响该 annotation 的最终命运
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import assert_project_visible, get_db, require_roles
from app.db.enums import UserRole
from app.db.models.annotation import Annotation
from app.db.models.annotation_comment import AnnotationComment
from app.db.models.audit_log import AuditLog
from app.db.models.user import User
from app.schemas.annotation_history import (
    AnnotationHistoryResponse,
    HistoryEntry,
)
from app.services.user_brief import resolve_briefs

router = APIRouter()

_ALL_ANNOTATORS = (
    UserRole.SUPER_ADMIN,
    UserRole.PROJECT_ADMIN,
    UserRole.REVIEWER,
    UserRole.ANNOTATOR,
)

# 这些 task 级 action 直接影响 annotation 的命运，归入时间线
_RELEVANT_TASK_ACTIONS = (
    "task.submit",
    "task.withdraw",
    "task.review_claim",
    "task.approve",
    "task.reject",
    "task.reopen",
)


@router.get(
    "/annotations/{annotation_id}/history", response_model=AnnotationHistoryResponse
)
async def get_annotation_history(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    ann = await db.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if ann.project_id is not None:
        await assert_project_visible(ann.project_id, db, current_user)

    # 1. annotation 级 audit
    ann_audits = (
        (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.target_type == "annotation",
                    AuditLog.target_id == str(annotation_id),
                )
            )
        )
        .scalars()
        .all()
    )

    # 2. 关联 task 的关键 audit（按 task_id 取，仅 _RELEVANT_TASK_ACTIONS）
    task_audits = (
        (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.target_type == "task",
                    AuditLog.target_id == str(ann.task_id),
                    AuditLog.action.in_(_RELEVANT_TASK_ACTIONS),
                )
            )
        )
        .scalars()
        .all()
    )

    # 3. 评论
    comments = (
        (
            await db.execute(
                select(AnnotationComment).where(
                    AnnotationComment.annotation_id == annotation_id,
                )
            )
        )
        .scalars()
        .all()
    )

    # 解析 actor / author UserBrief（一次 IN 查询）
    user_ids: set = set()
    for a in ann_audits:
        if a.actor_id:
            user_ids.add(a.actor_id)
    for a in task_audits:
        if a.actor_id:
            user_ids.add(a.actor_id)
    for c in comments:
        user_ids.add(c.author_id)
    briefs = await resolve_briefs(db, user_ids) if user_ids else {}

    entries: list[HistoryEntry] = []

    for a in ann_audits:
        entries.append(
            HistoryEntry(
                kind="audit",
                timestamp=a.created_at,
                actor=briefs.get(str(a.actor_id)) if a.actor_id else None,
                action=a.action,
                detail=a.detail_json,
            )
        )

    for a in task_audits:
        entries.append(
            HistoryEntry(
                kind="audit",
                timestamp=a.created_at,
                actor=briefs.get(str(a.actor_id)) if a.actor_id else None,
                action=a.action,
                detail=a.detail_json,
            )
        )

    for c in comments:
        entries.append(
            HistoryEntry(
                kind="comment",
                timestamp=c.created_at,
                actor=briefs.get(str(c.author_id)),
                comment_id=c.id,
                body=c.body,
                detail={"is_active": c.is_active},
            )
        )

    entries.sort(key=lambda e: e.timestamp)

    return AnnotationHistoryResponse(
        annotation_id=annotation_id,
        task_id=ann.task_id,
        entries=entries,
    )
