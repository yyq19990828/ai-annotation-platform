from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import VideoSegment
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.schemas.video_tracker_job import (
    VideoTrackerJobOut,
    VideoTrackerPropagateRequest,
)
from app.services.scheduler import is_privileged_for_project
from app.services.video_frame_service import VideoContext
from app.services.video_segment_service import ensure_segments


log = logging.getLogger(__name__)

_TERMINAL_STATUSES = {
    VideoTrackerJobStatus.COMPLETED.value,
    VideoTrackerJobStatus.FAILED.value,
    VideoTrackerJobStatus.CANCELLED.value,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _assert_frame_range(ctx: VideoContext, from_frame: int, to_frame: int) -> None:
    if from_frame > to_frame:
        raise HTTPException(status_code=400, detail="Invalid frame range")
    if not ctx.metadata.frame_count:
        raise HTTPException(status_code=503, detail="Video metadata not ready")
    last_frame = max(0, int(ctx.metadata.frame_count) - 1)
    if to_frame > last_frame:
        raise HTTPException(status_code=400, detail="Frame range exceeds video length")


async def _load_annotation(
    db: AsyncSession, task: Task, annotation_id: uuid.UUID
) -> Annotation:
    annotation = await db.get(Annotation, annotation_id)
    if annotation is None or not annotation.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if annotation.task_id != task.id:
        raise HTTPException(
            status_code=400, detail="Annotation does not belong to this task"
        )
    return annotation


async def _is_privileged(db: AsyncSession, task: Task, user: User) -> bool:
    project = await db.get(Project, task.project_id)
    return bool(project and is_privileged_for_project(user, project))


def _lock_valid_for_user(row: VideoSegment, user: User, now: datetime) -> bool:
    return bool(
        row.locked_by == user.id
        and row.lock_expires_at is not None
        and row.lock_expires_at > now
    )


async def _assert_segment_lock(
    db: AsyncSession,
    ctx: VideoContext,
    payload: VideoTrackerPropagateRequest,
    user: User,
    *,
    privileged: bool,
) -> uuid.UUID:
    await ensure_segments(db, ctx)
    now = _now()

    if payload.segment_id is not None:
        segment = (
            await db.execute(
                select(VideoSegment).where(
                    VideoSegment.id == payload.segment_id,
                    VideoSegment.dataset_item_id == ctx.item.id,
                )
            )
        ).scalar_one_or_none()
        if segment is None:
            raise HTTPException(status_code=404, detail="Video segment not found")
        if (
            payload.from_frame < segment.start_frame
            or payload.to_frame > segment.end_frame
        ):
            raise HTTPException(
                status_code=400, detail="Frame range is outside the video segment"
            )
        if not privileged and not _lock_valid_for_user(segment, user, now):
            raise HTTPException(
                status_code=409, detail="Video segment must be locked by current user"
            )
        return segment.id

    overlapping = (
        await db.execute(
            select(VideoSegment)
            .where(
                VideoSegment.dataset_item_id == ctx.item.id,
                VideoSegment.start_frame <= payload.to_frame,
                VideoSegment.end_frame >= payload.from_frame,
            )
            .order_by(VideoSegment.segment_index.asc())
        )
    ).scalars().all()
    if not overlapping:
        raise HTTPException(status_code=404, detail="Video segment not found")
    if len(overlapping) > 1:
        raise HTTPException(status_code=400, detail="Frame range crosses segments")
    if not privileged and not _lock_valid_for_user(overlapping[0], user, now):
        raise HTTPException(
            status_code=409, detail="Video segment must be locked by current user"
        )
    return overlapping[0].id


def _job_out(row: VideoTrackerJob) -> VideoTrackerJobOut:
    return VideoTrackerJobOut.model_validate(row, from_attributes=True)


async def create_tracker_job(
    db: AsyncSession,
    *,
    task: Task,
    ctx: VideoContext,
    annotation_id: uuid.UUID,
    payload: VideoTrackerPropagateRequest,
    user: User,
) -> VideoTrackerJobOut:
    _assert_frame_range(ctx, payload.from_frame, payload.to_frame)
    await _load_annotation(db, task, annotation_id)
    privileged = await _is_privileged(db, task, user)
    segment_id = await _assert_segment_lock(
        db, ctx, payload, user, privileged=privileged
    )

    row = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=ctx.item.id,
        annotation_id=annotation_id,
        segment_id=segment_id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key=payload.model_key,
        direction=payload.direction,
        from_frame=payload.from_frame,
        to_frame=payload.to_frame,
        prompt=payload.prompt,
        event_channel="pending",
    )
    db.add(row)
    await db.flush()
    row.event_channel = f"video-tracker-job:{row.id}"
    await db.commit()
    await db.refresh(row)

    try:
        from app.workers.video_tracker import run_video_tracker_job

        result = run_video_tracker_job.delay(str(row.id))
        row.celery_task_id = result.id
        await db.commit()
        await db.refresh(row)
    except Exception as exc:
        log.warning("video tracker job enqueue failed job_id=%s err=%s", row.id, exc)

    return _job_out(row)


async def get_tracker_job(db: AsyncSession, job_id: uuid.UUID) -> VideoTrackerJob:
    row = await db.get(VideoTrackerJob, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    return row


async def cancel_tracker_job(
    db: AsyncSession, job_id: uuid.UUID
) -> VideoTrackerJobOut:
    row = (
        await db.execute(
            select(VideoTrackerJob)
            .where(VideoTrackerJob.id == job_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    if row.status not in _TERMINAL_STATUSES:
        now = _now()
        row.status = VideoTrackerJobStatus.CANCELLED.value
        row.cancel_requested_at = row.cancel_requested_at or now
        row.completed_at = row.completed_at or now
    await db.commit()
    await db.refresh(row)
    return _job_out(row)


def tracker_job_out(row: VideoTrackerJob) -> VideoTrackerJobOut:
    return _job_out(row)
