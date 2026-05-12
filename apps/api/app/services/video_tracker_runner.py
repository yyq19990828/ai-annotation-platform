from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.annotation import Annotation
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.services.video_tracker_adapters import (
    TrackerContext,
    TrackerFrameResult,
    get_tracker_adapter,
)

log = logging.getLogger(__name__)

TrackerEventPublisher = Callable[[str, dict], Awaitable[None]]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def publish_tracker_event(channel: str, payload: dict) -> None:
    redis = aioredis.from_url(settings.redis_url)
    try:
        await redis.publish(channel, json.dumps(payload))
    except Exception as exc:
        log.warning("video tracker event publish failed channel=%s err=%s", channel, exc)
    finally:
        try:
            await redis.close()
        except Exception:
            pass


def _event(job: VideoTrackerJob, type_: str, **extra: object) -> dict:
    return {
        "type": type_,
        "job_id": str(job.id),
        "task_id": str(job.task_id),
        "dataset_item_id": str(job.dataset_item_id),
        "annotation_id": str(job.annotation_id),
        "at": _now().isoformat(),
        **extra,
    }


def _normalize_bbox(geometry: dict) -> dict:
    return {
        "x": float(geometry.get("x", 0)),
        "y": float(geometry.get("y", 0)),
        "w": float(geometry.get("w", geometry.get("width", 0))),
        "h": float(geometry.get("h", geometry.get("height", 0))),
    }


def _source_keyframe(annotation: Annotation, job: VideoTrackerJob) -> dict:
    geometry = annotation.geometry or {}
    frame_index = int(geometry.get("frame_index", job.from_frame))
    return {
        "frame_index": frame_index,
        "bbox": _normalize_bbox(geometry),
        "source": "manual",
        "absent": False,
        "occluded": False,
    }


def _coerce_video_track_geometry(annotation: Annotation, job: VideoTrackerJob) -> dict:
    geometry = annotation.geometry or {}
    if geometry.get("type") == "video_track":
        return {
            "type": "video_track",
            "track_id": str(geometry.get("track_id") or annotation.id),
            "keyframes": [dict(item) for item in geometry.get("keyframes") or []],
            "outside": [dict(item) for item in geometry.get("outside") or []],
        }

    return {
        "type": "video_track",
        "track_id": str(annotation.id),
        "keyframes": [_source_keyframe(annotation, job)],
        "outside": [],
    }


def _merge_outside_ranges(existing: list[dict], frames: list[int]) -> list[dict]:
    ranges = [dict(item) for item in existing]
    if not frames:
        return ranges

    start = previous = frames[0]
    for frame_index in frames[1:]:
        if frame_index == previous + 1:
            previous = frame_index
            continue
        ranges.append({"from": start, "to": previous, "source": "prediction"})
        start = previous = frame_index
    ranges.append({"from": start, "to": previous, "source": "prediction"})
    return ranges


def apply_tracker_results(
    annotation: Annotation,
    job: VideoTrackerJob,
    results: list[TrackerFrameResult],
) -> None:
    geometry = _coerce_video_track_geometry(annotation, job)
    keyframes = geometry["keyframes"]
    manual_frames = {
        int(item.get("frame_index", 0))
        for item in keyframes
        if item.get("source", "manual") == "manual"
    }
    prediction_by_frame = {
        int(item.get("frame_index", 0)): item
        for item in keyframes
        if item.get("source") != "manual"
    }
    outside_frames: list[int] = []

    for result in results:
        if result.outside:
            outside_frames.append(result.frame_index)
            continue
        if result.frame_index in manual_frames:
            continue
        prediction_by_frame[result.frame_index] = {
            "frame_index": result.frame_index,
            "bbox": _normalize_bbox(result.geometry),
            "source": "prediction",
            "absent": False,
            "occluded": False,
        }

    merged = [
        item
        for item in keyframes
        if item.get("source", "manual") == "manual"
        or int(item.get("frame_index", 0)) not in prediction_by_frame
    ]
    merged.extend(prediction_by_frame.values())
    geometry["keyframes"] = sorted(
        merged, key=lambda item: int(item.get("frame_index", 0))
    )
    geometry["outside"] = _merge_outside_ranges(
        geometry.get("outside") or [], sorted(set(outside_frames))
    )

    annotation.geometry = geometry
    annotation.annotation_type = "video_track"
    annotation.version = int(annotation.version or 1) + 1


async def _load_job_for_update(
    db: AsyncSession, job_id: uuid.UUID
) -> VideoTrackerJob | None:
    return (
        await db.execute(
            select(VideoTrackerJob)
            .where(VideoTrackerJob.id == job_id)
            .with_for_update()
        )
    ).scalar_one_or_none()


async def _mark_failed(
    db: AsyncSession, job_id: uuid.UUID, message: str, publisher: TrackerEventPublisher
) -> VideoTrackerJob | None:
    await db.rollback()
    job = await _load_job_for_update(db, job_id)
    if job is None:
        return None
    if job.status != VideoTrackerJobStatus.CANCELLED.value:
        job.status = VideoTrackerJobStatus.FAILED.value
        job.error_message = message[:2000]
        job.completed_at = _now()
    await db.commit()
    await publisher(job.event_channel, _event(job, "job_failed", error=message))
    return job


async def run_tracker_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    publisher: TrackerEventPublisher = publish_tracker_event,
) -> VideoTrackerJob | None:
    job = await _load_job_for_update(db, job_id)
    if job is None:
        return None
    if job.status == VideoTrackerJobStatus.CANCELLED.value:
        await db.commit()
        return job
    if job.status != VideoTrackerJobStatus.QUEUED.value:
        await db.commit()
        return job

    job.status = VideoTrackerJobStatus.RUNNING.value
    job.started_at = job.started_at or _now()
    await db.commit()
    await db.refresh(job)
    await publisher(job.event_channel, _event(job, "job_started"))

    try:
        annotation = await db.get(Annotation, job.annotation_id)
        if annotation is None or not annotation.is_active:
            raise ValueError("Annotation not found")
        adapter = get_tracker_adapter(job.model_key)
        ctx = TrackerContext(
            job_id=job.id,
            dataset_item_id=job.dataset_item_id,
            annotation_id=job.annotation_id,
            from_frame=job.from_frame,
            to_frame=job.to_frame,
            direction=job.direction,
            prompt=job.prompt or {},
            source_geometry=annotation.geometry or {},
        )
        results: list[TrackerFrameResult] = []
        total = max(1, job.to_frame - job.from_frame + 1)

        for index, result in enumerate(adapter.propagate(ctx), start=1):
            await db.refresh(job)
            if (
                job.cancel_requested_at is not None
                or job.status == VideoTrackerJobStatus.CANCELLED.value
            ):
                if results:
                    apply_tracker_results(annotation, job, results)
                job.status = VideoTrackerJobStatus.CANCELLED.value
                job.completed_at = job.completed_at or _now()
                await db.commit()
                await publisher(job.event_channel, _event(job, "job_cancelled"))
                return job

            results.append(result)
            frame_payload = {
                "frame_index": result.frame_index,
                "geometry": result.geometry,
                "confidence": result.confidence,
                "outside": result.outside,
                "source": "prediction",
            }
            await publisher(
                job.event_channel, _event(job, "frame_result", **frame_payload)
            )
            await publisher(
                job.event_channel,
                _event(job, "job_progress", current=min(index, total), total=total),
            )

        await db.refresh(job)
        if job.cancel_requested_at is not None:
            if results:
                apply_tracker_results(annotation, job, results)
            job.status = VideoTrackerJobStatus.CANCELLED.value
            job.completed_at = job.completed_at or _now()
            await db.commit()
            await publisher(job.event_channel, _event(job, "job_cancelled"))
            return job

        apply_tracker_results(annotation, job, results)
        job.status = VideoTrackerJobStatus.COMPLETED.value
        job.completed_at = _now()
        await db.commit()
        await db.refresh(job)
        await publisher(job.event_channel, _event(job, "job_completed"))
        return job
    except Exception as exc:
        log.exception("video tracker job failed job_id=%s", job_id)
        return await _mark_failed(db, job_id, str(exc), publisher)
