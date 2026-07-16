"""v0.7.0 · celery beat 后台清理任务

软删评论附件 7 天 grace 期后从 MinIO 删除。MinIO bucket lifecycle 已配
180 天硬兜底，本任务作为更精确的近期清理路径。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text, update

from app.db.models.annotation_comment import AnnotationComment
from app.workers._db import task_session
from app.services.storage import storage_service
from app.services.raster_mask_storage import lock_raster_mask_references
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

    async with task_session() as db:
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


_MASK_REFERENCE_QUERIES = (
    """
    SELECT DISTINCT value #>> '{}' AS object_key
    FROM annotations, LATERAL jsonb_path_query(geometry, '$.**.object_key') value
    WHERE is_active IS TRUE AND value #>> '{}' LIKE 'raster-masks/sha256/%'
    """,
    """
    SELECT DISTINCT value #>> '{}' AS object_key
    FROM predictions, LATERAL jsonb_path_query(result, '$.**.object_key') value
    WHERE value #>> '{}' LIKE 'raster-masks/sha256/%'
    """,
    """
    SELECT DISTINCT value #>> '{}' AS object_key
    FROM video_tracker_jobs, LATERAL jsonb_path_query(staged_result, '$.**.object_key') value
    WHERE staged_result IS NOT NULL AND value #>> '{}' LIKE 'raster-masks/sha256/%'
    """,
)

_MASK_REFERENCE_EXISTS_QUERIES = (
    """
    SELECT EXISTS (
        SELECT 1
        FROM annotations, LATERAL jsonb_path_query(geometry, '$.**.object_key') value
        WHERE is_active IS TRUE AND value #>> '{}' = :key
    )
    """,
    """
    SELECT EXISTS (
        SELECT 1
        FROM predictions, LATERAL jsonb_path_query(result, '$.**.object_key') value
        WHERE value #>> '{}' = :key
    )
    """,
    """
    SELECT EXISTS (
        SELECT 1
        FROM video_tracker_jobs,
             LATERAL jsonb_path_query(staged_result, '$.**.object_key') value
        WHERE staged_result IS NOT NULL AND value #>> '{}' = :key
    )
    """,
)


async def _referenced_raster_mask_keys(db) -> set[str]:
    referenced: set[str] = set()
    for query in _MASK_REFERENCE_QUERIES:
        rows = (await db.execute(text(query))).scalars().all()
        referenced.update(str(key) for key in rows if key)
    return referenced


async def _is_raster_mask_key_referenced(db, key: str) -> bool:
    for query in _MASK_REFERENCE_EXISTS_QUERIES:
        if bool((await db.execute(text(query), {"key": key})).scalar()):
            return True
    return False


def _eligible_raster_mask_objects(
    candidates: list[dict], referenced: set[str], cutoff: datetime
) -> list[dict]:
    return [
        item
        for item in candidates
        if item["key"] not in referenced
        and item.get("last_modified") is not None
        and item["last_modified"] < cutoff
    ][:1000]


@celery_app.task(name="app.workers.cleanup.purge_unreferenced_raster_masks")
def purge_unreferenced_raster_masks(dry_run: bool = False) -> dict:
    """Delete unreferenced content-addressed mask objects after a 24-hour grace."""
    return asyncio.run(_purge_unreferenced_raster_masks_async(dry_run=dry_run))


async def _purge_unreferenced_raster_masks_async(*, dry_run: bool = False) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    async with task_session() as db:
        referenced = await _referenced_raster_mask_keys(db)
        candidates = storage_service.list_objects("raster-masks/sha256/")
        deletable = _eligible_raster_mask_objects(candidates, referenced, cutoff)
        deleted = 0
        errors = 0
        if not dry_run:
            for item in deletable:
                try:
                    key = item["key"]
                    await lock_raster_mask_references(
                        db,
                        {"object_key": key},
                        verify=False,
                    )
                    if not await _is_raster_mask_key_referenced(db, key):
                        storage_service.delete_object(key)
                        deleted += 1
                    await db.commit()
                except Exception as exc:  # noqa: BLE001 - conservative GC retains on failure
                    await db.rollback()
                    errors += 1
                    log.warning(
                        "delete unreferenced raster mask %s failed: %s",
                        item["key"],
                        exc,
                    )
    result = {
        "dry_run": dry_run,
        "referenced": len(referenced),
        "scanned": len(candidates),
        "eligible": len(deletable),
        "deleted": deleted,
        "errors": errors,
    }
    log.info("purge_unreferenced_raster_masks done: %s", result)
    return result


@celery_app.task(name="app.workers.cleanup.refresh_user_perf_mv")
def refresh_user_perf_mv() -> dict:
    """v0.8.4 · celery beat 每小时第 5 分钟触发：REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_perf_daily。

    CONCURRENTLY 要求视图上有 UNIQUE 索引；不阻塞读端。首次刷新需要 NON-CONCURRENTLY，
    迁移内已 REFRESH 一次填初始数据，所以 beat 这里直接 CONCURRENTLY 即可。
    """
    return asyncio.run(_refresh_mv_async())


async def _refresh_mv_async() -> dict:
    from sqlalchemy import text

    async with task_session() as db:
        try:
            await db.execute(
                text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_perf_daily")
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            log.warning("refresh_user_perf_mv failed: %s", exc)
            return {"refreshed": False, "error": str(exc)}
    log.info("refresh_user_perf_mv done")
    return {"refreshed": True}
