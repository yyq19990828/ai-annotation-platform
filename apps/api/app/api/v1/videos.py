from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks import _assert_task_visible
from app.db.models.dataset import VideoFrameIndex
from app.db.models.task import Task
from app.db.models.user import User
from app.deps import get_current_user, get_db
from app.schemas.task import (
    TaskVideoFrameTimetableResponse,
    VideoFrameTimetableEntry,
)
from app.schemas.video_frame_service import (
    VideoChunkOut,
    VideoChunksResponse,
    VideoFrameOut,
    VideoFramePrefetchRequest,
    VideoFramePrefetchResponse,
    VideoFrameRetryRequest,
    VideoManifestV2Response,
    VideoSegmentsResponse,
)
from app.services.video_frame_service import (
    build_context_from_dataset_item,
    get_chunk as get_video_chunk_asset,
    get_frame as get_video_frame_asset,
    list_chunks as list_video_chunks,
    manifest_v2 as build_video_manifest_v2,
    prefetch_frames as prefetch_video_frames,
    retry_frames as retry_video_frames,
)
from app.services.video_segment_service import list_segments as list_video_segments

router = APIRouter()


async def _visible_video_task_for_item(
    db: AsyncSession, dataset_item_id: uuid.UUID, user: User
) -> Task:
    tasks = (
        await db.execute(
            select(Task).where(
                Task.dataset_item_id == dataset_item_id,
                Task.file_type == "video",
            )
        )
    ).scalars()
    for task in tasks:
        try:
            await _assert_task_visible(db, task, user)
            return task
        except HTTPException:
            continue
    raise HTTPException(status_code=404, detail="Video not found")


@router.get("/{dataset_item_id}/manifest", response_model=VideoManifestV2Response)
async def get_video_manifest(
    dataset_item_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    return await build_video_manifest_v2(db, ctx, str(request.base_url))


@router.get("/{dataset_item_id}/segments", response_model=VideoSegmentsResponse)
async def get_video_segments(
    dataset_item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    return await list_video_segments(db, ctx)


@router.get(
    "/{dataset_item_id}/frame-timetable",
    response_model=TaskVideoFrameTimetableResponse,
)
async def get_video_frame_timetable(
    dataset_item_id: uuid.UUID,
    response: Response,
    from_frame: int | None = Query(default=None, ge=0, alias="from"),
    to_frame: int | None = Query(default=None, ge=0, alias="to"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    if not ctx.metadata.fps or not ctx.metadata.frame_count:
        raise HTTPException(status_code=503, detail="Video metadata not ready")

    has_timetable = (
        await db.execute(
            select(func.count(VideoFrameIndex.id)).where(
                VideoFrameIndex.dataset_item_id == dataset_item_id
            )
        )
    ).scalar_one() > 0
    stmt = select(VideoFrameIndex).where(
        VideoFrameIndex.dataset_item_id == dataset_item_id
    )
    if from_frame is not None:
        stmt = stmt.where(VideoFrameIndex.frame_index >= from_frame)
    if to_frame is not None:
        stmt = stmt.where(VideoFrameIndex.frame_index <= to_frame)
    rows = (
        await db.execute(stmt.order_by(VideoFrameIndex.frame_index.asc()))
    ).scalars().all()
    body = TaskVideoFrameTimetableResponse(
        task_id=task.id,
        fps=ctx.metadata.fps,
        frame_count=ctx.metadata.frame_count,
        source="ffprobe" if has_timetable else "estimated",
        frames=[
            VideoFrameTimetableEntry(
                frame_index=row.frame_index,
                pts_ms=row.pts_ms,
                is_keyframe=row.is_keyframe,
                pict_type=row.pict_type,
                byte_offset=row.byte_offset,
            )
            for row in rows
        ],
    )
    response.headers["Cache-Control"] = "private, max-age=3600"
    response.headers["ETag"] = (
        f'"video-timetable:{dataset_item_id}:{ctx.metadata.frame_count}:'
        f'{len(body.frames)}:{from_frame or 0}:{to_frame or ""}"'
    )
    return body


@router.get("/{dataset_item_id}/chunks", response_model=VideoChunksResponse)
async def get_video_chunks(
    dataset_item_id: uuid.UUID,
    from_frame: int | None = Query(default=None, ge=0),
    to_frame: int | None = Query(default=None, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    return await list_video_chunks(db, ctx, from_frame, to_frame)


@router.get("/{dataset_item_id}/chunks/{chunk_id}", response_model=VideoChunkOut)
async def get_video_chunk(
    dataset_item_id: uuid.UUID,
    chunk_id: int,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    body = await get_video_chunk_asset(db, ctx, chunk_id)
    if body.status == "pending":
        response.status_code = 202
        response.headers["Retry-After"] = str(body.retry_after or 3)
    return body


@router.get("/{dataset_item_id}/frames/{frame_index}", response_model=VideoFrameOut)
async def get_video_frame(
    dataset_item_id: uuid.UUID,
    frame_index: int,
    response: Response,
    format: Literal["webp", "jpeg"] = Query(default="webp"),
    w: int = Query(default=512, ge=1, le=4096),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    body = await get_video_frame_asset(db, ctx, frame_index, w, format)
    if body.status == "pending":
        response.status_code = 202
        response.headers["Retry-After"] = str(body.retry_after or 3)
    response.headers["Cache-Control"] = (
        "private, max-age=3600" if body.status == "ready" else "no-store"
    )
    return body


@router.post(
    "/{dataset_item_id}/frames:prefetch",
    response_model=VideoFramePrefetchResponse,
)
async def prefetch_video_frame_assets(
    dataset_item_id: uuid.UUID,
    payload: VideoFramePrefetchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    return await prefetch_video_frames(
        db, ctx, payload.frame_indices, payload.width, payload.format
    )


@router.post(
    "/{dataset_item_id}/frames:retry",
    response_model=VideoFramePrefetchResponse,
)
async def retry_video_frame_assets(
    dataset_item_id: uuid.UUID,
    payload: VideoFrameRetryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _visible_video_task_for_item(db, dataset_item_id, current_user)
    ctx = await build_context_from_dataset_item(db, dataset_item_id, task=task)
    return await retry_video_frames(
        db,
        ctx,
        payload.frame_indices,
        payload.width,
        payload.format,
        force=payload.force,
    )
