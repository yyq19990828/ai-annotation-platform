import uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import (
    get_db,
    require_roles,
)
from app.db.models.user import User
from app.schemas.task import (
    ReviewClaimResponse,
)
from app.services.audit import AuditAction, AuditService


from app.api.v1.tasks._shared import (
    _load_task_or_404,
    _REVIEWERS,
)

router = APIRouter()


class ReviewAction(BaseModel):
    """v0.10.16 · reviewer 驳回 payload。`reason_type` 自 v0.10.16 起必填，
    `reason` 仍为可空自由文本补充。"""

    reason_type: Literal["missing", "extra", "wrong_label", "wrong_geometry"] | None = (
        None
    )
    reason: str | None = None


@router.post("/{task_id}/review/claim", response_model=ReviewClaimResponse)
async def claim_review(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    """v0.6.5: 审核员进入审核页时调用（幂等）。
    第一个调用者写 reviewer_id + reviewer_claimed_at；
    后续调用者读取已存在的认领信息（不覆盖）。
    `reviewer_claimed_at` 一经设置即冻结标注员的 withdraw 入口。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_in_review", "status": task.status},
        )

    if task.reviewer_claimed_at is None:
        task.reviewer_id = current_user.id
        task.reviewer_claimed_at = datetime.now(timezone.utc)
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.TASK_REVIEW_CLAIM,
            target_type="task",
            target_id=str(task_id),
            request=request,
            status_code=200,
            detail={"project_id": str(task.project_id)},
        )
        await db.commit()

    return ReviewClaimResponse(
        task_id=task.id,
        reviewer_id=task.reviewer_id,
        reviewer_claimed_at=task.reviewer_claimed_at,
        is_self=(task.reviewer_id == current_user.id),
    )


@router.post("/{task_id}/review/approve")
async def approve_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(status_code=400, detail="Task is not in review status")

    task.status = "completed"
    now = datetime.now(timezone.utc)
    task.reviewed_at = now
    if task.reviewer_id is None:
        task.reviewer_id = current_user.id
    if task.reviewer_claimed_at is None:
        task.reviewer_claimed_at = now

    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project:
        project.completed_tasks = (project.completed_tasks or 0) + 1
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_APPROVE,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
        },
    )

    # 通知中心 fan-out：annotator 收到 task.approved（reviewer 自审场景跳过）
    if task.assignee_id is not None and task.assignee_id != current_user.id:
        from app.services.notification import NotificationService

        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=[task.assignee_id],
            type="task.approved",
            target_type="task",
            target_id=task.id,
            payload={
                "task_display_id": task.display_id,
                "project_id": str(task.project_id),
                "actor_id": str(current_user.id),
                "actor_name": current_user.name,
            },
        )

    await db.commit()
    return {"status": "approved", "task_id": str(task_id)}


@router.post("/{task_id}/review/reject")
async def reject_task(
    task_id: uuid.UUID,
    request: Request,
    body: ReviewAction | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(status_code=400, detail="Task is not in review status")

    reason_type = body.reason_type if body else None
    if reason_type is None:
        raise HTTPException(status_code=422, detail="reject reason_type is required")

    reason = (body.reason if body else None) or None
    reason_text = reason.strip() if reason else None

    task.status = "rejected"
    now = datetime.now(timezone.utc)
    task.reviewed_at = now
    task.reject_reason_type = reason_type
    task.reject_reason = reason_text
    if task.reviewer_id is None:
        task.reviewer_id = current_user.id
    if task.reviewer_claimed_at is None:
        task.reviewer_claimed_at = now
    await db.flush()

    # ADR-0027 第二段 · 双写到 annotation_feedbacks (kind=reject, anchor=task)
    from app.services.feedback import FeedbackService

    await FeedbackService(db).mirror_task_reject(task, reviewer_id=current_user.id)

    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project:
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_REJECT,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
            "reason_type": task.reject_reason_type,
            "reason": task.reject_reason,
        },
    )

    if task.assignee_id is not None and task.assignee_id != current_user.id:
        from app.services.notification import NotificationService

        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=[task.assignee_id],
            type="task.rejected",
            target_type="task",
            target_id=task.id,
            payload={
                "task_display_id": task.display_id,
                "project_id": str(task.project_id),
                "reject_reason_type": task.reject_reason_type,
                "reject_reason": task.reject_reason,
                "actor_id": str(current_user.id),
                "actor_name": current_user.name,
            },
        )

    await db.commit()
    return {
        "status": "rejected",
        "task_id": str(task_id),
        "reason_type": task.reject_reason_type,
        "reason": task.reject_reason,
    }
