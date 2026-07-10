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
from app.db.models.dataset import DatasetItem
from app.db.models.task import Task
from app.db.models.video_tracker_job import VideoTrackerJob, VideoTrackerJobStatus
from app.services.annotation_propagation import _new_track_id
from app.services.ml_backend import MLBackendService
from app.services.video_tracker_adapters import (
    TrackerContext,
    TrackerFrameResult,
    get_tracker_adapter,
)
from app.services.video_tracks import is_polygon_track

log = logging.getLogger(__name__)

TrackerEventPublisher = Callable[[str, dict], Awaitable[None]]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def publish_tracker_event(channel: str, payload: dict) -> None:
    redis = aioredis.from_url(settings.redis_url)
    try:
        await redis.publish(channel, json.dumps(payload))
    except Exception as exc:
        log.warning(
            "video tracker event publish failed channel=%s err=%s", channel, exc
        )
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


def _normalize_points(geometry: dict) -> list[list[float]]:
    """result geometry ({type:"polygon", points:[[x,y],...]}) → 归一化顶点列表。"""
    points = geometry.get("points") or []
    return [[float(p[0]), float(p[1])] for p in points if len(p) >= 2]


def _tracker_windows(job: VideoTrackerJob) -> list[tuple[int, int]]:
    size = max(1, int(settings.video_tracker_window_size_frames))
    # sam3_video(sam3.1_multiplex)视频前向显存随窗口线性增长, 远重于 sam2 seed-bbox,
    # 大窗会 OOM@24GB。给它单独更小的窗口, 不动 sam2 的窗口(避免回归其长程记忆)。
    if job.model_key == "sam3_video":
        size = min(size, max(1, int(settings.video_tracker_sam3_window_size_frames)))
    windows = []
    start = job.from_frame
    while start <= job.to_frame:
        end = min(job.to_frame, start + size - 1)
        windows.append((start, end))
        start = end + 1
    if job.direction == "backward":
        windows.reverse()
    return windows


def _source_keyframe(annotation: Annotation, job: VideoTrackerJob) -> dict:
    geometry = annotation.geometry or {}
    frame_index = int(geometry.get("frame_index", job.from_frame))
    return {
        "frame_index": frame_index,
        "bbox": _normalize_bbox(geometry),
        "source": "manual",
        "occluded": False,
    }


def _coerce_video_track_geometry(annotation: Annotation, job: VideoTrackerJob) -> dict:
    geometry = annotation.geometry or {}
    # v0.21.20 · polygon track: 保留 points 关键帧 + 类型, 回填走多边形路径。
    if geometry.get("type") == "video_track_polygon":
        return {
            "type": "video_track_polygon",
            "track_id": str(geometry.get("track_id") or annotation.id),
            "keyframes": [dict(item) for item in geometry.get("keyframes") or []],
            "outside": [dict(item) for item in geometry.get("outside") or []],
        }
    if geometry.get("type") == "video_track_bbox":
        return {
            "type": "video_track_bbox",
            "track_id": str(geometry.get("track_id") or annotation.id),
            "keyframes": [dict(item) for item in geometry.get("keyframes") or []],
            "outside": [dict(item) for item in geometry.get("outside") or []],
        }

    return {
        "type": "video_track_bbox",
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
    grid_step: int = 1,
) -> None:
    geometry = _coerce_video_track_geometry(annotation, job)
    is_polygon = geometry.get("type") == "video_track_polygon"
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
        # 采样开启时只回填落在网格上的帧（D2：tracker 仍逐源帧算并用于跨窗续追，
        # 但只持久化网格帧，与导航/导出网格一致，避免编辑器里堆满够不到的关键帧）。
        if grid_step > 1 and result.frame_index % grid_step != 0:
            continue
        if result.outside:
            outside_frames.append(result.frame_index)
            prediction_by_frame.pop(result.frame_index, None)
            continue
        if result.frame_index in manual_frames:
            continue
        if is_polygon:
            points = _normalize_points(result.geometry)
            if len(points) < 3:
                # 退化多边形(顶点<3)当 outside 处理, 避免写坏 schema。
                outside_frames.append(result.frame_index)
                prediction_by_frame.pop(result.frame_index, None)
                continue
            shape_field = {"points": points}
        else:
            shape_field = {"bbox": _normalize_bbox(result.geometry)}
        prediction_by_frame[result.frame_index] = {
            "frame_index": result.frame_index,
            **shape_field,
            "source": "prediction",
            "occluded": False,
        }

    outside_frame_set = set(outside_frames)
    merged = [
        item
        for item in keyframes
        if item.get("source", "manual") == "manual"
        or (
            int(item.get("frame_index", 0)) not in prediction_by_frame
            and int(item.get("frame_index", 0)) not in outside_frame_set
        )
    ]
    merged.extend(prediction_by_frame.values())
    geometry["keyframes"] = sorted(
        merged, key=lambda item: int(item.get("frame_index", 0))
    )
    geometry["outside"] = _merge_outside_ranges(
        geometry.get("outside") or [], sorted(set(outside_frames))
    )

    annotation.geometry = geometry
    annotation.annotation_type = (
        "video_track_polygon" if is_polygon else "video_track_bbox"
    )
    annotation.version = int(annotation.version or 1) + 1


def _partition_results_by_instance(
    results: list[TrackerFrameResult],
) -> tuple[list[TrackerFrameResult], dict[str, list[TrackerFrameResult]]]:
    """把逐帧结果拆成 (主实例结果, {instance_id: 非主实例结果}) —— 阶段 0 多目标落库。

    模式 a「自动发现」下 backend 一帧可返回多实例。主实例 = 与用户种子对应的那个,
    回填源 annotation; 其余每个 instance_id 各成一条新 track。
    - 无任何 instance_id (单实例老 backend): 全部归主, 与既有单 track 行为等价 (零回归)。
    - 有 instance_id: primary 标记所属的 instance 归主; 若无一标 primary, 取字典序最小
      的 instance_id 归主 (确定性兜底)。同一 instance_id 的所有帧整体归属同一去向。
    """
    if all(r.instance_id is None for r in results):
        return list(results), {}

    primary_id = next(
        (r.instance_id for r in results if r.primary and r.instance_id is not None),
        None,
    )
    if primary_id is None:
        primary_id = min(r.instance_id for r in results if r.instance_id is not None)

    primary: list[TrackerFrameResult] = []
    extras: dict[str, list[TrackerFrameResult]] = {}
    for result in results:
        if result.instance_id is None or result.instance_id == primary_id:
            primary.append(result)
        else:
            extras.setdefault(result.instance_id, []).append(result)
    return primary, extras


def _new_discovered_track(source: Annotation, is_polygon: bool) -> Annotation:
    """为一个新发现的实例建一条空 video_track annotation (阶段 0)。

    归属策略 (epic 已定): 继承 source 的 label (class_name/tool_unit_id) 与项目/任务/
    归属人, 标 source="ai_tracker" (与批量预标 prediction_based 区分, 不被批量清理误删),
    新 track_id 走统一工厂 _new_track_id()。几何先空, 由 apply_tracker_results 填预测帧。
    """
    track_id = _new_track_id()
    geom_type = "video_track_polygon" if is_polygon else "video_track_bbox"
    return Annotation(
        id=uuid.uuid4(),
        task_id=source.task_id,
        project_id=source.project_id,
        user_id=source.user_id,
        source="ai_tracker",
        annotation_type=geom_type,
        tool_unit_id=source.tool_unit_id,
        class_name=source.class_name,
        geometry={
            "type": geom_type,
            "track_id": track_id,
            "keyframes": [],
            "outside": [],
        },
        track_id=track_id,
    )


def _persist_tracker_results(
    db: AsyncSession,
    source: Annotation,
    job: VideoTrackerJob,
    results: list[TrackerFrameResult],
    grid_step: int,
    output_geometry: str,
) -> list[Annotation]:
    """落库逐帧结果: 主实例回填源 annotation, 每个新 instance 各建并回填一条 track。

    返回新建的 annotation 列表 (调用方负责 commit)。单实例时 extras 为空, 退化为对源
    annotation 调一次 apply_tracker_results —— 与阶段 0 之前完全一致。
    """
    primary, extras = _partition_results_by_instance(results)
    apply_tracker_results(source, job, primary, grid_step)
    is_polygon = output_geometry == "polygon"
    created: list[Annotation] = []
    for instance_id in sorted(extras):
        new_ann = _new_discovered_track(source, is_polygon)
        db.add(new_ann)
        apply_tracker_results(new_ann, job, extras[instance_id], grid_step)
        created.append(new_ann)
    return created


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
        task = await db.get(Task, job.task_id)
        if task is None:
            raise ValueError("Task not found")
        item = await db.get(DatasetItem, job.dataset_item_id)
        if item is None:
            raise ValueError("Dataset item not found")
        from app.api.v1.ml_backends import _resolve_task_url

        # v0.21.25 (阶段 R) · 按 tracker 能力选后端而非项目单一绑定: sam3_video 挑声明了
        # sam3_video 的 backend(sam3-backend), 而非静默落到项目绑定的 grounded-sam2。
        backend = await MLBackendService(db).get_tracker_backend(
            task.project_id, job.model_key
        )
        adapter = get_tracker_adapter(job.model_key)

        # 采样网格步长：只回填网格帧（见 apply_tracker_results）。
        from app.db.models.project import Project
        from app.services.video_frame_service import derive_step

        project = await db.get(Project, task.project_id)
        source_fps = ((item.metadata_ or {}).get("video") or {}).get("fps")
        grid_step = derive_step(
            source_fps, (project.video_sampling or {}) if project else {}
        )

        results: list[TrackerFrameResult] = []
        total = max(1, job.to_frame - job.from_frame + 1)
        progress = 0
        task_data = {
            "id": str(task.id),
            "file_path": _resolve_task_url(task),
            "dataset_item_id": str(item.id),
            "file_name": item.file_name,
            "file_type": item.file_type,
        }

        # Cross-window continuation: window 1 seeds from the original keyframe,
        # each subsequent window seeds from the previous window's last
        # non-outside frame geometry so the tracker keeps following a moving
        # target instead of restarting from the original box every window.
        last_geometry = annotation.geometry or {}
        # v0.21.20 · polygon track: 让 backend 逐帧保留 mask 矢量化的多边形而非降 bbox。
        output_geometry = (
            "polygon" if is_polygon_track(annotation.geometry or {}) else "bbox"
        )

        for from_frame, to_frame in _tracker_windows(job):
            ctx = TrackerContext(
                job_id=job.id,
                task_id=task.id,
                project_id=task.project_id,
                dataset_item_id=job.dataset_item_id,
                annotation_id=job.annotation_id,
                from_frame=from_frame,
                to_frame=to_frame,
                direction=job.direction,
                prompt=job.prompt or {},
                source_geometry=last_geometry,
                task_data=task_data,
                ml_backend=backend,
                sam_variant=(job.prompt or {}).get("sam_variant"),  # v0.10.36
                # v0.21.19 · text-driven 追踪的 text/exemplars 从 prompt JSONB 读出透传。
                text=(job.prompt or {}).get("text"),
                exemplars=(job.prompt or {}).get("exemplars"),
                # v0.21.20 · polygon track 回填: 期望输出几何 (polygon/bbox)。
                output_geometry=output_geometry,
            )
            async for result in adapter.propagate(ctx):
                await db.refresh(job)
                if (
                    job.cancel_requested_at is not None
                    or job.status == VideoTrackerJobStatus.CANCELLED.value
                ):
                    if results:
                        _persist_tracker_results(
                            db, annotation, job, results, grid_step, output_geometry
                        )
                    job.status = VideoTrackerJobStatus.CANCELLED.value
                    job.completed_at = job.completed_at or _now()
                    await db.commit()
                    await publisher(job.event_channel, _event(job, "job_cancelled"))
                    return job

                results.append(result)
                # Seed the next window with this window's latest non-outside
                # geometry. The adapter yields in propagation order, so the
                # last such result is the boundary frame adjacent to the next
                # window (works for both forward and backward windows).
                # v0.21.26 · 阶段 0 · 只用主实例的几何续种: 多目标时非主实例不参与源 track
                # 的跨窗续追, 否则会把某个新发现目标的框喂给下一窗, 令主 track 种子漂移。
                if (
                    (result.instance_id is None or result.primary)
                    and not result.outside
                    and result.geometry
                ):
                    last_geometry = result.geometry
                progress += 1
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
                    _event(
                        job,
                        "job_progress",
                        current=min(progress, total),
                        total=total,
                    ),
                )

        await db.refresh(job)
        if job.cancel_requested_at is not None:
            if results:
                _persist_tracker_results(
                    db, annotation, job, results, grid_step, output_geometry
                )
            job.status = VideoTrackerJobStatus.CANCELLED.value
            job.completed_at = job.completed_at or _now()
            await db.commit()
            await publisher(job.event_channel, _event(job, "job_cancelled"))
            return job

        _persist_tracker_results(
            db, annotation, job, results, grid_step, output_geometry
        )
        job.status = VideoTrackerJobStatus.COMPLETED.value
        job.completed_at = _now()
        await db.commit()
        await db.refresh(job)
        await publisher(job.event_channel, _event(job, "job_completed"))
        return job
    except Exception as exc:
        log.exception("video tracker job failed job_id=%s", job_id)
        return await _mark_failed(db, job_id, str(exc), publisher)
