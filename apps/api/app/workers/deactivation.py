"""v0.8.1 · 自助注销冷静期到期任务

每日 04:00 UTC 触发：扫描 deactivation_scheduled_at <= now 的活跃用户，
执行软删 + GDPR 脱敏 + 清三字段 + 通知所有 super_admin。
"""

from __future__ import annotations

import asyncio
import logging

from app.db.base import async_session
from app.services.deactivation_service import DeactivationService
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="app.workers.deactivation.process_deactivation_requests")
def process_deactivation_requests() -> dict:
    return asyncio.run(_process_async())


async def _process_async() -> dict:
    async with async_session() as db:
        n = await DeactivationService.execute_due(db)
        await db.commit()
    log.info("process_deactivation_requests done: processed=%d", n)
    return {"processed": n}
