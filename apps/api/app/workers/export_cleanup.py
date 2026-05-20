"""v0.10.27 · export_artifacts 过期清理（计划 §3）。

每日 04:30 UTC 删 expires_at 已过期的缓存行，与 export 桶 7d lifecycle 对齐
（桶内对象由 lifecycle 自动清，这里清 DB 索引行避免命中后探活失败再删的滞后）。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import delete

from app.db.base import async_session
from app.db.models.export_artifact import ExportArtifact
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(
    name="app.workers.export_cleanup.purge_expired_export_artifacts"
)
def purge_expired_export_artifacts() -> dict:
    return asyncio.run(_purge_async())


async def _purge_async() -> dict:
    now = datetime.now(timezone.utc)
    async with async_session() as db:
        stmt = (
            delete(ExportArtifact)
            .where(ExportArtifact.expires_at < now)
            .returning(ExportArtifact.id)
        )
        res = await db.execute(stmt)
        ids = [str(row[0]) for row in res.all()]
        await db.commit()
    log.info("purge_expired_export_artifacts: removed=%d now=%s", len(ids), now.isoformat())
    return {"removed": len(ids), "now": now.isoformat()}
