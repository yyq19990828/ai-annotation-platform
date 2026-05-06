"""v0.8.1 · audit_logs 月分区维护 + 冷数据归档 Celery 任务

- ensure_future_audit_partitions: 每月 25 日 03:00 UTC，提前建好下月 / 下下月分区
- archive_old_audit_partitions: 每月 2 日 03:00 UTC，归档保留期外的分区到 MinIO
"""

from __future__ import annotations

import asyncio
import logging

from app.config import settings
from app.db.base import async_session
from app.services.audit_partition_service import AuditPartitionService
from app.workers.celery_app import celery_app


log = logging.getLogger(__name__)


@celery_app.task(name="app.workers.audit_partition.ensure_future_audit_partitions")
def ensure_future_audit_partitions(months_ahead: int = 3) -> dict:
    return asyncio.run(_ensure_async(months_ahead))


async def _ensure_async(months_ahead: int) -> dict:
    async with async_session() as db:
        created = await AuditPartitionService.ensure_future_partitions(
            db, months_ahead=months_ahead
        )
        await db.commit()
    log.info("ensure_future_audit_partitions: created=%d %s", len(created), created)
    return {"created": created}


@celery_app.task(name="app.workers.audit_partition.archive_old_audit_partitions")
def archive_old_audit_partitions() -> dict:
    retain = int(getattr(settings, "audit_retention_months", None) or 12)
    return asyncio.run(_archive_async(retain))


async def _archive_async(retain_months: int) -> dict:
    async with async_session() as db:
        result = await AuditPartitionService.archive_old_partitions(
            db, retain_months=retain_months
        )
        await db.commit()
    log.info("archive_old_audit_partitions: %s", result)
    return result
