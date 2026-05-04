from __future__ import annotations

from enum import Enum
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit_log import AuditLog
from app.db.models.user import User
from app.middleware.request_id import request_id_var


class AuditAction(str, Enum):
    AUTH_LOGIN = "auth.login"
    USER_INVITE = "user.invite"
    USER_REGISTER = "user.register"
    USER_ROLE_CHANGE = "user.role_change"
    USER_DEACTIVATE = "user.deactivate"
    USER_DELETE = "user.delete"
    USER_PROFILE_UPDATE = "user.profile_update"
    USER_PASSWORD_CHANGE = "user.password_change"
    PROJECT_CREATE = "project.create"
    PROJECT_UPDATE = "project.update"
    PROJECT_TRANSFER = "project.transfer"
    PROJECT_DELETE = "project.delete"
    PROJECT_MEMBER_ADD = "project.member_add"
    PROJECT_MEMBER_REMOVE = "project.member_remove"
    DATASET_CREATE = "dataset.create"
    DATASET_DELETE = "dataset.delete"
    DATASET_LINK = "dataset.link"
    DATASET_UNLINK = "dataset.unlink"
    SYSTEM_BOOTSTRAP_ADMIN = "system.bootstrap_admin"
    BUG_REPORT_CREATED = "bug_report.created"
    BUG_REPORT_STATUS_CHANGED = "bug_report.status_changed"
    BUG_COMMENT_CREATED = "bug_comment.created"
    BATCH_CREATED = "batch.created"
    BATCH_STATUS_CHANGED = "batch.status_changed"
    BATCH_REJECTED = "batch.rejected"
    BATCH_DELETED = "batch.deleted"
    BATCH_DISTRIBUTE_EVEN = "batch.distribute_even"
    # v0.7.3 · 多选批量操作
    BULK_BATCH_ARCHIVE = "batch.bulk_archive"
    BULK_BATCH_DELETE = "batch.bulk_delete"
    BULK_BATCH_REASSIGN = "batch.bulk_reassign"
    BULK_BATCH_ACTIVATE = "batch.bulk_activate"
    ANNOTATION_ATTRIBUTE_CHANGE = "annotation.attribute_change"
    # v0.7.2 · annotation 编辑历史可追溯
    ANNOTATION_CREATE = "annotation.create"
    ANNOTATION_UPDATE = "annotation.update"
    ANNOTATION_DELETE = "annotation.delete"
    ANNOTATION_COMMENT_ADD = "annotation.comment_add"
    ANNOTATION_COMMENT_DELETE = "annotation.comment_delete"
    # v0.6.5 · 任务状态机锁定
    TASK_SUBMIT = "task.submit"
    TASK_WITHDRAW = "task.withdraw"
    TASK_REVIEW_CLAIM = "task.review_claim"
    TASK_APPROVE = "task.approve"
    TASK_REJECT = "task.reject"
    TASK_REOPEN = "task.reopen"


def extract_client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


class AuditService:
    """业务层显式打点。同事务 flush，由调用方 commit。"""

    @staticmethod
    async def log(
        db: AsyncSession,
        *,
        actor: User | None,
        action: str | AuditAction,
        target_type: str | None = None,
        target_id: str | int | None = None,
        request: Request | None = None,
        status_code: int | None = None,
        detail: dict[str, Any] | None = None,
    ) -> AuditLog:
        action_str = action.value if isinstance(action, AuditAction) else str(action)
        rid = request_id_var.get()
        entry = AuditLog(
            actor_id=getattr(actor, "id", None),
            actor_email=getattr(actor, "email", None),
            actor_role=getattr(actor, "role", None),
            action=action_str,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            method=getattr(request, "method", None),
            path=str(request.url.path) if request is not None else None,
            status_code=status_code,
            ip=extract_client_ip(request),
            detail_json=detail,
            request_id=rid or None,
        )
        db.add(entry)
        await db.flush()
        return entry

    @staticmethod
    async def log_many(
        db: AsyncSession,
        *,
        actor: User | None,
        action: str | AuditAction,
        target_type: str | None = None,
        request: Request | None = None,
        status_code: int | None = None,
        items: list[dict[str, Any]],
    ) -> list[AuditLog]:
        """v0.6.3 Q-2：一次 PATCH 写 N 条同 action 的审计行（如 attribute_change），
        共享 actor/request/status_code，仅 target_id + detail 逐条不同；一次 add_all + 一次 flush。"""
        if not items:
            return []
        action_str = action.value if isinstance(action, AuditAction) else str(action)
        rid = request_id_var.get()
        method = getattr(request, "method", None)
        path = str(request.url.path) if request is not None else None
        ip = extract_client_ip(request)
        actor_id = getattr(actor, "id", None)
        actor_email = getattr(actor, "email", None)
        actor_role = getattr(actor, "role", None)
        entries: list[AuditLog] = []
        for it in items:
            entries.append(AuditLog(
                actor_id=actor_id,
                actor_email=actor_email,
                actor_role=actor_role,
                action=action_str,
                target_type=target_type,
                target_id=str(it["target_id"]) if it.get("target_id") is not None else None,
                method=method,
                path=path,
                status_code=status_code,
                ip=ip,
                detail_json=it.get("detail"),
                request_id=rid or None,
            ))
        db.add_all(entries)
        await db.flush()
        return entries
