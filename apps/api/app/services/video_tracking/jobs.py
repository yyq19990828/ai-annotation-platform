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
from app.services.ml_backend import MLBackendService
from app.services.raster_mask_storage import load_coco_rle
from app.services.video_frame_service import VideoContext
from app.services.video_segment_service import ensure_segments
from app.services.video_tracking.adapters import registered_tracker_models
from app.services.video_tracking import runner as _runner
from app.services.video_tracks import is_polyline_track, resolve_track_at_frame
from app.utils.raster_mask_rle import coco_rle_bbox_norm


log = logging.getLogger(__name__)

_TERMINAL_STATUSES = {
    VideoTrackerJobStatus.COMPLETED.value,
    VideoTrackerJobStatus.FAILED.value,
    VideoTrackerJobStatus.CANCELLED.value,
    # v0.21.28 · 候选/接受: 追踪已完成 (待审/已接受/已丢弃) 均不可再「取消追踪」。
    VideoTrackerJobStatus.PENDING_REVIEW.value,
    VideoTrackerJobStatus.ACCEPTED.value,
    VideoTrackerJobStatus.DISCARDED.value,
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
        (
            await db.execute(
                select(VideoSegment)
                .where(
                    VideoSegment.dataset_item_id == ctx.item.id,
                    VideoSegment.start_frame <= payload.to_frame,
                    VideoSegment.end_frame >= payload.from_frame,
                )
                .order_by(VideoSegment.segment_index.asc())
            )
        )
        .scalars()
        .all()
    )
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


def _seed_geometry_at_frame(annotation: Annotation, from_frame: int) -> dict:
    """多源 seed 的源几何: 视频轨迹取 from_frame 处的几何 (转成 backend 可解析的 result-style
    geometry), 取不到 (非轨迹 / outside / 无该帧) 则回退整条 annotation.geometry。

    backend _seed_bbox_from_video_ctx 吃 {type: bbox/polygon, ...} 或 video_track_*, 但不吃
    resolve_track_at_frame 返回的裸关键帧 (无 type、bbox 嵌套) → bbox/polygon 帧转 result-style。
    """
    geometry = annotation.geometry or {}
    resolved = resolve_track_at_frame(geometry, from_frame)
    if resolved is None:
        return geometry
    if resolved.get("points") is not None:
        return {"type": "polygon", "points": resolved["points"]}
    if resolved.get("bbox") is not None:
        return {"type": "bbox", **resolved["bbox"]}
    if resolved.get("mask") is not None:
        bbox = coco_rle_bbox_norm(load_coco_rle(resolved["mask"]))
        if bbox:
            return {"type": "bbox", **bbox}
    return geometry


async def _validate_sourceless_target(
    db: AsyncSession,
    project_id: uuid.UUID,
    class_name: str | None,
    tool_unit_id: str | None,
) -> None:
    if not class_name or not tool_unit_id:
        raise HTTPException(
            status_code=422,
            detail="Sourceless tracking requires target_class_name and target_tool_unit_id",
        )
    project = await db.get(Project, project_id)
    binding = (project.tool_bindings or {}).get(tool_unit_id) if project else None
    classes = binding.get("classes") if isinstance(binding, dict) else None
    allowed = {
        item.get("name")
        for item in (classes or [])
        if isinstance(item, dict) and item.get("name")
    }
    if (
        not isinstance(binding, dict)
        or not binding.get("enabled")
        or class_name not in allowed
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"target class '{class_name}' is not configured for tool unit "
                f"'{tool_unit_id}'"
            ),
        )


async def create_tracker_job(
    db: AsyncSession,
    *,
    task: Task,
    ctx: VideoContext,
    annotation_id: uuid.UUID | None,
    payload: VideoTrackerPropagateRequest,
    user: User,
) -> VideoTrackerJobOut:
    _assert_frame_range(ctx, payload.from_frame, payload.to_frame)
    known_models = set(registered_tracker_models()) | {"sam3_video_combo"}
    if payload.model_key not in known_models:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported tracker model: {payload.model_key}",
        )
    if payload.model_key != "mock_bbox":
        required = (
            ["sam3_video", "sam3_video_interactive"]
            if payload.model_key == "sam3_video_combo"
            else [payload.model_key]
        )
        backend = await MLBackendService(db).get_tracker_backend_for_capabilities(
            task.project_id, required
        )
        if backend is None:
            raise HTTPException(
                status_code=422,
                detail=(
                    "No connected project ML backend supports tracker model: "
                    f"{payload.model_key}"
                ),
            )
    # v0.22.2 · M · 多选批量: source_annotation_ids 有 ≥1 条 → 多源分支。各源在 from_frame 处
    # 的几何写成带 source_annotation_id + obj_id (1..N) 的 seed; annotation_id 强制 NULL (§8 ·
    # 多源不认单主, accept 各 obj 各回填各源, 见 _seed_source_map)。obj_id 与 instance_id ==
    # str(obj_id) 契约一致。单数 source_annotation_id (单源延展) / 无源路径保持现状不变。
    multi_source_ids = payload.source_annotation_ids or []
    seed_prompt: dict = {}
    if multi_source_ids:
        annotation_id = None
        seeds: list[dict] = []
        for obj_id, sid in enumerate(multi_source_ids, start=1):
            source = await _load_annotation(db, task, sid)
            if is_polyline_track(source.geometry or {}):
                raise HTTPException(status_code=400, detail="polyline 轨迹追踪暂不支持")
            seeds.append(
                {
                    "obj_id": obj_id,
                    "source_annotation_id": str(sid),
                    "geometry": _seed_geometry_at_frame(source, payload.from_frame),
                }
            )
        seed_prompt = {"seeds": seeds}
    # v0.22.1 · B · 源轨迹可选: 无源检测 (annotation_id is None) 不加载 source / 不查 polyline,
    # 新建轨迹类别由 payload.target_* 显式指定。有源延展保留 polyline 400 拒绝。
    elif annotation_id is not None:
        annotation = await _load_annotation(db, task, annotation_id)
        # polyline 轨迹追踪暂不支持: runner 只识别 polygon/bbox track, polyline 会命中 bbox
        # fallback → 原关键帧被静默改写成空 bbox 轨迹 (points 全丢), 故在入口用 400 明确拒绝。
        if is_polyline_track(annotation.geometry or {}):
            raise HTTPException(status_code=400, detail="polyline 轨迹追踪暂不支持")
    sourceless = annotation_id is None and not multi_source_ids
    if sourceless:
        await _validate_sourceless_target(
            db,
            task.project_id,
            payload.target_class_name,
            payload.target_tool_unit_id,
        )
    privileged = await _is_privileged(db, task, user)
    segment_id = await _assert_segment_lock(
        db, ctx, payload, user, privileged=privileged
    )

    # v0.22.1 · B · 无源检测 (无单主且非多源) 才存显式目标类别; 有源延展 / 多源批量各自继承源。
    row = VideoTrackerJob(
        task_id=task.id,
        dataset_item_id=ctx.item.id,
        annotation_id=annotation_id,
        target_class_name=payload.target_class_name if sourceless else None,
        target_tool_unit_id=payload.target_tool_unit_id if sourceless else None,
        segment_id=segment_id,
        created_by=user.id,
        status=VideoTrackerJobStatus.QUEUED.value,
        model_key=payload.model_key,
        direction=payload.direction,
        from_frame=payload.from_frame,
        to_frame=payload.to_frame,
        # v0.10.36 · sam_variant 存进自由 JSONB prompt (无需 DB 迁移).
        # v0.21.19 · text-driven 追踪的 text/exemplars 同样落 prompt JSONB, runner 读出后
        # 经 TrackerContext 显式字段透传到 backend (见 video_tracker_adapters context)。
        prompt={
            **(payload.prompt or {}),
            # v0.22.2 · M · 多源 seeds (各 obj_id ↔ 各源) 覆盖 payload.prompt 里同名键。
            **seed_prompt,
            **({"sam_variant": payload.sam_variant} if payload.sam_variant else {}),
            **({"text": payload.text} if payload.text else {}),
            **(
                {"output_geometry": payload.output_geometry}
                if payload.output_geometry
                else {}
            ),
            **(
                {"exemplars": [e.model_dump() for e in payload.exemplars]}
                if payload.exemplars
                else {}
            ),
        },
        event_channel="pending",
    )
    db.add(row)
    await db.flush()
    row.event_channel = f"video-tracker-job:{row.id}"
    await db.commit()
    await db.refresh(row)

    try:
        # v0.23.0 · dispatch by task name via the global Celery app instead of importing
        # the worker module, so the video_tracking domain package has no service → worker
        # reverse dependency. ``run_video_tracker_job`` is registered in app.workers.video_tracker.
        from celery import current_app

        result = current_app.send_task(
            "run_video_tracker_job", args=[str(row.id)], queue="gpu"
        )
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


async def cancel_tracker_job(db: AsyncSession, job_id: uuid.UUID) -> VideoTrackerJobOut:
    row = (
        await db.execute(
            select(VideoTrackerJob)
            .where(VideoTrackerJob.id == job_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    if row.status == VideoTrackerJobStatus.PENDING_REVIEW.value:
        # 候选待审不是"运行中"任务, 不能 cancel; 让前端据 409 引导用户改用 discard,
        # 而不是静默返回 200 让人以为取消没生效。
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Candidate awaiting review cannot be cancelled; discard it instead",
        )
    if row.status not in _TERMINAL_STATUSES:
        now = _now()
        row.status = VideoTrackerJobStatus.CANCELLED.value
        row.cancel_requested_at = row.cancel_requested_at or now
        row.completed_at = row.completed_at or now
    await db.commit()
    await db.refresh(row)
    return _job_out(row)


async def accept_tracker_job(db: AsyncSession, job_id: uuid.UUID) -> VideoTrackerJobOut:
    """v0.21.28 · 接受候选: 把 job.staged_result 应用到 annotation, status=ACCEPTED。"""
    try:
        row = await _runner.accept_tracker_job(db, job_id)
    except _runner.TrackerJobStateConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    return _job_out(row)


async def discard_tracker_job(
    db: AsyncSession, job_id: uuid.UUID
) -> VideoTrackerJobOut:
    """v0.21.28 · 丢弃候选: status=DISCARDED, 清 staged_result, annotation 零改动。"""
    try:
        row = await _runner.discard_tracker_job(db, job_id)
    except _runner.TrackerJobStateConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    return _job_out(row)


async def list_reviewable_tracker_jobs(
    db: AsyncSession,
    *,
    task: Task,
    user: User,
) -> list[VideoTrackerJobOut]:
    """Return server-side candidates that the current workbench user can resume."""
    conditions = [
        VideoTrackerJob.task_id == task.id,
        VideoTrackerJob.status.in_(
            [
                VideoTrackerJobStatus.PENDING_REVIEW.value,
                VideoTrackerJobStatus.CANCELLED.value,
            ]
        ),
        VideoTrackerJob.staged_result.is_not(None),
    ]
    if not await _is_privileged(db, task, user):
        conditions.append(VideoTrackerJob.created_by == user.id)
    rows = (
        (
            await db.execute(
                select(VideoTrackerJob)
                .where(*conditions)
                .order_by(VideoTrackerJob.created_at.desc(), VideoTrackerJob.id.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_job_out(row) for row in rows]


async def list_active_tracker_jobs(
    db: AsyncSession,
    *,
    task: Task,
    user: User,
) -> list[VideoTrackerJobOut]:
    """Return in-flight (queued/running) jobs so the workbench can reconnect their WS after reload."""
    conditions = [
        VideoTrackerJob.task_id == task.id,
        VideoTrackerJob.status.in_(
            [
                VideoTrackerJobStatus.QUEUED.value,
                VideoTrackerJobStatus.RUNNING.value,
            ]
        ),
    ]
    if not await _is_privileged(db, task, user):
        conditions.append(VideoTrackerJob.created_by == user.id)
    rows = (
        (
            await db.execute(
                select(VideoTrackerJob)
                .where(*conditions)
                .order_by(VideoTrackerJob.created_at.desc(), VideoTrackerJob.id.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_job_out(row) for row in rows]


def tracker_job_out(row: VideoTrackerJob) -> VideoTrackerJobOut:
    return _job_out(row)
