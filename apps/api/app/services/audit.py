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
    BATCH_RESET_TO_DRAFT = "batch.reset_to_draft"
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
    # v0.7.8 · 导出审计 + 会话管理
    PROJECT_EXPORT = "project.export"
    BATCH_EXPORT = "batch.export"
    AUTH_LOGOUT = "auth.logout"
    AUTH_LOGOUT_ALL = "auth.logout_all"
    # v0.8.1 · 系统设置 / 改密 / 注销 / 审计归档
    SYSTEM_SETTINGS_UPDATE = "system.settings_update"
    USER_PASSWORD_ADMIN_RESET = "user.password_admin_reset"
    USER_DEACTIVATION_REQUEST = "user.deactivation_request"
    USER_DEACTIVATION_CANCEL = "user.deactivation_cancel"
    USER_DEACTIVATION_APPROVE = "user.deactivation_approve"
    AUDIT_ARCHIVE = "audit.archive"
    USER_EXPORT = "user.export"
    AUDIT_LOG_EXPORT = "audit.export"


def extract_client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def export_detail(
    *,
    actor: User | None,
    request: Request | None,
    base: dict[str, Any] | None = None,
    filter_criteria: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """v0.8.1 · 数据导出审计 detail 标准化扩展。

    在已有 {format, count/rows} 之上叠加 actor_email / ip / request_id / filter_criteria。
    actor_email / ip 与 audit_logs 的列冗余，但 detail_json 写入便于后续 JSONB 查询 +
    归档 jsonl 离线检索（不依赖外键 join）。
    """
    out: dict[str, Any] = dict(base or {})
    out.setdefault("actor_email", getattr(actor, "email", None))
    out.setdefault("ip", extract_client_ip(request))
    out.setdefault("request_id", request_id_var.get() or None)
    if filter_criteria is not None:
        out["filter_criteria"] = filter_criteria
    return out


def export_metadata_header(
    *,
    actor: User | None,
    fmt: str,
    request: Request | None = None,
) -> str:
    """v0.8.1 · CSV / JSON 导出文件首部注释行（不引入新依赖）。

    用于在 CSV 第一行 / JSON 顶部插入审计可追溯信息：导出人 / 时间戳 / Request ID。
    JSON 走 `_export_meta` 顶层字段；CSV 走 `# ...` 注释行（标准 CSV 解析器会忽略，
    Excel / pandas read_csv(comment='#') 也支持）。
    """
    from datetime import datetime, timezone

    actor_email = getattr(actor, "email", None) or "anonymous"
    rid = request_id_var.get() or ""
    ts = datetime.now(timezone.utc).isoformat()
    if fmt == "json":
        # 调用方拿到字符串后自行包装；这里返回 dict 形式更通用
        return ""
    return (
        f"# Exported by: {actor_email}\n"
        f"# Exported at: {ts}\n"
        f"# Request ID: {rid}\n"
    )


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
            entries.append(
                AuditLog(
                    actor_id=actor_id,
                    actor_email=actor_email,
                    actor_role=actor_role,
                    action=action_str,
                    target_type=target_type,
                    target_id=str(it["target_id"])
                    if it.get("target_id") is not None
                    else None,
                    method=method,
                    path=path,
                    status_code=status_code,
                    ip=ip,
                    detail_json=it.get("detail"),
                    request_id=rid or None,
                )
            )
        db.add_all(entries)
        await db.flush()
        return entries
