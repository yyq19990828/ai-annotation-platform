from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.dataset import VideoSegment
from app.db.models.user import User
from app.schemas.video_frame_service import VideoSegmentOut, VideoSegmentsResponse
from app.services.video_frame_service import VideoContext


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(row: VideoSegment, now: datetime) -> bool:
    return bool(row.locked_by and row.lock_expires_at and row.lock_expires_at <= now)


def _normalize_lock(row: VideoSegment, now: datetime) -> None:
    if _is_expired(row, now):
        row.locked_by = None
        row.locked_at = None
        row.lock_expires_at = None
    if row.locked_by and row.lock_expires_at and row.lock_expires_at > now:
        row.status = "locked"
    elif row.assignee_id:
        row.status = "assigned"
    elif row.status != "completed":
        row.status = "open"


def _segment_count(ctx: VideoContext) -> int:
    frame_count = int(ctx.metadata.frame_count or 1)
    size = max(1, settings.video_segment_size_frames)
    return max(1, (max(1, frame_count) + size - 1) // size)


def _segment_bounds(ctx: VideoContext, segment_index: int) -> tuple[int, int]:
    frame_count = max(1, int(ctx.metadata.frame_count or 1))
    size = max(1, settings.video_segment_size_frames)
    start = segment_index * size
    end = min(frame_count - 1, start + size - 1)
    return start, end


async def ensure_segments(db: AsyncSession, ctx: VideoContext) -> list[VideoSegment]:
    rows = (
        (
            await db.execute(
                select(VideoSegment)
                .where(VideoSegment.dataset_item_id == ctx.item.id)
                .order_by(VideoSegment.segment_index.asc())
            )
        )
        .scalars()
        .all()
    )
    if rows:
        now = _now()
        for row in rows:
            _normalize_lock(row, now)
        await db.flush()
        return list(rows)

    rows = []
    for segment_index in range(_segment_count(ctx)):
        start, end = _segment_bounds(ctx, segment_index)
        row = VideoSegment(
            dataset_item_id=ctx.item.id,
            segment_index=segment_index,
            start_frame=start,
            end_frame=end,
            status="open",
        )
        db.add(row)
        rows.append(row)
    await db.flush()
    return rows


def segment_out(row: VideoSegment) -> VideoSegmentOut:
    return VideoSegmentOut(
        id=row.id,
        segment_index=row.segment_index,
        start_frame=row.start_frame,
        end_frame=row.end_frame,
        status=row.status
        if row.status in {"open", "assigned", "locked", "completed"}
        else "open",
        assignee_id=row.assignee_id,
        locked_by=row.locked_by,
        locked_at=row.locked_at,
        lock_expires_at=row.lock_expires_at,
    )


async def list_segments(db: AsyncSession, ctx: VideoContext) -> VideoSegmentsResponse:
    rows = await ensure_segments(db, ctx)
    await db.commit()
    return VideoSegmentsResponse(
        dataset_item_id=ctx.item.id,
        task_id=ctx.task_id,
        segment_size_frames=max(1, settings.video_segment_size_frames),
        segments=[segment_out(row) for row in rows],
    )


async def _load_segment_for_update(
    db: AsyncSession, ctx: VideoContext, segment_id: uuid.UUID
) -> VideoSegment:
    row = (
        await db.execute(
            select(VideoSegment)
            .where(
                VideoSegment.id == segment_id,
                VideoSegment.dataset_item_id == ctx.item.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        await ensure_segments(db, ctx)
        row = (
            await db.execute(
                select(VideoSegment)
                .where(
                    VideoSegment.id == segment_id,
                    VideoSegment.dataset_item_id == ctx.item.id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Video segment not found")
    return row


def _assert_can_touch_lock(row: VideoSegment, user: User, privileged: bool) -> None:
    if privileged or row.locked_by is None or row.locked_by == user.id:
        return
    raise HTTPException(
        status_code=403, detail="Video segment lock belongs to another user"
    )


async def claim_segment(
    db: AsyncSession,
    ctx: VideoContext,
    segment_id: uuid.UUID,
    user: User,
    *,
    privileged: bool,
) -> VideoSegmentOut:
    row = await _load_segment_for_update(db, ctx, segment_id)
    now = _now()
    _normalize_lock(row, now)

    if row.assignee_id and row.assignee_id != user.id and not privileged:
        raise HTTPException(
            status_code=403, detail="Video segment is assigned to another user"
        )
    if row.locked_by and row.locked_by != user.id and not privileged:
        raise HTTPException(
            status_code=409, detail="Video segment is locked by another user"
        )

    row.assignee_id = row.assignee_id or user.id
    row.locked_by = user.id
    row.locked_at = now
    row.lock_expires_at = now + timedelta(
        seconds=settings.video_segment_lock_ttl_seconds
    )
    row.status = "locked"
    await db.flush()
    return segment_out(row)


async def heartbeat_segment(
    db: AsyncSession,
    ctx: VideoContext,
    segment_id: uuid.UUID,
    user: User,
    *,
    privileged: bool,
) -> VideoSegmentOut:
    row = await _load_segment_for_update(db, ctx, segment_id)
    now = _now()
    _normalize_lock(row, now)
    if row.locked_by is None:
        raise HTTPException(status_code=409, detail="Video segment is not locked")
    _assert_can_touch_lock(row, user, privileged)
    row.lock_expires_at = now + timedelta(
        seconds=settings.video_segment_lock_ttl_seconds
    )
    row.status = "locked"
    await db.flush()
    return segment_out(row)


async def release_segment(
    db: AsyncSession,
    ctx: VideoContext,
    segment_id: uuid.UUID,
    user: User,
    *,
    privileged: bool,
) -> VideoSegmentOut:
    row = await _load_segment_for_update(db, ctx, segment_id)
    now = _now()
    _normalize_lock(row, now)
    if row.locked_by is not None:
        _assert_can_touch_lock(row, user, privileged)
    row.locked_by = None
    row.locked_at = None
    row.lock_expires_at = None
    row.status = "assigned" if row.assignee_id else "open"
    await db.flush()
    return segment_out(row)
