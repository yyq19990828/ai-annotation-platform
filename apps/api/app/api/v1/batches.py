import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import (
    get_db,
    get_current_user,
    require_roles,
    require_project_visible,
    require_project_owner,
)
from app.db.enums import UserRole, BatchStatus
from app.db.models.user import User
from app.db.models.project import Project
from app.schemas.batch import (
    BatchCreate,
    BatchUpdate,
    BatchOut,
    BatchTransition,
    BatchReject,
    BatchReset,
    BatchSplitRequest,
    ProjectDistributeBatches,
    BatchDistributeResult,
    BulkBatchIds,
    BulkBatchReassign,
    BulkBatchActionResponse,
    AdminLockRequest,
    BulkBatchApprove,
    BulkBatchReject,
)
from app.services.batch import BatchService, assert_can_transition, REVERSE_TRANSITIONS
from app.services.audit import AuditService, AuditAction
from app.services.notification import NotificationService
from app.services.user_brief import resolve_briefs_with_project_role
from app.db.models.audit_log import AuditLog
from sqlalchemy import select as sa_select

router = APIRouter()

_REVIEWERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)


def _batch_to_out(batch, briefs: dict | None = None) -> BatchOut:
    total = batch.total_tasks or 1
    pct = round((batch.completed_tasks / total) * 100, 1) if batch.total_tasks else 0.0
    out = BatchOut.model_validate(batch)
    out.progress_pct = pct
    if briefs is not None:
        # v0.7.2：单值语义 — 直接按 annotator_id / reviewer_id 拿 brief
        if batch.annotator_id is not None:
            out.annotator = briefs.get(str(batch.annotator_id))
        if batch.reviewer_id is not None:
            out.reviewer = briefs.get(str(batch.reviewer_id))
    return out


async def _briefs_for_batches(db, project_id, batches) -> dict:
    """v0.7.2：一次 IN 查询解析所有批次的 annotator_id + reviewer_id → UserBrief。"""
    all_ids = set()
    for b in batches:
        if b.annotator_id is not None:
            all_ids.add(str(b.annotator_id))
        if b.reviewer_id is not None:
            all_ids.add(str(b.reviewer_id))
    if not all_ids:
        return {}
    return await resolve_briefs_with_project_role(db, project_id, all_ids)


@router.get("")
async def list_batches(
    project_id: uuid.UUID,
    status: str | None = None,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    svc = BatchService(db)
    batches = await svc.list_by_project(project_id, status)
    briefs = await _briefs_for_batches(db, project_id, batches)
    return [_batch_to_out(b, briefs) for b in batches]


@router.get("/unclassified-count")
async def get_unclassified_task_count(
    project_id: uuid.UUID,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    """v0.7.3：项目下未归类（batch_id IS NULL）任务数。
    给 BatchesSection 顶部横带「未归类 N 条 · 去分包」用。
    """
    from sqlalchemy import select as sa_sel, func as sa_func
    from app.db.models.task import Task

    n = (
        await db.execute(
            sa_sel(sa_func.count())
            .select_from(Task)
            .where(
                Task.project_id == project_id,
                Task.batch_id.is_(None),
            )
        )
    ).scalar() or 0
    return {"count": int(n)}


@router.get("/{batch_id}")
async def get_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


@router.post("", status_code=201)
async def create_batch(
    project_id: uuid.UUID,
    data: BatchCreate,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.create(project_id, data, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_CREATED,
        target_type="batch",
        target_id=str(batch.id),
        request=request,
        status_code=201,
        detail={"name": batch.name, "project_id": str(project_id)},
    )
    await db.commit()
    await db.refresh(batch)
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


@router.patch("/{batch_id}")
async def update_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    data: BatchUpdate,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch = await svc.update(batch_id, data)
    await db.commit()
    await db.refresh(batch)
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


@router.delete("/{batch_id}", status_code=204)
async def delete_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    affected = batch.total_tasks
    await svc.delete(batch_id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_DELETED,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=204,
        detail={"name": batch.name, "affected_tasks": affected},
    )
    await db.commit()


@router.post("/{batch_id}/transition")
async def transition_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    data: BatchTransition,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    # v0.7.0：按 (from, to) 校验角色（403 携带可读 detail）
    assert_can_transition(current_user, project, batch, data.target_status)

    # v0.7.3：逆向迁移强制 reason（schema 层面 reason 是可选，这里按方向决定是否必填）
    is_reverse = (batch.status, data.target_status) in REVERSE_TRANSITIONS
    if is_reverse and not data.reason:
        raise HTTPException(
            status_code=400, detail="reason is required for reverse transition"
        )

    old_status = batch.status
    batch = await svc.transition(batch_id, data.target_status, current_user.id)
    audit_detail: dict = {"before": old_status, "after": batch.status}
    if is_reverse:
        audit_detail["reverse"] = True
        audit_detail["reason"] = data.reason
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_STATUS_CHANGED,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail=audit_detail,
    )

    # v0.7.3：逆向迁移按方向分发通知
    notif_recipients: list[uuid.UUID] = []
    notif_type: str | None = None
    if (old_status, batch.status) == (BatchStatus.ARCHIVED, BatchStatus.ACTIVE):
        notif_type = "batch.unarchived"
        if batch.annotator_id is not None:
            notif_recipients.append(batch.annotator_id)
        if batch.reviewer_id is not None and batch.reviewer_id != batch.annotator_id:
            notif_recipients.append(batch.reviewer_id)
    elif (old_status, batch.status) in {
        (BatchStatus.APPROVED, BatchStatus.REVIEWING),
        (BatchStatus.REJECTED, BatchStatus.REVIEWING),
    }:
        notif_type = "batch.review_reopened"
        if batch.reviewer_id is not None and batch.reviewer_id != current_user.id:
            notif_recipients.append(batch.reviewer_id)

    if notif_type and notif_recipients:
        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=notif_recipients,
            type=notif_type,
            target_type="batch",
            target_id=batch.id,
            payload={
                "batch_display_id": batch.display_id,
                "batch_name": batch.name,
                "project_id": str(project_id),
                "from_status": old_status,
                "reason": data.reason,
            },
        )

    await db.commit()
    await db.refresh(batch)
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


@router.post("/split")
async def split_batches(
    project_id: uuid.UUID,
    data: BatchSplitRequest,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batches = await svc.split(project_id, data, current_user.id)
    for b in batches:
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.BATCH_CREATED,
            target_type="batch",
            target_id=str(b.id),
            request=request,
            status_code=200,
            detail={
                "name": b.name,
                "strategy": data.strategy,
                "total_tasks": b.total_tasks,
            },
        )
    await db.commit()
    for b in batches:
        await db.refresh(b)
    briefs = await _briefs_for_batches(db, project_id, batches)
    return [_batch_to_out(b, briefs) for b in batches]


@router.post("/distribute-batches", response_model=BatchDistributeResult)
async def distribute_batches_in_project(
    project_id: uuid.UUID,
    data: ProjectDistributeBatches,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.7.2：项目级 batch 分派 — 把项目下未分派/全部 batch 圆周分配给所选 annotator/reviewer。
    每 batch 落到 1 个 annotator + 1 个 reviewer；同步回填该 batch 下所有 task 的 assignee_id/reviewer_id。
    """
    svc = BatchService(db)
    summary = await svc.distribute_batches_in_project(
        project_id,
        annotator_ids=data.annotator_ids,
        reviewer_ids=data.reviewer_ids,
        only_unassigned=data.only_unassigned,
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_DISTRIBUTE_EVEN,
        target_type="project",
        target_id=str(project_id),
        request=request,
        status_code=200,
        detail={
            "scope": "project_batches",
            "distributed_batches": summary["distributed_batches"],
            "annotator_count": len(data.annotator_ids),
            "reviewer_count": len(data.reviewer_ids),
            "only_unassigned": data.only_unassigned,
        },
    )
    await db.commit()
    return summary


@router.post("/{batch_id}/reject")
async def reject_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    data: BatchReject,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    # v0.7.0：复用 transition 鉴权矩阵（reviewing → rejected 的角色门）
    assert_can_transition(current_user, project, batch, "rejected")

    batch, affected = await svc.reject_batch(
        batch_id,
        feedback=data.feedback,
        reviewer_id=current_user.id,
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_REJECTED,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail={"affected_tasks": affected, "feedback": data.feedback},
    )

    # v0.7.2 · 单值语义：只通知该批次的标注员（reviewer 是 actor 本人无需通知）
    if batch.annotator_id is not None:
        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=[batch.annotator_id],
            type="batch.rejected",
            target_type="batch",
            target_id=batch.id,
            payload={
                "batch_display_id": batch.display_id,
                "batch_name": batch.name,
                "project_id": str(project_id),
                "feedback": data.feedback,
                "affected_tasks": affected,
            },
        )

    await db.commit()
    await db.refresh(batch)
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


# ── v0.7.6 · Reset → draft 终极重置 ───────────────────────────────────────


@router.post("/{batch_id}/reset", response_model=BatchOut)
async def reset_batch_to_draft(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    data: BatchReset,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.7.6 · owner 兜底：把任意状态批次回退到 draft。

    - task 全部回 pending（保留 annotation 记录与 is_active）
    - 删除 task_locks 释放标注员锁
    - 清 review_feedback / reviewed_at / reviewed_by
    - 强制 reason ≥ 10 字（schema 层校验），写入 audit.detail.reason
    """
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    from_status = batch.status
    batch, affected, cascade = await svc.reset_to_draft(batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_RESET_TO_DRAFT,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail={
            "from_status": from_status,
            "reason": data.reason,
            "affected_tasks": affected,
            "cascade": cascade,
        },
    )

    await db.commit()
    await db.refresh(batch)
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


# ── v0.9.15 · ADR-0008 Admin Lock/Unlock ─────────────────────────────────


@router.post("/{batch_id}/admin-lock", response_model=BatchOut)
async def admin_lock_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    data: AdminLockRequest,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch = await svc.admin_lock(
        batch_id, reason=data.reason, locked_by=current_user.id
    )

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_ADMIN_LOCK,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail={"reason": data.reason, "batch_status": batch.status},
    )

    notif_recipients: list[uuid.UUID] = []
    if batch.annotator_id and batch.annotator_id != current_user.id:
        notif_recipients.append(batch.annotator_id)
    if batch.reviewer_id and batch.reviewer_id != current_user.id:
        notif_recipients.append(batch.reviewer_id)
    if project.owner_id != current_user.id:
        notif_recipients.append(project.owner_id)
    if notif_recipients:
        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=notif_recipients,
            type="batch.admin_locked",
            target_type="batch",
            target_id=batch.id,
            payload={
                "batch_display_id": batch.display_id,
                "batch_name": batch.name,
                "project_id": str(project_id),
                "reason": data.reason,
            },
        )

    await db.commit()
    await db.refresh(batch)
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


@router.post("/{batch_id}/admin-unlock", response_model=BatchOut)
async def admin_unlock_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch = await svc.admin_unlock(batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_ADMIN_UNLOCK,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail={"batch_status": batch.status},
    )

    notif_recipients: list[uuid.UUID] = []
    if batch.annotator_id and batch.annotator_id != current_user.id:
        notif_recipients.append(batch.annotator_id)
    if batch.reviewer_id and batch.reviewer_id != current_user.id:
        notif_recipients.append(batch.reviewer_id)
    if notif_recipients:
        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=notif_recipients,
            type="batch.admin_unlocked",
            target_type="batch",
            target_id=batch.id,
            payload={
                "batch_display_id": batch.display_id,
                "batch_name": batch.name,
                "project_id": str(project_id),
            },
        )

    await db.commit()
    await db.refresh(batch)
    briefs = await _briefs_for_batches(db, project_id, [batch])
    return _batch_to_out(batch, briefs)


# ── v0.7.3 · 多选批量操作 ─────────────────────────────────────────────────


def _bulk_audit_detail(payload: dict, summary: dict) -> dict:
    return {
        "batch_ids": [str(x) for x in payload.get("batch_ids", [])],
        "succeeded": [str(x) for x in summary["succeeded"]],
        "skipped": [
            {"batch_id": str(x["batch_id"]), "reason": x["reason"]}
            for x in summary["skipped"]
        ],
        "failed": [
            {"batch_id": str(x["batch_id"]), "reason": x["reason"]}
            for x in summary["failed"]
        ],
    }


@router.post("/bulk-archive", response_model=BulkBatchActionResponse)
async def bulk_archive_batches(
    project_id: uuid.UUID,
    data: BulkBatchIds,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    summary = await svc.bulk_archive(project_id, data.batch_ids)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BULK_BATCH_ARCHIVE,
        target_type="project",
        target_id=str(project_id),
        request=request,
        status_code=200,
        detail=_bulk_audit_detail({"batch_ids": data.batch_ids}, summary),
    )
    await db.commit()
    return summary


@router.post("/bulk-delete", response_model=BulkBatchActionResponse)
async def bulk_delete_batches(
    project_id: uuid.UUID,
    data: BulkBatchIds,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    summary = await svc.bulk_delete(project_id, data.batch_ids)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BULK_BATCH_DELETE,
        target_type="project",
        target_id=str(project_id),
        request=request,
        status_code=200,
        detail=_bulk_audit_detail({"batch_ids": data.batch_ids}, summary),
    )
    await db.commit()
    return summary


@router.post("/bulk-reassign", response_model=BulkBatchActionResponse)
async def bulk_reassign_batches(
    project_id: uuid.UUID,
    data: BulkBatchReassign,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raw = data.model_dump(exclude_unset=True)
    annotator_set = "annotator_id" in raw
    reviewer_set = "reviewer_id" in raw
    svc = BatchService(db)
    summary = await svc.bulk_reassign(
        project_id,
        data.batch_ids,
        annotator_id=data.annotator_id,
        reviewer_id=data.reviewer_id,
        annotator_set=annotator_set,
        reviewer_set=reviewer_set,
    )
    audit_detail = _bulk_audit_detail({"batch_ids": data.batch_ids}, summary)
    if annotator_set:
        audit_detail["annotator_id"] = (
            str(data.annotator_id) if data.annotator_id else None
        )
    if reviewer_set:
        audit_detail["reviewer_id"] = (
            str(data.reviewer_id) if data.reviewer_id else None
        )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BULK_BATCH_REASSIGN,
        target_type="project",
        target_id=str(project_id),
        request=request,
        status_code=200,
        detail=audit_detail,
    )
    await db.commit()
    return summary


@router.post("/bulk-activate", response_model=BulkBatchActionResponse)
async def bulk_activate_batches(
    project_id: uuid.UUID,
    data: BulkBatchIds,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    summary = await svc.bulk_activate(project_id, data.batch_ids)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BULK_BATCH_ACTIVATE,
        target_type="project",
        target_id=str(project_id),
        request=request,
        status_code=200,
        detail=_bulk_audit_detail({"batch_ids": data.batch_ids}, summary),
    )
    await db.commit()
    return summary


@router.post("/bulk-approve", response_model=BulkBatchActionResponse)
async def bulk_approve_batches(
    project_id: uuid.UUID,
    data: BulkBatchApprove,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    svc = BatchService(db)
    summary = await svc.bulk_approve(project_id, data.batch_ids)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BULK_BATCH_APPROVE,
        target_type="project",
        target_id=str(project_id),
        request=request,
        status_code=200,
        detail=_bulk_audit_detail({"batch_ids": data.batch_ids}, summary),
    )
    await db.commit()
    return summary


@router.post("/bulk-reject", response_model=BulkBatchActionResponse)
async def bulk_reject_batches(
    project_id: uuid.UUID,
    data: BulkBatchReject,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    svc = BatchService(db)
    summary = await svc.bulk_reject(
        project_id,
        data.batch_ids,
        feedback=data.feedback,
        reviewer_id=current_user.id,
    )
    audit_detail = _bulk_audit_detail({"batch_ids": data.batch_ids}, summary)
    audit_detail["feedback"] = data.feedback
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BULK_BATCH_REJECT,
        target_type="project",
        target_id=str(project_id),
        request=request,
        status_code=200,
        detail=audit_detail,
    )
    # 通知各批次的标注员
    if summary["succeeded"]:
        loaded = await svc._load_batches_for_bulk(project_id, summary["succeeded"])
        notif_svc = NotificationService(db)
        for batch in loaded.values():
            if batch.annotator_id and batch.annotator_id != current_user.id:
                await notif_svc.notify_many(
                    user_ids=[batch.annotator_id],
                    type="batch.rejected",
                    target_type="batch",
                    target_id=batch.id,
                    payload={
                        "batch_display_id": batch.display_id,
                        "batch_name": batch.name,
                        "project_id": str(project_id),
                        "feedback": data.feedback,
                        "bulk": True,
                    },
                )
    await db.commit()
    return summary


@router.get("/{batch_id}/audit-logs")
async def list_batch_audit_logs(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    """v0.7.3：批次操作历史抽屉数据源。
    返回该批次相关的 audit_log，按时间倒序，包含：
    - 直接 target=batch 的事件（创建/状态迁移/驳回/删除）
    - bulk 类操作中提及到该批次的项目级事件（detail_json.batch_ids 包含此 id）
    """
    from sqlalchemy import or_

    bulk_actions = (
        AuditAction.BULK_BATCH_ARCHIVE.value,
        AuditAction.BULK_BATCH_DELETE.value,
        AuditAction.BULK_BATCH_REASSIGN.value,
        AuditAction.BULK_BATCH_ACTIVATE.value,
    )
    direct = (AuditLog.target_type == "batch") & (AuditLog.target_id == str(batch_id))
    bulk_match = (
        (AuditLog.target_type == "project")
        & (AuditLog.target_id == str(project_id))
        & (AuditLog.action.in_(bulk_actions))
        & (AuditLog.detail_json.contains({"batch_ids": [str(batch_id)]}))
    )
    rows = (
        (
            await db.execute(
                sa_select(AuditLog)
                .where(or_(direct, bulk_match))
                .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    return [
        {
            "id": r.id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "actor_id": str(r.actor_id) if r.actor_id else None,
            "actor_email": r.actor_email,
            "actor_role": r.actor_role,
            "action": r.action,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "detail": r.detail_json,
        }
        for r in rows
    ]


@router.get("/{batch_id}/export")
async def export_batch(
    request: Request,
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    format: str = Query("coco", pattern="^(coco|voc|yolo)$"),
    include_attributes: bool = Query(True),
    project: Project = Depends(require_project_visible),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.export import ExportService
    from app.services.audit import AuditService, AuditAction, export_detail

    svc_batch = BatchService(db)
    batch = await svc_batch.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    svc = ExportService(db)
    fname = f"{project.display_id}_{batch.display_id}"

    if format == "coco":
        content = await svc.export_coco(
            project_id, batch_id=batch_id, include_attributes=include_attributes
        )
        await AuditService.log(
            db,
            actor=actor,
            action=AuditAction.BATCH_EXPORT,
            target_type="batch",
            target_id=str(batch_id),
            request=request,
            status_code=200,
            detail=export_detail(
                actor=actor,
                request=request,
                base={
                    "format": format,
                    "project_id": str(project_id),
                    "batch_display_id": batch.display_id,
                },
                filter_criteria={"include_attributes": include_attributes},
            ),
        )
        await db.commit()
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={fname}_coco.json"},
        )

    if format == "yolo":
        data = await svc.export_yolo(
            project_id, batch_id=batch_id, include_attributes=include_attributes
        )
        await AuditService.log(
            db,
            actor=actor,
            action=AuditAction.BATCH_EXPORT,
            target_type="batch",
            target_id=str(batch_id),
            request=request,
            status_code=200,
            detail=export_detail(
                actor=actor,
                request=request,
                base={
                    "format": format,
                    "project_id": str(project_id),
                    "batch_display_id": batch.display_id,
                },
                filter_criteria={"include_attributes": include_attributes},
            ),
        )
        await db.commit()
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={fname}_yolo.zip"},
        )

    data = await svc.export_voc(
        project_id, batch_id=batch_id, include_attributes=include_attributes
    )
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.BATCH_EXPORT,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail={
            "format": format,
            "project_id": str(project_id),
            "batch_display_id": batch.display_id,
        },
    )
    await db.commit()
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={fname}_voc.zip"},
    )
