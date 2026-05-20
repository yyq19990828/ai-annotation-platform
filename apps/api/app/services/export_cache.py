"""导出产物缓存服务（2026-05-20 计划 §3，阶段 2）。

- compute_cache_key：双字段指纹（max(updated_at) + count(active)），删除标注会让
  count 变化，单 max 不变也能让 key 失效。
- lookup：查未过期行；命中后对桶内对象探活（lifecycle 可能已清理）。
- record：插入一行。

调用方负责 commit（与 async_job 服务层一致）。
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.export_artifact import ExportArtifact
from app.services.storage import storage_service


def compute_cache_key(
    scope_id: uuid.UUID,
    format: str,
    include_attributes: bool,
    video_frame_mode: str,
    max_updated_at: datetime | None,
    active_count: int,
) -> str:
    """sha256 hex 指纹。scope_id 为 project_id 或 batch_id。

    max_updated_at = max(annotation.updated_at WHERE is_active AND not cancelled)，
    active_count = count(active annotation)。两者共同失效，覆盖删除标注场景。
    """
    parts = [
        str(scope_id),
        format,
        "1" if include_attributes else "0",
        video_frame_mode,
        max_updated_at.isoformat() if max_updated_at is not None else "",
        str(active_count),
    ]
    raw = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


async def lookup(
    db: AsyncSession, cache_key: str, *, bucket: str | None = None
) -> ExportArtifact | None:
    """查未过期的缓存行；命中后探活桶内对象，被 lifecycle 清掉则删行回退。

    bucket 为产物所在桶（阶段 1 引入 export 桶后由调用方传入）。
    """
    res = await db.execute(
        select(ExportArtifact).where(
            ExportArtifact.cache_key == cache_key,
            ExportArtifact.expires_at > datetime.now(timezone.utc),
        )
    )
    artifact = res.scalar_one_or_none()
    if artifact is None:
        return None

    # 探活：storage 无独立 stat_object，复用 verify_upload（head_object，miss 返回 None）。
    meta = storage_service.verify_upload(artifact.object_key, bucket=bucket)
    if meta is None:
        await db.delete(artifact)
        return None
    return artifact


async def record(
    db: AsyncSession,
    *,
    cache_key: str,
    project_id: uuid.UUID,
    batch_id: uuid.UUID | None,
    format: str,
    object_key: str,
    file_count: int,
    size_bytes: int,
    expires_at: datetime,
) -> ExportArtifact:
    """插入一条缓存行。调用方负责 commit。"""
    artifact = ExportArtifact(
        cache_key=cache_key,
        project_id=project_id,
        batch_id=batch_id,
        format=format,
        object_key=object_key,
        file_count=file_count,
        size_bytes=size_bytes,
        expires_at=expires_at,
    )
    db.add(artifact)
    await db.flush()
    return artifact
