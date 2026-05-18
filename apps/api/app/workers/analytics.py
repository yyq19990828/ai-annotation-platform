"""v0.10.16 · DuckDB 离线分析同步 Celery 任务（ROADMAP §1.6）。

每日 02:30 UTC 增量拉 task_events + audit_logs 到 DuckDB 文件，
供 /admin/analytics 端点出 3 个固定面板。
"""

from __future__ import annotations

import asyncio
import logging

from app.db.base import async_session
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="app.workers.analytics.sync_to_duckdb")
def sync_to_duckdb() -> dict:
    return asyncio.run(_sync_async())


async def _sync_async() -> dict:
    from app.services.duckdb_sync import sync_all

    async with async_session() as db:
        result = await sync_all(db)
    log.info("sync_to_duckdb: %s", result)
    return result
