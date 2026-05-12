from __future__ import annotations

import io
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.dataset import (
    DatasetItem,
    VideoChunk,
    VideoFrameCache,
    VideoFrameIndex,
)
from app.db.models.task import Task
from app.observability.metrics import VIDEO_CHUNK_REQUESTS_TOTAL, VIDEO_FRAME_CACHE_TOTAL
from app.schemas.task import VideoMetadata
from app.schemas.video_frame_service import (
    VideoChunkOut,
    VideoChunksResponse,
    VideoFrameOut,
    VideoFramePrefetchResponse,
    VideoManifestV2Response,
)
from app.services.storage import storage_service


FrameFormat = Literal["webp", "jpeg"]
_FRAME_ARRAY_CACHE: OrderedDict[tuple[uuid.UUID, int, int, str], Any] = OrderedDict()


@dataclass(frozen=True)
class VideoContext:
    item: DatasetItem
    metadata: VideoMetadata
    task: Task | None = None

    @property
    def task_id(self) -> uuid.UUID | None:
        return self.task.id if self.task else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _video_meta(item: DatasetItem) -> VideoMetadata:
    raw = (item.metadata_ or {}).get("video") or {}
    return VideoMetadata.model_validate(raw)


def _ensure_video_item(item: DatasetItem | None) -> DatasetItem:
    if not item or item.file_type != "video":
        raise HTTPException(status_code=404, detail="Video not found")
    return item


def _metadata_ready(metadata: VideoMetadata) -> None:
    if not metadata.fps or not metadata.frame_count:
        raise HTTPException(status_code=503, detail="Video metadata not ready")


def _safe_frame_range(
    metadata: VideoMetadata, from_frame: int | None, to_frame: int | None
) -> tuple[int, int]:
    _metadata_ready(metadata)
    last_frame = max(0, int(metadata.frame_count or 1) - 1)
    start = 0 if from_frame is None else max(0, from_frame)
    end = last_frame if to_frame is None else min(last_frame, to_frame)
    if end < start:
        raise HTTPException(status_code=400, detail="Invalid frame range")
    return start, end


def _chunk_ids_for_range(start: int, end: int) -> list[int]:
    size = max(1, settings.video_chunk_size_frames)
    return list(range(start // size, end // size + 1))


def _chunk_bounds(chunk_id: int, metadata: VideoMetadata) -> tuple[int, int]:
    _metadata_ready(metadata)
    size = max(1, settings.video_chunk_size_frames)
    start = chunk_id * size
    end = min(int(metadata.frame_count or 1) - 1, start + size - 1)
    return start, end


def _estimated_pts_ms(frame_index: int, metadata: VideoMetadata) -> int | None:
    if not metadata.fps:
        return None
    return int(round((frame_index / metadata.fps) * 1000))


def _source_key(item: DatasetItem, metadata: VideoMetadata) -> str:
    return metadata.playback_path or item.file_path


def _asset_url(key: str) -> str:
    try:
        return storage_service.generate_download_url(
            key,
            expires_in=3600,
            bucket=storage_service.datasets_bucket,
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=503, detail="Video storage unavailable") from exc


async def build_context_from_task(db: AsyncSession, task: Task) -> VideoContext:
    if task.file_type != "video" or not task.dataset_item_id:
        raise HTTPException(status_code=400, detail="Task is not a video task")
    item = _ensure_video_item(await db.get(DatasetItem, task.dataset_item_id))
    return VideoContext(item=item, metadata=_video_meta(item), task=task)


async def build_context_from_dataset_item(
    db: AsyncSession, dataset_item_id: uuid.UUID, task: Task | None = None
) -> VideoContext:
    item = _ensure_video_item(await db.get(DatasetItem, dataset_item_id))
    return VideoContext(item=item, metadata=_video_meta(item), task=task)


async def pts_ms_for_frame(
    db: AsyncSession, dataset_item_id: uuid.UUID, frame_index: int, metadata: VideoMetadata
) -> int | None:
    row = (
        await db.execute(
            select(VideoFrameIndex.pts_ms).where(
                VideoFrameIndex.dataset_item_id == dataset_item_id,
                VideoFrameIndex.frame_index == frame_index,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return int(row)
    return _estimated_pts_ms(frame_index, metadata)


async def _ensure_chunk_rows(
    db: AsyncSession, ctx: VideoContext, chunk_ids: list[int]
) -> list[VideoChunk]:
    existing = {
        row.chunk_id: row
        for row in (
            await db.execute(
                select(VideoChunk).where(
                    VideoChunk.dataset_item_id == ctx.item.id,
                    VideoChunk.chunk_id.in_(chunk_ids),
                )
            )
        )
        .scalars()
        .all()
    }
    rows: list[VideoChunk] = []
    for chunk_id in chunk_ids:
        row = existing.get(chunk_id)
        if row is None:
            start, end = _chunk_bounds(chunk_id, ctx.metadata)
            row = VideoChunk(
                dataset_item_id=ctx.item.id,
                chunk_id=chunk_id,
                start_frame=start,
                end_frame=end,
                start_pts_ms=await pts_ms_for_frame(
                    db, ctx.item.id, start, ctx.metadata
                ),
                end_pts_ms=await pts_ms_for_frame(db, ctx.item.id, end, ctx.metadata),
                status="pending",
            )
            db.add(row)
        rows.append(row)
    await db.flush()
    return rows


def _chunk_out(row: VideoChunk) -> VideoChunkOut:
    status = row.status if row.status in {"pending", "ready", "failed"} else "pending"
    url = _asset_url(row.storage_key) if status == "ready" and row.storage_key else None
    generation_mode = (
        row.generation_mode
        if row.generation_mode in {"smart_copy", "transcode"}
        else None
    )
    VIDEO_CHUNK_REQUESTS_TOTAL.labels(status=status).inc()
    return VideoChunkOut(
        chunk_id=row.chunk_id,
        start_frame=row.start_frame,
        end_frame=row.end_frame,
        status=status,
        url=url,
        byte_size=row.byte_size,
        generation_mode=generation_mode,
        diagnostics=row.diagnostics or None,
        retry_after=3 if status == "pending" else None,
        error=row.error if status == "failed" else None,
    )


async def list_chunks(
    db: AsyncSession,
    ctx: VideoContext,
    from_frame: int | None,
    to_frame: int | None,
) -> VideoChunksResponse:
    start, end = _safe_frame_range(ctx.metadata, from_frame, to_frame)
    rows = await _ensure_chunk_rows(db, ctx, _chunk_ids_for_range(start, end))
    missing = [r.chunk_id for r in rows if r.status != "ready"]
    now = _now()
    for row in rows:
        row.last_accessed_at = now
    await db.commit()

    if missing:
        from app.workers.media import ensure_video_chunks

        ensure_video_chunks.delay(str(ctx.item.id), missing)

    return VideoChunksResponse(
        dataset_item_id=ctx.item.id,
        task_id=ctx.task_id,
        chunk_size_frames=settings.video_chunk_size_frames,
        fallback_video_url=_asset_url(_source_key(ctx.item, ctx.metadata)),
        chunks=[_chunk_out(row) for row in rows],
    )


async def get_chunk(db: AsyncSession, ctx: VideoContext, chunk_id: int) -> VideoChunkOut:
    _metadata_ready(ctx.metadata)
    row = (
        await db.execute(
            select(VideoChunk).where(
                VideoChunk.dataset_item_id == ctx.item.id,
                VideoChunk.chunk_id == chunk_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        rows = await _ensure_chunk_rows(db, ctx, [chunk_id])
        row = rows[0]
    row.last_accessed_at = _now()
    await db.commit()
    if row.status != "ready":
        from app.workers.media import ensure_video_chunks

        ensure_video_chunks.delay(str(ctx.item.id), [chunk_id])
    return _chunk_out(row)


async def _ensure_frame_row(
    db: AsyncSession,
    ctx: VideoContext,
    frame_index: int,
    width: int,
    format_: FrameFormat,
) -> VideoFrameCache:
    _safe_frame_range(ctx.metadata, frame_index, frame_index)
    row = (
        await db.execute(
            select(VideoFrameCache).where(
                VideoFrameCache.dataset_item_id == ctx.item.id,
                VideoFrameCache.frame_index == frame_index,
                VideoFrameCache.width == width,
                VideoFrameCache.format == format_,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = VideoFrameCache(
            dataset_item_id=ctx.item.id,
            frame_index=frame_index,
            width=width,
            format=format_,
            status="pending",
        )
        db.add(row)
    row.last_accessed_at = _now()
    await db.flush()
    return row


def _frame_out(row: VideoFrameCache) -> VideoFrameOut:
    status = row.status if row.status in {"pending", "ready", "failed"} else "pending"
    result = "hit" if status == "ready" else "miss"
    VIDEO_FRAME_CACHE_TOTAL.labels(result=result, format=row.format).inc()
    format_: FrameFormat = "jpeg" if row.format == "jpeg" else "webp"
    return VideoFrameOut(
        frame_index=row.frame_index,
        width=row.width,
        format=format_,
        status=status,
        url=_asset_url(row.storage_key) if status == "ready" and row.storage_key else None,
        retry_after=3 if status == "pending" else None,
        error=row.error if status == "failed" else None,
    )


async def get_frame(
    db: AsyncSession,
    ctx: VideoContext,
    frame_index: int,
    width: int,
    format_: FrameFormat,
) -> VideoFrameOut:
    row = await _ensure_frame_row(db, ctx, frame_index, width, format_)
    await db.commit()
    if row.status != "ready":
        from app.workers.media import extract_video_frames

        extract_video_frames.delay(
            str(ctx.item.id),
            [{"frame_index": frame_index, "width": width, "format": format_}],
        )
    return _frame_out(row)


async def prefetch_frames(
    db: AsyncSession,
    ctx: VideoContext,
    frame_indices: list[int],
    width: int,
    format_: FrameFormat,
) -> VideoFramePrefetchResponse:
    rows = [
        await _ensure_frame_row(db, ctx, frame_index, width, format_)
        for frame_index in sorted(set(frame_indices))
    ]
    missing = [
        {"frame_index": row.frame_index, "width": row.width, "format": row.format}
        for row in rows
        if row.status != "ready"
    ]
    await db.commit()
    if missing:
        from app.workers.media import extract_video_frames

        extract_video_frames.delay(str(ctx.item.id), missing)
    return VideoFramePrefetchResponse(
        dataset_item_id=ctx.item.id,
        task_id=ctx.task_id,
        frames=[_frame_out(row) for row in rows],
    )


async def retry_frames(
    db: AsyncSession,
    ctx: VideoContext,
    frame_indices: list[int],
    width: int,
    format_: FrameFormat,
    *,
    force: bool = False,
) -> VideoFramePrefetchResponse:
    normalized = sorted(set(frame_indices))
    if normalized:
        if force:
            rows = [
                await _ensure_frame_row(db, ctx, frame_index, width, format_)
                for frame_index in normalized
            ]
        else:
            rows = (
                (
                    await db.execute(
                        select(VideoFrameCache)
                        .where(
                            VideoFrameCache.dataset_item_id == ctx.item.id,
                            VideoFrameCache.frame_index.in_(normalized),
                            VideoFrameCache.width == width,
                            VideoFrameCache.format == format_,
                            VideoFrameCache.status == "failed",
                        )
                        .order_by(VideoFrameCache.frame_index.asc())
                    )
                )
                .scalars()
                .all()
            )
    else:
        rows = (
            (
                await db.execute(
                    select(VideoFrameCache)
                    .where(
                        VideoFrameCache.dataset_item_id == ctx.item.id,
                        VideoFrameCache.width == width,
                        VideoFrameCache.format == format_,
                        VideoFrameCache.status == "failed",
                    )
                    .order_by(VideoFrameCache.frame_index.asc())
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )

    now = _now()
    requests = []
    for row in rows:
        row.status = "pending"
        row.error = None
        row.last_accessed_at = now
        if force:
            row.storage_key = None
            row.byte_size = None
        requests.append(
            {"frame_index": row.frame_index, "width": row.width, "format": row.format}
        )
    await db.commit()

    if requests:
        from app.workers.media import extract_video_frames

        extract_video_frames.delay(str(ctx.item.id), requests)

    return VideoFramePrefetchResponse(
        dataset_item_id=ctx.item.id,
        task_id=ctx.task_id,
        frames=[_frame_out(row) for row in rows],
    )


async def manifest_v2(
    db: AsyncSession, ctx: VideoContext, base_url: str
) -> VideoManifestV2Response:
    _metadata_ready(ctx.metadata)
    from app.services.video_segment_service import ensure_segments, segment_out

    segment_rows = await ensure_segments(db, ctx)
    await db.commit()
    base = base_url.rstrip("/")
    if ctx.task_id:
        service_base = f"{base}/api/v1/tasks/{ctx.task_id}/video"
        chunks_url = f"{service_base}/chunks"
        timetable_url = f"{service_base}/frame-timetable"
        frame_base = f"{service_base}/frames"
    else:
        service_base = f"{base}/api/v1/videos/{ctx.item.id}"
        chunks_url = f"{service_base}/chunks"
        timetable_url = f"{service_base}/frame-timetable"
        frame_base = f"{service_base}/frames"

    poster_key = ctx.metadata.poster_frame_path or ctx.item.thumbnail_path
    return VideoManifestV2Response(
        task_id=ctx.task_id,
        dataset_item_id=ctx.item.id,
        video_url=_asset_url(_source_key(ctx.item, ctx.metadata)),
        poster_url=_asset_url(poster_key) if poster_key else None,
        fps=ctx.metadata.fps,
        frame_count=ctx.metadata.frame_count,
        duration_ms=ctx.metadata.duration_ms,
        chunks_manifest_url=chunks_url,
        frame_timetable_url=timetable_url,
        frame_service_base=frame_base,
        chunk_size_frames=settings.video_chunk_size_frames,
        segments=[segment_out(row) for row in segment_rows],
    )


def cache_key_for_frame(
    dataset_item_id: uuid.UUID, frame_index: int, width: int, format_: str
) -> str:
    return f"videos/{dataset_item_id}/frames/{frame_index}_{width}.{format_}"


def cache_key_for_chunk(dataset_item_id: uuid.UUID, chunk_id: int) -> str:
    return f"videos/{dataset_item_id}/chunks/{chunk_id}.mp4"


def source_key_for_item(item: DatasetItem) -> str:
    return _source_key(item, _video_meta(item))


def metadata_for_item(item: DatasetItem) -> VideoMetadata:
    return _video_meta(item)


def put_frame_array_cache(
    dataset_item_id: uuid.UUID, frame_index: int, width: int, format_: str, array: Any
) -> None:
    key = (dataset_item_id, frame_index, width, format_)
    _FRAME_ARRAY_CACHE[key] = array
    _FRAME_ARRAY_CACHE.move_to_end(key)
    while len(_FRAME_ARRAY_CACHE) > max(0, settings.video_frame_memory_cache_items):
        _FRAME_ARRAY_CACHE.popitem(last=False)


def get_frame_array_cache(
    dataset_item_id: uuid.UUID, frame_index: int, width: int, format_: str
) -> Any | None:
    key = (dataset_item_id, frame_index, width, format_)
    array = _FRAME_ARRAY_CACHE.get(key)
    if array is not None:
        _FRAME_ARRAY_CACHE.move_to_end(key)
    return array


def image_bytes_to_array(data: bytes) -> Any:
    from PIL import Image
    import numpy as np

    with Image.open(io.BytesIO(data)) as img:
        return np.asarray(img.convert("RGB"))


async def get_frame_array(
    db: AsyncSession,
    dataset_item_id: uuid.UUID,
    frame_index: int,
    width: int = 512,
    format_: FrameFormat = "webp",
) -> Any:
    cached = get_frame_array_cache(dataset_item_id, frame_index, width, format_)
    if cached is not None:
        return cached
    row = (
        await db.execute(
            select(VideoFrameCache).where(
                VideoFrameCache.dataset_item_id == dataset_item_id,
                VideoFrameCache.frame_index == frame_index,
                VideoFrameCache.width == width,
                VideoFrameCache.format == format_,
                VideoFrameCache.status == "ready",
            )
        )
    ).scalar_one_or_none()
    if row is None or not row.storage_key:
        raise RuntimeError("video frame is not cached")
    resp = storage_service.client.get_object(
        Bucket=storage_service.datasets_bucket,
        Key=row.storage_key,
    )
    array = image_bytes_to_array(resp["Body"].read())
    put_frame_array_cache(dataset_item_id, frame_index, width, format_, array)
    return array
