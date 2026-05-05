"""v0.7.6 · AuditMiddleware 异步化 Celery task。

AuditMiddleware 写每条写请求一行 audit_logs，原同步 INSERT 在主请求 dispatch 后旁路 1-3ms。
本 task 把 INSERT 移出请求路径：中间件改 `persist_audit_entry.delay(payload)`，主请求 < 0.1ms。

Fallback：当 settings.audit_async = False 或 broker 不可用时，中间件回退同步路径。
本 task body 与原 _persist_audit 等价，只是从 dict 重建 AuditLog 行。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.audit.persist_audit_entry")
def persist_audit_entry(payload: dict[str, Any]) -> None:
    """把 AuditMiddleware 收集的 payload 写入 audit_logs 表。

    payload shape（与 AuditLog 列对齐）：
      {
        actor_id: str | None,
        actor_role: str | None,
        action: str,
        method: str,
        path: str,
        status_code: int,
        ip: str | None,
        request_id: str | None,
      }
    """
    asyncio.run(_async_persist(payload))


async def _async_persist(payload: dict[str, Any]) -> None:
    from uuid import UUID

    from app.db.base import async_session
    from app.db.models.audit_log import AuditLog

    actor_id_raw = payload.get("actor_id")
    actor_id: UUID | None = None
    if actor_id_raw:
        try:
            actor_id = UUID(actor_id_raw)
        except (ValueError, TypeError):
            actor_id = None

    entry = AuditLog(
        actor_id=actor_id,
        actor_email=None,
        actor_role=payload.get("actor_role"),
        action=payload["action"],
        target_type=None,
        target_id=None,
        method=payload["method"],
        path=payload["path"],
        status_code=payload["status_code"],
        ip=payload.get("ip"),
        detail_json=None,
        request_id=payload.get("request_id"),
    )
    async with async_session() as session:
        session.add(entry)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            logger.warning("persist_audit_entry commit failed action=%s", entry.action)
            raise
