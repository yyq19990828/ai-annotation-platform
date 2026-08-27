"""v0.10.27 · 导出异步化 worker（计划 §4 阶段 3）。

照 batch_predict 模板：`@celery_app.task` + `asyncio.run(_run_export(...))`，内部 async_sessionmaker。

流程：mark_running → 算指纹（max updated_at + active count）→ compute_cache_key →
export_cache.lookup（命中且探活在 → 刷新预签名 URL 直接 mark_complete）→ 否则生成 ZIP
（export_packaging.build_export_zip）→ put 到 export 桶 `image/{project_id}/{job_id}.zip` →
export_cache.record → update_progress 分段 → mark_complete。异常 mark_failed。
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import redis.asyncio as aioredis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.db.models.annotation import Annotation
from app.db.models.async_job import AsyncJob
from app.db.models.export_artifact import ExportArtifact
from app.db.models.dataset import DatasetItem, Scene, SensorCalibrationRevision
from app.db.models.project import Project
from app.db.models.scene_pose import SceneFramePose
from app.db.models.task import Task
from app.db.models.task_dataset_item_link import TaskDatasetItemLink
from app.services import async_job as async_job_svc
from app.services.exporting import cache as export_cache
from app.services.exporting.packaging import (
    PRESIGN_EXPIRES_SECONDS,
    build_export_zip,
)
from app.services.exporting.video_scope import VideoExportScope
from app.services.mask_formats import registry as mask_format_registry
from app.services.mask_formats.contracts import canonical_digest
from app.schemas.export import LidarExportOptions
from app.services.notification import NotificationService
from app.services.storage import storage_service
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)

_RELEASE_LOCK_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


class ExportBuildInProgress(RuntimeError):
    pass


async def _complete_from_cache(
    db: AsyncSession,
    *,
    job_uuid: uuid.UUID,
    hit: ExportArtifact,
    export_bucket: str,
    download_name: str,
    cache_key: str,
) -> None:
    download_url = storage_service.generate_download_url(
        hit.object_key,
        expires_in=PRESIGN_EXPIRES_SECONDS,
        bucket=export_bucket,
        download_name=download_name,
    )
    result = {
        "download_url": download_url,
        "expires_at": hit.expires_at.isoformat(),
        "object_key": hit.object_key,
        "file_count": hit.file_count,
        "size_bytes": hit.size_bytes,
        "cache_hit": True,
    }
    await async_job_svc.mark_complete(db, job_uuid, result=result)
    await _emit_export_notification(db, job_uuid, ok=True, result=result)
    await db.commit()
    log.info("run_export cache hit job=%s key=%s", job_uuid, cache_key)


async def _emit_export_notification(
    db: AsyncSession,
    job_uuid: uuid.UUID,
    *,
    ok: bool,
    result: dict | None = None,
    error: str | None = None,
) -> None:
    """导出完成/失败发通知（WS 推送 + 持久化）。job.payload 已含 project_display_id/format。

    失败不阻断主流程（与 notification 服务自身的 try/except 一致）。调用方负责后续 commit。
    """
    try:
        job = await db.get(AsyncJob, job_uuid)
        if job is None or job.user_id is None:
            return
        payload_in = job.payload or {}
        notif_payload: dict = {
            "project_display_id": payload_in.get("project_display_id"),
            "targets": payload_in.get("targets"),
            "format": payload_in.get("format"),
        }
        if ok and result:
            notif_payload["download_url"] = result.get("download_url")
            notif_payload["file_count"] = result.get("file_count")
            notif_payload["expires_at"] = result.get("expires_at")
        if not ok and error:
            notif_payload["error"] = error[:200]
        await NotificationService(db).notify(
            user_id=job.user_id,
            type="export.ready" if ok else "export.failed",
            target_type="export",
            target_id=job_uuid,
            payload=notif_payload,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("export notification failed job=%s err=%s", job_uuid, e)


@celery_app.task(bind=True, name="app.workers.export.run_export")
def run_export(
    self,
    project_id: str,
    batch_id: str | None,
    targets: list[str],
    opts: dict | None,
    async_job_id: str,
):
    try:
        asyncio.run(
            _run_export(
                project_id=project_id,
                batch_id=batch_id,
                targets=targets,
                opts=opts or {},
                async_job_id=async_job_id,
                celery_task_id=self.request.id,
            )
        )
    except ExportBuildInProgress as exc:
        raise self.retry(exc=exc, countdown=5, max_retries=120) from exc


async def _scope_fingerprint(
    db: AsyncSession, project_id: uuid.UUID, batch_id: uuid.UUID | None
) -> tuple[datetime | None, int]:
    """max(project/annotation updated_at) + active annotation count for cache invalidation."""
    q = select(func.max(Annotation.updated_at), func.count(Annotation.id)).where(
        Annotation.project_id == project_id,
        Annotation.is_active.is_(True),
        Annotation.was_cancelled.is_(False),
    )
    if batch_id is not None:
        # Annotation 无 batch_id 列；与 _load_data 一致，按 task.batch_id 过滤。
        q = q.where(
            Annotation.task_id.in_(select(Task.id).where(Task.batch_id == batch_id))
        )
    row = (await db.execute(q)).one()
    project_updated_at = (
        await db.execute(select(Project.updated_at).where(Project.id == project_id))
    ).scalar_one_or_none()
    timestamps = [ts for ts in (row[0], project_updated_at) if ts is not None]
    return (max(timestamps) if timestamps else None), int(row[1] or 0)


async def _nuscenes_scope_digest(
    db: AsyncSession,
    project_id: uuid.UUID,
    batch_id: uuid.UUID | None,
) -> str:
    task_query = select(Task).where(Task.project_id == project_id)
    if batch_id is not None:
        task_query = task_query.where(Task.batch_id == batch_id)
    tasks = list((await db.execute(task_query)).scalars())
    task_ids = [task.id for task in tasks]
    links = []
    for start in range(0, len(task_ids), 1000):
        links.extend(
            list(
                (
                    await db.execute(
                        select(TaskDatasetItemLink).where(
                            TaskDatasetItemLink.task_id.in_(
                                task_ids[start : start + 1000]
                            )
                        )
                    )
                ).scalars()
            )
        )
    item_ids = {
        item_id
        for item_id in (
            [task.dataset_item_id for task in tasks]
            + [link.dataset_item_id for link in links]
        )
        if item_id is not None
    }
    ordered_item_ids = sorted(item_ids, key=str)
    items = []
    for start in range(0, len(ordered_item_ids), 1000):
        items.extend(
            list(
                (
                    await db.execute(
                        select(DatasetItem).where(
                            DatasetItem.id.in_(ordered_item_ids[start : start + 1000])
                        )
                    )
                ).scalars()
            )
        )
    scene_ids = {item.scene_id for item in items if item.scene_id is not None}
    ordered_scene_ids = sorted(scene_ids, key=str)
    scenes = []
    poses = []
    for start in range(0, len(ordered_scene_ids), 1000):
        scene_id_chunk = ordered_scene_ids[start : start + 1000]
        scenes.extend(
            list(
                (
                    await db.execute(select(Scene).where(Scene.id.in_(scene_id_chunk)))
                ).scalars()
            )
        )
        poses.extend(
            list(
                (
                    await db.execute(
                        select(SceneFramePose).where(
                            SceneFramePose.scene_id.in_(scene_id_chunk)
                        )
                    )
                ).scalars()
            )
        )
    return canonical_digest(
        {
            "tasks": [
                {
                    "id": task.id,
                    "batch_id": task.batch_id,
                    "dataset_item_id": task.dataset_item_id,
                    "sequence_order": task.sequence_order,
                    "updated_at": task.updated_at,
                }
                for task in sorted(tasks, key=lambda row: str(row.id))
            ],
            "links": [
                {
                    "task_id": link.task_id,
                    "dataset_item_id": link.dataset_item_id,
                    "role": link.role,
                    "sensor_name": link.sensor_name,
                }
                for link in sorted(links, key=lambda row: (str(row.task_id), row.role))
            ],
            "items": [
                {
                    "id": item.id,
                    "scene_id": item.scene_id,
                    "frame_index": item.frame_index,
                    "file_path": item.file_path,
                    "file_type": item.file_type,
                    "file_size": item.file_size,
                    "width": item.width,
                    "height": item.height,
                    "content_hash": item.content_hash,
                    "metadata": item.metadata_,
                    "updated_at": item.updated_at,
                }
                for item in sorted(items, key=lambda row: str(row.id))
            ],
            "scenes": [
                {
                    "id": scene.id,
                    "source_format": scene.source_format,
                    "source_metadata": scene.source_metadata,
                    "updated_at": scene.updated_at,
                }
                for scene in sorted(scenes, key=lambda row: str(row.id))
            ],
            "poses": [
                {
                    "scene_id": pose.scene_id,
                    "frame_index": pose.frame_index,
                    "timestamp_us": pose.timestamp_us,
                    "ego_translation": pose.ego_translation,
                    "ego_rotation": pose.ego_rotation,
                    "source_metadata": pose.source_metadata,
                }
                for pose in sorted(
                    poses, key=lambda row: (str(row.scene_id), row.frame_index)
                )
            ],
        }
    )


async def _multicamera_coco_scope_digest(
    db: AsyncSession,
    project_id: uuid.UUID,
    batch_id: uuid.UUID | None,
) -> str:
    task_query = select(Task.id).where(Task.project_id == project_id)
    if batch_id is not None:
        task_query = task_query.where(Task.batch_id == batch_id)
    task_ids = list((await db.execute(task_query)).scalars())
    rows = []
    for start in range(0, len(task_ids), 1000):
        rows.extend(
            list(
                (
                    await db.execute(
                        select(TaskDatasetItemLink, DatasetItem)
                        .join(
                            DatasetItem,
                            DatasetItem.id == TaskDatasetItemLink.dataset_item_id,
                        )
                        .where(
                            TaskDatasetItemLink.task_id.in_(
                                task_ids[start : start + 1000]
                            ),
                            TaskDatasetItemLink.role.like("camera\\_%", escape="\\"),
                        )
                    )
                ).all()
            )
        )
    item_ids = {item.id for _link, item in rows}
    ordered_item_ids = sorted(item_ids, key=str)
    calibration_rows = []
    for start in range(0, len(ordered_item_ids), 1000):
        calibration_rows.extend(
            list(
                (
                    await db.execute(
                        select(SensorCalibrationRevision).where(
                            SensorCalibrationRevision.dataset_item_id.in_(
                                ordered_item_ids[start : start + 1000]
                            )
                        )
                    )
                ).scalars()
            )
        )

    async def head_item(item: DatasetItem) -> tuple[uuid.UUID, dict | None]:
        head = await asyncio.to_thread(
            storage_service.verify_upload,
            item.file_path,
            storage_service.datasets_bucket,
        )
        return item.id, head

    items_by_id = {item.id: item for _link, item in rows}
    media_heads: dict[uuid.UUID, dict | None] = {}
    items = list(items_by_id.values())
    for start in range(0, len(items), 32):
        media_heads.update(
            await asyncio.gather(
                *[head_item(item) for item in items[start : start + 32]]
            )
        )
    return canonical_digest(
        {
            "scope": await _nuscenes_scope_digest(db, project_id, batch_id),
            "calibration_history": [
                {
                    "dataset_item_id": row.dataset_item_id,
                    "revision": row.revision,
                    "digest": row.digest,
                    "calibration": row.calibration,
                }
                for row in sorted(
                    calibration_rows,
                    key=lambda row: (str(row.dataset_item_id), row.revision),
                )
            ],
            "media": [
                {
                    "dataset_item_id": item.id,
                    "file_path": item.file_path,
                    "content_length": (
                        media_heads[item.id].get("ContentLength")
                        if media_heads.get(item.id)
                        else None
                    ),
                    "etag": (
                        str(media_heads[item.id].get("ETag") or "").strip('"')
                        if media_heads.get(item.id)
                        else None
                    ),
                }
                for item in sorted(items, key=lambda row: str(row.id))
            ],
        }
    )


async def _scope_naming(
    db: AsyncSession, project_id: uuid.UUID, batch_id: uuid.UUID | None
) -> tuple[str, str | None, str]:
    """返回 (media, dataset_name|None, project_display_id)。

    media 由 project.data_type 决定（image/video）；dataset_name = 唯一数据集名
    （file_path 首段，跨多数据集时 None）；用于桶前缀与友好下载名。
    """
    row = (
        await db.execute(
            select(Project.data_type, Project.display_id).where(
                Project.id == project_id
            )
        )
    ).first()
    data_type = (row[0] if row else None) or "image"
    display_id = (row[1] if row else None) or "export"
    media = "video" if data_type == "video" else "image"

    name_q = select(func.split_part(Task.file_path, "/", 1)).where(
        Task.project_id == project_id
    )
    if batch_id is not None:
        name_q = name_q.where(Task.batch_id == batch_id)
    names = [r[0] for r in (await db.execute(name_q.distinct())).all() if r[0]]
    dataset_name = names[0] if len(names) == 1 else None
    return media, dataset_name, display_id


def _friendly_zip_name(
    project_display_id: str, dataset_name: str | None, job_id: str
) -> str:
    """{project_display_id}_{dataset_name?}_{job_id[:8]}.zip，非法字符替换为 _。"""
    parts = [project_display_id]
    if dataset_name:
        parts.append(dataset_name)
    parts.append(job_id[:8])
    raw = "_".join(parts)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("_") or "export"
    return f"{safe}.zip"


async def _run_export(
    *,
    project_id: str,
    batch_id: str | None,
    targets: list[str],
    opts: dict,
    async_job_id: str,
    celery_task_id: str | None,
) -> None:
    proj_uuid = uuid.UUID(project_id)
    batch_uuid = uuid.UUID(batch_id) if batch_id else None
    job_uuid = uuid.UUID(async_job_id)
    include_attributes = bool(opts.get("include_attributes", True))
    video_frame_mode = str(opts.get("video_frame_mode", "keyframes"))
    axis_frame = str(opts.get("axis_frame", "iso"))
    video_scope = VideoExportScope.from_dict(opts.get("video_export_scope"))
    export_bucket = settings.minio_export_bucket
    lock_client = None
    lock_key: str | None = None
    lock_owner: str | None = None
    lock_acquired = False
    uploaded_object_key: str | None = None

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with SessionLocal() as db:
            try:
                await async_job_svc.mark_running(
                    db, job_uuid, celery_task_id=celery_task_id
                )
                await db.commit()

                if {"coco-multicamera", "kitti", "nuscenes"} & set(targets):
                    from app.services.exporting.lidar_preflight import (
                        assert_lidar_export_ready,
                    )

                    raw_lidar_options = opts.get("lidar")
                    lidar_options = (
                        LidarExportOptions.model_validate(raw_lidar_options)
                        if raw_lidar_options
                        else None
                    )
                    await assert_lidar_export_ready(
                        db,
                        project_id=proj_uuid,
                        batch_id=batch_uuid,
                        targets=targets,
                        options=lidar_options,
                    )

                scope_id = batch_uuid or proj_uuid
                max_updated_at, active_count = await _scope_fingerprint(
                    db, proj_uuid, batch_uuid
                )
                options_payload: object = opts
                scope_digests: dict[str, object] = {"request": opts}
                if "nuscenes" in targets:
                    scope_digests[
                        "nuscenes_scope_digest"
                    ] = await _nuscenes_scope_digest(db, proj_uuid, batch_uuid)
                if "coco-multicamera" in targets:
                    scope_digests[
                        "multicamera_coco_scope_digest"
                    ] = await _multicamera_coco_scope_digest(db, proj_uuid, batch_uuid)
                if len(scope_digests) > 1:
                    options_payload = scope_digests
                cache_key = export_cache.compute_cache_key(
                    scope_id,
                    targets,
                    include_attributes,
                    video_frame_mode,
                    max_updated_at,
                    active_count,
                    axis_frame=axis_frame,
                    adapter_contracts=mask_format_registry.versions(targets),
                    options_digest=canonical_digest(options_payload),
                )
                # v0.10.43 · media 前缀 + 友好下载名（{display_id}_{dataset?}_{job[:8]}.zip）。
                media, dataset_name, project_display_id = await _scope_naming(
                    db, proj_uuid, batch_uuid
                )
                download_name = _friendly_zip_name(
                    project_display_id, dataset_name, async_job_id
                )

                hit = await export_cache.lookup(db, cache_key, bucket=export_bucket)
                if hit is None:
                    lock_key = f"export-build:{cache_key}"
                    lock_owner = secrets.token_hex(32)
                    lock_client = aioredis.from_url(
                        settings.redis_url,
                        decode_responses=True,
                        socket_connect_timeout=3,
                        socket_timeout=3,
                    )
                    lock_acquired = bool(
                        await lock_client.set(
                            lock_key,
                            lock_owner,
                            nx=True,
                            ex=6 * 60 * 60,
                        )
                    )
                    if not lock_acquired:
                        raise ExportBuildInProgress(
                            "another worker is building the same export cache key"
                        )
                    # 首次 miss 与抢锁之间可能已有前驱任务完成。
                    hit = await export_cache.lookup(db, cache_key, bucket=export_bucket)
                if hit is not None:
                    await _complete_from_cache(
                        db,
                        job_uuid=job_uuid,
                        hit=hit,
                        export_bucket=export_bucket,
                        download_name=download_name,
                        cache_key=cache_key,
                    )
                    return

                # 未命中：生成 ZIP（v0.12.1 · 落盘 tempfile，不再整包驻留 RAM）。
                await async_job_svc.update_progress(db, job_uuid, 10)
                await db.commit()

                zip_path, file_count, size_bytes = await build_export_zip(
                    db,
                    proj_uuid,
                    batch_id=batch_uuid,
                    targets=targets,
                    include_attributes=include_attributes,
                    video_frame_mode=video_frame_mode,
                    axis_frame=axis_frame,
                    format_options=opts,
                    video_scope=video_scope,
                )
                try:
                    await async_job_svc.update_progress(db, job_uuid, 70)
                    await db.commit()

                    object_key = f"{media}/{project_id}/{async_job_id}.zip"
                    # 流式多段上传（boto3 upload_file），不把整文件读进内存。
                    storage_service.upload_file(
                        zip_path,
                        object_key,
                        bucket=export_bucket,
                        content_type="application/zip",
                    )
                    uploaded_object_key = object_key
                finally:
                    # 上传成功或失败都清理临时文件，避免磁盘泄漏。
                    try:
                        os.unlink(zip_path)
                    except OSError:
                        pass

                expires_at = datetime.now(timezone.utc) + timedelta(
                    seconds=PRESIGN_EXPIRES_SECONDS
                )
                await export_cache.record(
                    db,
                    cache_key=cache_key,
                    project_id=proj_uuid,
                    batch_id=batch_uuid,
                    format=",".join(sorted(targets)),
                    object_key=object_key,
                    file_count=file_count,
                    size_bytes=size_bytes,
                    expires_at=expires_at,
                )
                await db.commit()
                uploaded_object_key = None

                await async_job_svc.update_progress(db, job_uuid, 90)
                await db.commit()

                download_url = storage_service.generate_download_url(
                    object_key,
                    expires_in=PRESIGN_EXPIRES_SECONDS,
                    bucket=export_bucket,
                    download_name=download_name,
                )
                await async_job_svc.mark_complete(
                    db,
                    job_uuid,
                    result={
                        "download_url": download_url,
                        "expires_at": expires_at.isoformat(),
                        "object_key": object_key,
                        "file_count": file_count,
                        "size_bytes": size_bytes,
                        "cache_hit": False,
                    },
                )
                await _emit_export_notification(
                    db,
                    job_uuid,
                    ok=True,
                    result={
                        "download_url": download_url,
                        "expires_at": expires_at.isoformat(),
                        "file_count": file_count,
                    },
                )
                await db.commit()
                log.info(
                    "run_export complete job=%s key=%s files=%d bytes=%d",
                    async_job_id,
                    object_key,
                    file_count,
                    size_bytes,
                )
            except Exception as exc:  # noqa: BLE001
                await db.rollback()
                if isinstance(exc, ExportBuildInProgress):
                    raise
                if uploaded_object_key is not None:
                    try:
                        storage_service.delete_object(
                            uploaded_object_key,
                            bucket=export_bucket,
                        )
                    except Exception:  # noqa: BLE001
                        log.exception(
                            "failed to clean orphan export object key=%s",
                            uploaded_object_key,
                        )
                try:
                    err = f"{type(exc).__name__}: {exc}"
                    await async_job_svc.mark_failed(db, job_uuid, error=err)
                    await _emit_export_notification(db, job_uuid, ok=False, error=err)
                    await db.commit()
                except Exception:
                    await db.rollback()
                raise
    finally:
        if lock_client is not None:
            if lock_acquired and lock_key and lock_owner:
                try:
                    await lock_client.eval(
                        _RELEASE_LOCK_LUA,
                        1,
                        lock_key,
                        lock_owner,
                    )
                except Exception:  # noqa: BLE001
                    log.exception("export single-flight lock release failed")
            await lock_client.aclose()
        await engine.dispose()
