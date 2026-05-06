"""v0.8.4 · task_events 批量异步写入。

工作台前端每 N 条 flush，路由 POST /me/task-events:batch 收到后投递到此 task。
broker 不可用时调用方 fallback 同步路径。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.task_events.persist_task_events_batch")
def persist_task_events_batch(payload_list: list[dict[str, Any]]) -> None:
    """批量写入 task_events。

    单条 payload shape：
      {
        id: str (uuid),
        task_id: str,
        user_id: str,
        project_id: str,
        kind: 'annotate' | 'review',
        started_at: ISO8601,
        ended_at: ISO8601,
        duration_ms: int,
        annotation_count: int,
        was_rejected: bool,
      }
    """
    asyncio.run(_async_persist(payload_list))


async def _async_persist(payload_list: list[dict[str, Any]]) -> None:
    from app.db.base import async_session
    from app.db.models.task_event import TaskEvent

    if not payload_list:
        return

    rows: list[TaskEvent] = []
    for p in payload_list:
        try:
            rows.append(
                TaskEvent(
                    id=UUID(p["id"]) if "id" in p else None,
                    task_id=UUID(p["task_id"]),
                    user_id=UUID(p["user_id"]),
                    project_id=UUID(p["project_id"]),
                    kind=p["kind"],
                    started_at=datetime.fromisoformat(p["started_at"]),
                    ended_at=datetime.fromisoformat(p["ended_at"]),
                    duration_ms=int(p["duration_ms"]),
                    annotation_count=int(p.get("annotation_count", 0)),
                    was_rejected=bool(p.get("was_rejected", False)),
                )
            )
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("task_event payload skipped: %s payload=%s", exc, p)

    if not rows:
        return

    async with async_session() as session:
        session.add_all(rows)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            logger.warning("persist_task_events_batch commit failed n=%d", len(rows))
            raise
