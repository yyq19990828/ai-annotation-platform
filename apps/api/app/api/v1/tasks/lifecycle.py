import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import (
    get_db,
    require_roles,
)
from app.db.enums import UserRole
from app.db.models.user import User
from app.services.audit import AuditAction, AuditService
from app.services.task_lock import TaskLockService


from app.api.v1.tasks._shared import (
    _load_task_or_404,
    _ANNOTATORS,
)

router = APIRouter()


@router.post("/{task_id}/submit")
async def submit_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status not in ("pending", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_submittable", "status": task.status},
        )

    # v0.6.6: 提交者即 assignee。任务初始 assignee_id 为 NULL（创建时未指派），
    # 否则后续 withdraw/reopen 会因 assignee 校验失败而拒绝（"only assignee can withdraw"）。
    if task.assignee_id is None:
        task.assignee_id = current_user.id
        # v0.8.4：未预派任务由提交者兜底分派；assigned_at 同步写
        task.assigned_at = datetime.now(timezone.utc)

    task.status = "review"
    task.submitted_at = datetime.now(timezone.utc)
    # 清空上一轮 review 痕迹（reopen → 再次 submit 场景）
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None
    task.reject_reason_type = None

    lock_svc = TaskLockService(db)
    await lock_svc.release(task_id, current_user.id)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_SUBMIT,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
        },
    )

    await db.commit()
    return {"status": "submitted", "task_id": str(task_id)}


_VALID_SKIP_REASONS = {"image_corrupt", "no_target", "unclear", "other"}


class SkipTaskRequest(BaseModel):
    reason: str
    note: str | None = None


@router.post("/{task_id}/skip")
async def skip_task(
    task_id: uuid.UUID,
    body: SkipTaskRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.8.7 F7 · 标注员跳过任务并附原因，自动转 reviewer 复核。

    状态机：
      - pending / in_progress → review（与 submit 行为一致，但不要求有标注）
      - 其他状态 → 409
    业务约束：
      - reason ∈ {image_corrupt, no_target, unclear, other}；其他 422
      - reason="other" 时建议带 note，但 note 可空（前端兜底）
    """
    if body.reason not in _VALID_SKIP_REASONS:
        raise HTTPException(
            status_code=422,
            detail={"reason": "invalid_skip_reason", "value": body.reason},
        )

    task = await _load_task_or_404(db, task_id)
    if task.status not in ("pending", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_skippable", "status": task.status},
        )

    now = datetime.now(timezone.utc)
    if task.assignee_id is None:
        task.assignee_id = current_user.id
        task.assigned_at = now

    task.status = "review"
    task.skip_reason = body.reason
    task.skipped_at = now
    task.submitted_at = now
    # 清空上一轮 review 痕迹
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None
    task.reject_reason_type = None

    lock_svc = TaskLockService(db)
    await lock_svc.release(task_id, current_user.id)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_SKIP,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "skip_reason": body.reason,
            "note": body.note,
        },
    )
    await db.commit()
    return {
        "status": "skipped",
        "task_id": str(task_id),
        "skip_reason": body.reason,
    }


@router.post("/{task_id}/withdraw")
async def withdraw_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.6.5: 标注员撤回质检提交。
    前提：status=review、assignee == 当前用户、reviewer_claimed_at IS NULL。
    审核员一旦 claim 就锁死撤回入口，避免与审核动作打架。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_in_review", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value,
        UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(status_code=403, detail="only assignee can withdraw")
    if task.reviewer_claimed_at is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "task_already_claimed",
                "reviewer_id": str(task.reviewer_id) if task.reviewer_id else None,
            },
        )

    task.status = "in_progress"
    task.submitted_at = None

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
        action=AuditAction.TASK_WITHDRAW,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={"project_id": str(task.project_id)},
    )

    await db.commit()
    return {"status": "withdrawn", "task_id": str(task_id)}


# ── Review endpoints ───────────────────���────────────────────────────────────


@router.post("/{task_id}/reopen")
async def reopen_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.6.5: 标注员对已通过任务单方面重开编辑。
    前提：status=completed 且 assignee == 当前用户（admin 兜底）。
    清空 reviewer_* 但 detail 留 original_reviewer_id 用于通知；
    annotations 原地保留可继续改，依赖 audit_logs 回溯历史。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "completed":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_completed", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value,
        UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(status_code=403, detail="only assignee can reopen")

    original_reviewer_id = task.reviewer_id
    task.status = "in_progress"
    task.reopened_count = (task.reopened_count or 0) + 1
    task.last_reopened_at = datetime.now(timezone.utc)
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None
    task.reject_reason_type = None
    task.submitted_at = None

    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project:
        project.completed_tasks = max((project.completed_tasks or 0) - 1, 0)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_REOPEN,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "original_reviewer_id": str(original_reviewer_id)
            if original_reviewer_id
            else None,
            "reopened_count": task.reopened_count,
        },
    )

    # v0.7.6 · 通知中心 fan-out：原 reviewer 收到 task.reopened
    if original_reviewer_id is not None:
        from app.services.notification import NotificationService

        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=[original_reviewer_id],
            type="task.reopened",
            target_type="task",
            target_id=task.id,
            payload={
                "task_display_id": task.display_id,
                "project_id": str(task.project_id),
                "actor_id": str(current_user.id),
                "actor_name": current_user.name,
                "reopened_count": task.reopened_count,
            },
        )

    await db.commit()
    return {
        "status": "reopened",
        "task_id": str(task_id),
        "reopened_count": task.reopened_count,
    }


@router.post("/{task_id}/accept-rejection")
async def accept_rejection(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """M1 · 标注员接受退回，将 task 从 rejected 转回 in_progress 开始重做。
    不清空 reject_reason（保留审核员退回原因，前端可降级为"重做中"提示）。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "rejected":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_rejected", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value,
        UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(
            status_code=403, detail="only assignee can accept rejection"
        )

    task.status = "in_progress"

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_ACCEPT_REJECTION,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "reject_reason": task.reject_reason,
        },
    )

    await db.commit()
    return {"status": "in_progress", "task_id": str(task_id)}


# ── Task Lock endpoints ─────────────────────────────────────────────────────
