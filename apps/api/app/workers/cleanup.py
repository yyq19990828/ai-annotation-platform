"""v0.7.0 · celery beat 后台清理任务

软删评论附件 7 天 grace 期后从 MinIO 删除。MinIO bucket lifecycle 已配
180 天硬兜底，本任务作为更精确的近期清理路径。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.db.base import async_session
from app.db.models.annotation_comment import AnnotationComment
from app.services.storage import storage_service
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="app.workers.cleanup.purge_soft_deleted_attachments")
def purge_soft_deleted_attachments() -> dict:
    """v0.7.0 · celery beat 每日 03:00 UTC 触发：扫 7 天前软删的评论附件并从 MinIO 删除。

    每次最多处理 500 条；硬删除完成后把 attachments 字段置为 [] 避免重复扫。
    """
    return asyncio.run(_purge_async())


async def _purge_async() -> dict:
    """实际的清理逻辑（async）。"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    deleted_objects = 0
    processed_comments = 0

    async with async_session() as db:
        result = await db.execute(
            select(AnnotationComment)
            .where(
                AnnotationComment.is_active.is_(False),
                AnnotationComment.updated_at < cutoff,
            )
            .limit(500)
        )
        comments = list(result.scalars().all())

        for comment in comments:
            attachments = comment.attachments or []
            if not attachments:
                continue
            for att in attachments:
                key = att.get("storage_key") if isinstance(att, dict) else None
                if not key:
                    continue
                try:
                    storage_service.delete_object(key)
                    deleted_objects += 1
                except Exception as e:
                    log.warning("delete object %s failed: %s", key, e)
            # 标记已清空，避免下次重复扫
            await db.execute(
                update(AnnotationComment)
                .where(AnnotationComment.id == comment.id)
                .values(attachments=[])
            )
            processed_comments += 1

        await db.commit()

    log.info(
        "purge_soft_deleted_attachments done: comments=%d objects=%d",
        processed_comments,
        deleted_objects,
    )
    return {"comments": processed_comments, "objects": deleted_objects}
