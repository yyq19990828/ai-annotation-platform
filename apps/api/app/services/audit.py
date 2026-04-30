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
    SYSTEM_BOOTSTRAP_ADMIN = "system.bootstrap_admin"
    BUG_REPORT_CREATED = "bug_report.created"
    BUG_REPORT_STATUS_CHANGED = "bug_report.status_changed"
    BUG_COMMENT_CREATED = "bug_comment.created"


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
        merged_detail = {"request_id": rid, **(detail or {})} if rid else detail
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
            detail_json=merged_detail,
        )
        db.add(entry)
        await db.flush()
        return entry
