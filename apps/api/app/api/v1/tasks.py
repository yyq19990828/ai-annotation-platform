import base64
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import (
    get_db,
    get_current_user,
    require_roles,
    require_scopes,
    assert_project_visible,
)
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.task import Task
from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, VideoFrameIndex
from app.db.models.prediction import Prediction
from app.schemas.task import (
    PointCloudCameraOut,
    TaskOut,
    TaskListResponse,
    TaskLockResponse,
    ReviewClaimResponse,
    TaskPointCloudManifestResponse,
    TaskVideoFrameTimetableResponse,
    TaskVideoManifestResponse,
    VideoFrameTimetableEntry,
    VideoMetadata,
)
from app.schemas.scene import NeighborsResponse
from app.schemas.video_frame_service import (
    VideoChunkOut,
    VideoChunksResponse,
    VideoFrameOut,
    VideoFramePrefetchRequest,
    VideoFramePrefetchResponse,
    VideoFrameRetryRequest,
    VideoManifestV2Response,
    VideoSegmentOut,
    VideoSegmentsResponse,
)
from app.schemas.video_tracker_job import (
    VideoTrackerJobOut,
    VideoTrackerPropagateRequest,
)
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationListPage,
    AnnotationOut,
    AnnotationUpdate,
    InterpolateRangeRequest,
    InterpolateRangeResponse,
    NeighborAnnotationsResponse,
    NeighborFrameAnnotations,
    PropagateBatchItem,
    PropagateBatchRequest,
    PropagateBatchResponse,
    PropagateRequest,
    PropagateResponse,
    VideoTrackCompositionRequest,
    VideoTrackCompositionResponse,
    VideoTrackConvertToBboxesRequest,
    VideoTrackConvertToBboxesResponse,
)
from app.schemas.prediction import PredictionOut
from app.services.annotation import AnnotationService
from app.services.audit import AuditAction, AuditService
from app.services.prediction import PredictionService
from app.services.task_dataset_link import get_linked_items
from app.services.task_lock import TaskLockService
from app.services.scheduler import (
    get_next_task,
    is_privileged_for_project,
    batch_visibility_clause,
    visible_batch_statuses_for,
)
from app.services.storage import storage_service
from app.services.video_frame_service import (
    build_context_from_task,
    get_chunk as get_video_chunk_asset,
    get_frame as get_video_frame_asset,
    list_chunks as list_video_chunks,
    manifest_v2 as build_video_manifest_v2,
    prefetch_frames as prefetch_video_frames,
    retry_frames as retry_video_frames,
)
from app.services.video_segment_service import (
    claim_segment,
    heartbeat_segment,
    list_segments as list_video_segments,
    release_segment,
)
from app.services.video_tracker_job_service import create_tracker_job
from app.services.user_brief import resolve_briefs
from app.db.models.task_batch import TaskBatch

router = APIRouter()
logger = logging.getLogger(__name__)
VIDEO_MANIFEST_URL_EXPIRES_IN = 3600

_ANNOTATORS = (
    UserRole.SUPER_ADMIN,
    UserRole.PROJECT_ADMIN,
    UserRole.REVIEWER,
    UserRole.ANNOTATOR,
)
_REVIEWERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)
_LOCKED_STATUSES = {"review", "completed"}


def _assert_task_editable(task: Task, user: User | None = None) -> None:
    """v0.6.5: 已提交质检 / 已通过审核的任务对所有 annotation 写动作锁死。
    标注员要继续编辑必须先 withdraw（review 态）或 reopen（completed 态）。
    M2: 审核员可在 status=review 时直接微调标注（审计记 TASK_REVIEWER_EDIT）。"""
    if task.status not in _LOCKED_STATUSES:
        return
    if task.status == "review" and user is not None and user.role in _REVIEWERS:
        return
    raise HTTPException(
        status_code=409,
        detail={"reason": "task_locked", "status": task.status},
    )


async def _load_task_or_404(db: AsyncSession, task_id: uuid.UUID) -> Task:
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


async def _assert_task_visible(db: AsyncSession, task: Task, user: User) -> None:
    """B-16 + v0.7.0：服务端强制 batch 可见性，按角色分支。
    super_admin / 项目 owner 越权放行；reviewer 见 active/annotating/reviewing；
    annotator 见 active/annotating（assigned）+ rejected（assigned 特例）。
    无 batch 的孤儿任务对非特权用户不可见。
    """
    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if is_privileged_for_project(user, project):
        return
    if task.batch_id is None:
        raise HTTPException(status_code=404, detail="Task not found")
    batch = await db.get(TaskBatch, task.batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Task not found")

    visible_statuses = visible_batch_statuses_for(user)
    if batch.status not in visible_statuses:
        raise HTTPException(status_code=404, detail="Task not found")

    # reviewer 不受 annotator 约束（跨批次审核）
    if user.role == UserRole.REVIEWER:
        return

    # v0.7.2：annotator 路径 — 一 batch 一标注员，按 batch.annotator_id 单值校验
    is_assigned = batch.annotator_id is not None and batch.annotator_id == user.id
    # rejected 状态特例：仅对被分派的标注员放行
    if batch.status == "rejected" and not is_assigned:
        raise HTTPException(status_code=404, detail="Task not found")
    if batch.annotator_id is not None and not is_assigned:
        raise HTTPException(status_code=404, detail="Task not found")


async def _visible_task_ids(
    db: AsyncSession,
    project,
    user: User,
    task_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """v0.15.26 · `_assert_task_visible` 的批量非抛错版,返回 task_ids 中可见的子集。

    邻帧标注批量端点用它逐邻帧 task 复核 batch 可见性 / 分派状态:该端点替代的
    旧链路(前端对每个邻帧各发一条 getAnnotations)会逐 task 触发 _assert_task_visible,
    所以批量化后必须补回同口径过滤,否则 annotator 凭中心 task 可见即可拿到「分派给
    别人 / 状态不可见」的邻帧框几何(权限漂移)。口径与 _assert_task_visible 完全一致:
    特权放行;否则按 batch 状态白名单 + annotator 单值分派校验。
    """
    if not task_ids:
        return set()
    if is_privileged_for_project(user, project):
        return set(task_ids)

    rows = (
        await db.execute(select(Task.id, Task.batch_id).where(Task.id.in_(task_ids)))
    ).all()
    batch_ids = {bid for _, bid in rows if bid is not None}
    batches: dict[uuid.UUID, TaskBatch] = {}
    if batch_ids:
        result = await db.execute(select(TaskBatch).where(TaskBatch.id.in_(batch_ids)))
        batches = {b.id: b for b in result.scalars()}

    visible_statuses = visible_batch_statuses_for(user)
    is_reviewer = user.role == UserRole.REVIEWER
    visible: set[uuid.UUID] = set()
    for tid, bid in rows:
        if bid is None:
            continue
        batch = batches.get(bid)
        if batch is None or batch.status not in visible_statuses:
            continue
        if is_reviewer:
            visible.add(tid)
            continue
        is_assigned = batch.annotator_id is not None and batch.annotator_id == user.id
        if batch.status == "rejected" and not is_assigned:
            continue
        if batch.annotator_id is not None and not is_assigned:
            continue
        visible.add(tid)
    return visible


# sequence_order 为 NULL 的非序列任务(图像标注等)用该哨兵参与排序,稳定排在
# 序列任务(点云 scene 帧)之后。取 int32 上限,真实帧序号不可能触及。
_SEQ_NULL_SENTINEL = 2147483647


def _encode_task_cursor(seq_order: int | None, created_at, task_id: uuid.UUID) -> str:
    seq = _SEQ_NULL_SENTINEL if seq_order is None else seq_order
    ts = (
        created_at.astimezone(timezone.utc).isoformat()
        if created_at.tzinfo
        else created_at.isoformat()
    )
    return base64.urlsafe_b64encode(f"{seq}|{ts}|{task_id.hex}".encode()).decode()


def _decode_task_cursor(cursor: str):
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    from datetime import datetime

    parts = raw.split("|", 2)
    if len(parts) == 3:
        seq_str, ts_str, id_hex = parts
        seq = int(seq_str)
    else:
        # 兼容旧 2 段游标((created_at, id) 时代):seq 取哨兵,降级为按时间/ id 续翻。
        ts_str, id_hex = parts
        seq = _SEQ_NULL_SENTINEL
    ts = datetime.fromisoformat(ts_str)
    return seq, ts, uuid.UUID(id_hex)


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    project_id: uuid.UUID = Query(...),
    status: str | None = None,
    assignee_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
    unbatched: bool = False,
    reject_reason_type: str | None = None,
    class_name: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    q = select(Task).where(Task.project_id == project_id)
    count_q = (
        select(func.count()).select_from(Task).where(Task.project_id == project_id)
    )

    # B-16: 非特权用户在工作台列出任务时只能看见 batch 处于 active / annotating
    # 且自己在 assigned_user_ids 中（或批次未分派）。无 batch 的孤儿对非特权不可见。
    if not is_privileged_for_project(user, project):
        q = q.join(TaskBatch, Task.batch_id == TaskBatch.id).where(
            batch_visibility_clause(user)
        )
        count_q = count_q.join(TaskBatch, Task.batch_id == TaskBatch.id).where(
            batch_visibility_clause(user)
        )

    if status:
        q = q.where(Task.status == status)
        count_q = count_q.where(Task.status == status)
    if assignee_id:
        q = q.where(Task.assignee_id == assignee_id)
        count_q = count_q.where(Task.assignee_id == assignee_id)
    # v0.12.6 (A3) · 绩效页 reject/类别维度下钻过滤。
    if reject_reason_type:
        q = q.where(Task.reject_reason_type == reject_reason_type)
        count_q = count_q.where(Task.reject_reason_type == reject_reason_type)
    if class_name:
        from sqlalchemy import exists

        ann_clause = exists().where(
            Annotation.task_id == Task.id,
            Annotation.class_name == class_name,
            Annotation.is_active.is_(True),
        )
        q = q.where(ann_clause)
        count_q = count_q.where(ann_clause)
    # v0.12.0 B5 · 未归类池(batch_id IS NULL)浏览；unbatched 优先, 忽略 batch_id 参数。
    # 非特权用户因上方 JOIN TaskBatch 天然排除 NULL → 返回空(未归类池是管理者功能)。
    if unbatched:
        q = q.where(Task.batch_id.is_(None))
        count_q = count_q.where(Task.batch_id.is_(None))
    elif batch_id:
        q = q.where(Task.batch_id == batch_id)
        count_q = count_q.where(Task.batch_id == batch_id)

    # v0.6.8 B-15：首屏与游标分支统一排序，并都产出 next_cursor，修前端 useInfiniteQuery
    # 因首屏拿不到 next_cursor 而判定 hasNextPage=false 卡在 100 条的 BUG。
    # 排序主键改为 sequence_order(点云 scene 按帧时序分包时,同 scene 的 task 是同一刻批量
    # 创建的、created_at 全相同,旧的 (created_at, id) 排序退化为按随机 UUID id 乱序)。
    # 非序列任务 sequence_order 为 NULL → coalesce 到哨兵,排序退回 (created_at, id),行为不变。
    seq_key = func.coalesce(Task.sequence_order, _SEQ_NULL_SENTINEL)
    if cursor:
        last_seq, last_ts, last_id = _decode_task_cursor(cursor)
        q = q.where(
            or_(
                seq_key > last_seq,
                and_(seq_key == last_seq, Task.created_at > last_ts),
                and_(
                    seq_key == last_seq, Task.created_at == last_ts, Task.id > last_id
                ),
            )
        )

    q = q.order_by(seq_key, Task.created_at, Task.id).limit(limit)
    if not cursor and offset:
        q = q.offset(offset)
    tasks = list((await db.execute(q)).scalars().all())
    # v0.11.30 · 仅首页(无 cursor 且 offset=0)做精确全表 COUNT；后续页(cursor 翻页)
    # 返回 None，前端复用首页值，避免无限滚动逐页重复全表 COUNT(大表 O(N) 放大)。
    is_first_page = cursor is None and offset == 0
    total = ((await db.execute(count_q)).scalar() or 0) if is_first_page else None
    dims = await _attach_dimensions_batch(db, tasks)
    # v0.7.2 · 一次 IN 查询解析所有 assignee_id / reviewer_id → UserBrief
    user_ids = {t.assignee_id for t in tasks if t.assignee_id} | {
        t.reviewer_id for t in tasks if t.reviewer_id
    }
    briefs = await resolve_briefs(db, user_ids) if user_ids else {}
    next_cursor = (
        _encode_task_cursor(
            tasks[-1].sequence_order, tasks[-1].created_at, tasks[-1].id
        )
        if len(tasks) == limit
        else None
    )
    return TaskListResponse(
        items=[
            _task_with_url(
                t,
                *dims.get(t.id, (None, None, None, None, None)),
                briefs=briefs,
            )
            for t in tasks
        ],
        total=total,
        limit=limit,
        offset=0 if cursor else offset,
        next_cursor=next_cursor,
    )


@router.get("/next", response_model=TaskOut | None)
async def next_task(
    project_id: uuid.UUID = Query(...),
    batch_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    await assert_project_visible(project_id, db, current_user)
    task = await get_next_task(current_user, project_id, db, batch_id=batch_id)
    if not task:
        return None
    await db.commit()
    w, h, thumb, bh, video_metadata = await _attach_dimensions(db, task)
    briefs = await resolve_briefs(db, [task.assignee_id, task.reviewer_id])
    return _task_with_url(task, w, h, thumb, bh, video_metadata, briefs=briefs)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    w, h, thumb, bh, video_metadata = await _attach_dimensions(db, task)
    briefs = await resolve_briefs(db, [task.assignee_id, task.reviewer_id])
    return _task_with_url(task, w, h, thumb, bh, video_metadata, briefs=briefs)


@router.get("/{task_id}/video/manifest", response_model=TaskVideoManifestResponse)
async def get_video_manifest(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    if task.file_type != "video":
        raise HTTPException(status_code=400, detail="Task is not a video task")

    bucket = (
        storage_service.datasets_bucket
        if task.dataset_item_id
        else storage_service.bucket
    )
    try:
        _, _, thumb, _, video_metadata = await _attach_dimensions(db, task)
    except Exception as exc:
        logger.exception("Failed to load video metadata task_id=%s", task.id)
        raise HTTPException(
            status_code=503, detail="Video metadata unavailable"
        ) from exc

    metadata = VideoMetadata.model_validate(video_metadata or {})
    if not metadata.fps or not metadata.frame_count:
        raise HTTPException(status_code=503, detail="Video metadata not ready")

    video_path = metadata.playback_path or task.file_path
    # v0.10.17 · playback/* 走 media-cache 桶,原始源文件走 datasets 桶
    video_bucket = storage_service.bucket_for_cache_key(video_path, default=bucket)
    try:
        video_url = storage_service.generate_download_url(
            video_path,
            expires_in=VIDEO_MANIFEST_URL_EXPIRES_IN,
            bucket=video_bucket,
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code in {"NoSuchKey", "404", "NotFound"}:
            raise HTTPException(
                status_code=404, detail="Video file not available"
            ) from exc
        logger.exception(
            "Failed to generate video manifest URL task_id=%s bucket=%s key=%s",
            task.id,
            video_bucket,
            video_path,
        )
        raise HTTPException(
            status_code=503, detail="Video storage unavailable"
        ) from exc
    except BotoCoreError as exc:
        logger.exception(
            "Failed to generate video manifest URL task_id=%s bucket=%s key=%s",
            task.id,
            video_bucket,
            video_path,
        )
        raise HTTPException(
            status_code=503, detail="Video storage unavailable"
        ) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected video manifest URL error task_id=%s bucket=%s key=%s",
            task.id,
            video_bucket,
            video_path,
        )
        raise HTTPException(
            status_code=503, detail="Video storage unavailable"
        ) from exc

    poster_path = metadata.poster_frame_path or thumb
    poster_url: str | None = None
    poster_bucket: str | None = None
    if poster_path:
        # poster 可能是 thumbnails/* 或 videos/*/frames/* (media-cache) 或源 key (datasets)
        poster_bucket = storage_service.bucket_for_cache_key(
            poster_path, default=bucket
        )
        try:
            poster_url = storage_service.generate_download_url(
                poster_path,
                expires_in=VIDEO_MANIFEST_URL_EXPIRES_IN,
                bucket=poster_bucket,
            )
        except ClientError as exc:
            code = (exc.response.get("Error") or {}).get("Code")
            if code not in {"NoSuchKey", "404", "NotFound"}:
                logger.exception(
                    "Failed to generate video poster URL task_id=%s bucket=%s key=%s",
                    task.id,
                    poster_bucket,
                    poster_path,
                )
        except BotoCoreError:
            logger.exception(
                "Failed to generate video poster URL task_id=%s bucket=%s key=%s",
                task.id,
                poster_bucket,
                poster_path,
            )
        except Exception:
            logger.exception(
                "Unexpected video poster URL error task_id=%s bucket=%s key=%s",
                task.id,
                poster_bucket,
                poster_path,
            )

    return TaskVideoManifestResponse(
        task_id=task.id,
        dataset_item_id=task.dataset_item_id,
        video_url=video_url,
        poster_url=poster_url,
        metadata=metadata,
        expires_in=VIDEO_MANIFEST_URL_EXPIRES_IN,
    )


@router.get(
    "/{task_id}/point-cloud/manifest",
    response_model=TaskPointCloudManifestResponse,
)
async def get_point_cloud_manifest(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.db.models.project import Project
    from app.schemas._jsonb_types import SensorCalibration

    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)

    project = await db.get(Project, task.project_id)
    if project is None or project.data_type != "lidar":
        raise HTTPException(status_code=409, detail="Task is not a point-cloud task")

    links = await get_linked_items(db, task_id)

    def _presign(key: str) -> str:
        return storage_service.generate_download_url(
            key,
            expires_in=VIDEO_MANIFEST_URL_EXPIRES_IN,
            bucket=storage_service.datasets_bucket,
        )

    # 一次性取出所有关联 DatasetItem，避免逐 link 往返 DB
    item_ids = [link.dataset_item_id for link in links]
    items_by_id: dict[uuid.UUID, DatasetItem] = {}
    if item_ids:
        rows = (
            (await db.execute(select(DatasetItem).where(DatasetItem.id.in_(item_ids))))
            .scalars()
            .all()
        )
        items_by_id = {item.id: item for item in rows}

    # 主点云 URL：优先 primary_lidar link，否则回退 task.file_path
    point_cloud_url: str | None = None
    primary_link = next((link for link in links if link.role == "primary_lidar"), None)
    if primary_link is not None:
        primary_item = items_by_id.get(primary_link.dataset_item_id)
        if primary_item is not None:
            point_cloud_url = _presign(primary_item.file_path)
    if point_cloud_url is None:
        if not task.file_path:
            raise HTTPException(
                status_code=404, detail="Point cloud file not available"
            )
        point_cloud_url = _presign(task.file_path)

    cameras: list[PointCloudCameraOut] = []
    for link in links:
        if not link.role.startswith("camera_"):
            continue
        item = items_by_id.get(link.dataset_item_id)
        if item is None:
            continue
        calibration: SensorCalibration | None = None
        raw_calib = (item.metadata_ or {}).get("calibration")
        if raw_calib:
            try:
                calibration = SensorCalibration.model_validate(raw_calib)
            except Exception:
                # 入库已经过 attach_calibration 归一化，正常到不了这里；真踩到说明
                # 存了脏标定，别静默吞 —— 记一条 warning 指明是哪个 task/相机被判废。
                logger.warning(
                    "task %s %s: stored calibration failed validation, returning null",
                    task_id,
                    link.role,
                )
                calibration = None
        cameras.append(
            PointCloudCameraOut(
                name=link.role[len("camera_") :],
                role=link.role,
                image_url=_presign(item.file_path),
                calibration=calibration,
            )
        )

    cameras.sort(key=lambda c: c.name)

    # v0.13.11 · 取主点云所在 Dataset 的 axis_convention,前端用它把 PCD positions 与各相机
    # extrinsic 旋转归一化到 ISO 8855。无 primary_lidar item / 无 metadata key → None,
    # 前端按 "iso_8855" (= identity) 处理,保持向后兼容。
    axis_convention = None
    if primary_link is not None:
        primary_item = items_by_id.get(primary_link.dataset_item_id)
        if primary_item is not None:
            dataset = await db.get(Dataset, primary_item.dataset_id)
            if dataset is not None:
                axis_convention = (dataset.metadata_ or {}).get("axis_convention")

    # v0.14.0 · scene 字段透出:仅当 primary_lidar item 有 scene_id 时挂上,
    # 前端用做跨帧导航的合法 backing(本期不消费 UX,仅显示在调试面板)。
    scene_id_out: uuid.UUID | None = None
    scene_name_out: str | None = None
    frame_index_out: int | None = None
    scene_total_frames_out: int | None = None
    ego_pose_out = None
    if primary_link is not None:
        primary_item = items_by_id.get(primary_link.dataset_item_id)
        if primary_item is not None and primary_item.scene_id is not None:
            from app.db.models.dataset import Scene
            from app.services import scene_pose as scene_pose_svc

            scene = await db.get(Scene, primary_item.scene_id)
            if scene is not None:
                scene_id_out = scene.id
                scene_name_out = scene.name
                frame_index_out = primary_item.frame_index
                total_row = await db.execute(
                    select(func.count(func.distinct(DatasetItem.frame_index)))
                    .where(DatasetItem.scene_id == scene.id)
                    .where(DatasetItem.frame_index.is_not(None))
                )
                scene_total_frames_out = total_row.scalar() or 0
                # v0.15.0 · 本帧 ego pose 透出;无位姿行(历史/非 nuScenes) → None
                if primary_item.frame_index is not None:
                    ego_pose_out = await scene_pose_svc.get_frame_pose(
                        db,
                        scene_id=scene.id,
                        frame_index=primary_item.frame_index,
                    )

    return TaskPointCloudManifestResponse(
        task_id=task.id,
        point_cloud_url=point_cloud_url,
        cameras=cameras,
        expires_in=VIDEO_MANIFEST_URL_EXPIRES_IN,
        axis_convention=axis_convention,
        scene_id=scene_id_out,
        scene_name=scene_name_out,
        frame_index=frame_index_out,
        scene_total_frames=scene_total_frames_out,
        ego_pose=ego_pose_out,
    )


@router.get(
    "/{task_id}/neighbors",
    response_model=NeighborsResponse,
)
async def get_task_neighbors(
    task_id: uuid.UUID,
    k: int = Query(1, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.14.0 · 返回 task 在所属 scene 内的前后 k 个邻居 task。

    历史未 backfill / 无 scene_id 的 task → 200 + 空 prev/next(与首末帧一致)。
    scene_id 非空但 frame_index NULL(异常)→ 409。
    """
    from app.services.scene import (
        SceneFrameIndexInconsistent,
        get_neighbors_for_task,
    )

    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)

    try:
        result = await get_neighbors_for_task(db, task_id=task_id, k=k)
    except SceneFrameIndexInconsistent as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if result is None:
        # 与"首末帧"对调用方一致:返回空 prev/next 不要 404,避免前端做无用区分
        return NeighborsResponse(
            scene_id=None,
            scene_name=None,
            frame_index=None,
            scene_total_frames=0,
            prev=[],
            next=[],
        )
    return result


@router.get(
    "/{task_id}/neighbor-annotations",
    response_model=NeighborAnnotationsResponse,
    dependencies=[Depends(require_scopes("annotations:read"))],
)
async def get_neighbor_annotations(
    task_id: uuid.UUID,
    k: int = Query(1, ge=1, le=20),
    group_id: int | None = Query(
        None, description="给定则服务端只回该 group(scope=selected);省略回全部(scope=all)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.15.17 · 中心 task 前后 k 帧的邻帧标注,一次性返回。

    替代前端「对 2k 个邻帧 task 各发一条 getAnnotations + client 端按 group_id 过滤」。
    非 scene / 历史未 backfill 的 task → 200 + frames=[](与 neighbors 端点一致,不报错)。

    v0.15.26 · 可见性:与被替代的旧链路一致,邻帧逐 task 复核 batch 可见性 / 分派状态
    (`_visible_task_ids`)。对调用者不可见的邻帧(如分派给别人 / 状态非可见的 batch)
    仍返回 frame 占位但 `annotations=[]`,不外泄他人 batch 的框几何。
    """
    from app.services.scene import (
        SceneFrameIndexInconsistent,
        get_neighbors_for_task,
    )

    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)

    try:
        neighbors = await get_neighbors_for_task(db, task_id=task_id, k=k)
    except SceneFrameIndexInconsistent as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if neighbors is None or neighbors.scene_id is None:
        return NeighborAnnotationsResponse(scene_id=None, frame_index=None, frames=[])

    frame_by_task = {
        n.task_id: n.frame_index for n in (*neighbors.prev, *neighbors.next)
    }
    if not frame_by_task:
        return NeighborAnnotationsResponse(
            scene_id=neighbors.scene_id,
            frame_index=neighbors.frame_index,
            frames=[],
        )

    # v0.15.26 · 逐邻帧复核可见性,不可见的邻帧 task 不取其 annotation(下面 by_task 占位为空)。
    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    visible_ids = await _visible_task_ids(
        db, project, current_user, list(frame_by_task.keys())
    )

    svc = AnnotationService(db)
    anns = (
        await svc.list_by_tasks(list(visible_ids), group_id=group_id)
        if visible_ids
        else []
    )

    by_task: dict[uuid.UUID, list[AnnotationOut]] = {tid: [] for tid in frame_by_task}
    for a in anns:
        by_task[a.task_id].append(AnnotationOut.model_validate(a))

    # 按距中心帧远近排序(与 neighbors prev/next 顺序一致),便于前端就近渲染
    ordered = [*neighbors.prev, *neighbors.next]
    frames = [
        NeighborFrameAnnotations(
            task_id=n.task_id,
            frame_index=n.frame_index,
            annotations=by_task.get(n.task_id, []),
        )
        for n in ordered
    ]
    return NeighborAnnotationsResponse(
        scene_id=neighbors.scene_id,
        frame_index=neighbors.frame_index,
        frames=frames,
    )


@router.get(
    "/{task_id}/video/frame-timetable",
    response_model=TaskVideoFrameTimetableResponse,
)
async def get_video_frame_timetable(
    task_id: uuid.UUID,
    response: Response,
    from_frame: int | None = Query(default=None, ge=0, alias="from"),
    to_frame: int | None = Query(default=None, ge=0, alias="to"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    if task.file_type != "video":
        raise HTTPException(status_code=400, detail="Task is not a video task")
    response.headers["Cache-Control"] = "private, max-age=3600"

    _, _, _, _, video_metadata = await _attach_dimensions(db, task)
    metadata = VideoMetadata.model_validate(video_metadata or {})
    if not metadata.fps or not metadata.frame_count:
        raise HTTPException(status_code=503, detail="Video metadata not ready")

    if not task.dataset_item_id:
        return TaskVideoFrameTimetableResponse(
            task_id=task.id,
            fps=metadata.fps,
            frame_count=metadata.frame_count,
            source="estimated",
            frames=[],
        )

    has_timetable = (
        await db.execute(
            select(func.count(VideoFrameIndex.id)).where(
                VideoFrameIndex.dataset_item_id == task.dataset_item_id
            )
        )
    ).scalar_one() > 0
    stmt = select(VideoFrameIndex).where(
        VideoFrameIndex.dataset_item_id == task.dataset_item_id
    )
    if from_frame is not None:
        stmt = stmt.where(VideoFrameIndex.frame_index >= from_frame)
    if to_frame is not None:
        stmt = stmt.where(VideoFrameIndex.frame_index <= to_frame)
    rows = (
        (await db.execute(stmt.order_by(VideoFrameIndex.frame_index.asc())))
        .scalars()
        .all()
    )

    body = TaskVideoFrameTimetableResponse(
        task_id=task.id,
        fps=metadata.fps,
        frame_count=metadata.frame_count,
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
    response.headers["ETag"] = (
        f'"video-timetable:{task.dataset_item_id}:{metadata.frame_count}:'
        f'{len(body.frames)}:{from_frame or 0}:{to_frame or ""}"'
    )
    return body


@router.get("/{task_id}/video/manifest-v2", response_model=VideoManifestV2Response)
async def get_video_manifest_v2(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    return await build_video_manifest_v2(db, ctx, str(request.base_url))


@router.get("/{task_id}/video/segments", response_model=VideoSegmentsResponse)
async def get_video_segments(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    return await list_video_segments(db, ctx)


@router.post(
    "/{task_id}/video/segments/{segment_id}:claim",
    response_model=VideoSegmentOut,
)
async def claim_video_segment(
    task_id: uuid.UUID,
    segment_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    privileged = bool(project and is_privileged_for_project(current_user, project))
    body = await claim_segment(db, ctx, segment_id, current_user, privileged=privileged)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_SEGMENT_CLAIM,
        target_type="video_segment",
        target_id=segment_id,
        request=request,
        status_code=200,
        detail={"task_id": str(task.id), "dataset_item_id": str(ctx.item.id)},
    )
    await db.commit()
    return body


@router.post(
    "/{task_id}/video/segments/{segment_id}:heartbeat",
    response_model=VideoSegmentOut,
)
async def heartbeat_video_segment(
    task_id: uuid.UUID,
    segment_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    privileged = bool(project and is_privileged_for_project(current_user, project))
    body = await heartbeat_segment(
        db, ctx, segment_id, current_user, privileged=privileged
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_SEGMENT_HEARTBEAT,
        target_type="video_segment",
        target_id=segment_id,
        request=request,
        status_code=200,
        detail={"task_id": str(task.id), "dataset_item_id": str(ctx.item.id)},
    )
    await db.commit()
    return body


@router.post(
    "/{task_id}/video/segments/{segment_id}:release",
    response_model=VideoSegmentOut,
)
async def release_video_segment(
    task_id: uuid.UUID,
    segment_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    privileged = bool(project and is_privileged_for_project(current_user, project))
    body = await release_segment(
        db, ctx, segment_id, current_user, privileged=privileged
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_SEGMENT_RELEASE,
        target_type="video_segment",
        target_id=segment_id,
        request=request,
        status_code=200,
        detail={"task_id": str(task.id), "dataset_item_id": str(ctx.item.id)},
    )
    await db.commit()
    return body


@router.get("/{task_id}/video/chunks", response_model=VideoChunksResponse)
async def get_video_chunks(
    task_id: uuid.UUID,
    from_frame: int | None = Query(default=None, ge=0),
    to_frame: int | None = Query(default=None, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    return await list_video_chunks(db, ctx, from_frame, to_frame)


@router.get("/{task_id}/video/chunks/{chunk_id}", response_model=VideoChunkOut)
async def get_video_chunk(
    task_id: uuid.UUID,
    chunk_id: int,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    body = await get_video_chunk_asset(db, ctx, chunk_id)
    if body.status == "pending":
        response.status_code = 202
        response.headers["Retry-After"] = str(body.retry_after or 3)
    return body


@router.get("/{task_id}/video/frames/{frame_index}", response_model=VideoFrameOut)
async def get_video_frame(
    task_id: uuid.UUID,
    frame_index: int,
    response: Response,
    format: Literal["webp", "jpeg"] = Query(default="webp"),
    w: int = Query(default=512, ge=1, le=4096),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    body = await get_video_frame_asset(db, ctx, frame_index, w, format)
    if body.status == "pending":
        response.status_code = 202
        response.headers["Retry-After"] = str(body.retry_after or 3)
    response.headers["Cache-Control"] = (
        "private, max-age=3600" if body.status == "ready" else "no-store"
    )
    return body


@router.post(
    "/{task_id}/video/frames:prefetch",
    response_model=VideoFramePrefetchResponse,
)
async def prefetch_video_frame_assets(
    task_id: uuid.UUID,
    payload: VideoFramePrefetchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    return await prefetch_video_frames(
        db, ctx, payload.frame_indices, payload.width, payload.format
    )


@router.post(
    "/{task_id}/video/frames:retry",
    response_model=VideoFramePrefetchResponse,
)
async def retry_video_frame_assets(
    task_id: uuid.UUID,
    payload: VideoFrameRetryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    ctx = await build_context_from_task(db, task)
    return await retry_video_frames(
        db,
        ctx,
        payload.frame_indices,
        payload.width,
        payload.format,
        force=payload.force,
    )


@router.post(
    "/{task_id}/video/tracks/{annotation_id}:propagate",
    response_model=VideoTrackerJobOut,
    status_code=202,
)
async def propagate_video_track(
    task_id: uuid.UUID,
    annotation_id: uuid.UUID,
    payload: VideoTrackerPropagateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    _assert_task_editable(task, current_user)
    ctx = await build_context_from_task(db, task)
    body = await create_tracker_job(
        db,
        task=task,
        ctx=ctx,
        annotation_id=annotation_id,
        payload=payload,
        user=current_user,
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_TRACKER_JOB_CREATE,
        target_type="video_tracker_job",
        target_id=body.id,
        request=request,
        status_code=202,
        detail={
            "task_id": str(task.id),
            "annotation_id": str(annotation_id),
            "dataset_item_id": str(ctx.item.id),
            "segment_id": str(body.segment_id) if body.segment_id else None,
            "from_frame": body.from_frame,
            "to_frame": body.to_frame,
            "model_key": body.model_key,
            "direction": body.direction,
        },
    )
    await db.commit()
    return body


@router.get(
    "/{task_id}/annotations",
    response_model=list[AnnotationOut],
    dependencies=[Depends(require_scopes("annotations:read"))],
)
async def get_annotations(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    svc = AnnotationService(db)
    return await svc.list_by_task(task_id)


@router.get(
    "/{task_id}/annotations/page",
    response_model=AnnotationListPage,
    dependencies=[Depends(require_scopes("annotations:read"))],
)
async def get_annotations_paged(
    task_id: uuid.UUID,
    limit: int = 200,
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.7.6 · keyset 分页变体。单 task 1000+ 框场景下避免一次性大列表阻塞。

    cursor 编码：base64(`{ts_isoformat}|{annotation_id}`)，与 audit_logs 端点一致。
    """
    import base64
    from uuid import UUID as _UUID

    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be in [1, 1000]")

    decoded: tuple[datetime, uuid.UUID] | None = None
    if cursor:
        try:
            payload = base64.urlsafe_b64decode(cursor.encode()).decode()
            ts_str, id_str = payload.rsplit("|", 1)
            decoded = (datetime.fromisoformat(ts_str), _UUID(id_str))
        except Exception:
            raise HTTPException(status_code=400, detail="invalid cursor")

    svc = AnnotationService(db)
    items, next_cursor_tuple = await svc.list_by_task_keyset(
        task_id, limit=limit, cursor=decoded
    )
    next_cursor: str | None = None
    if next_cursor_tuple is not None:
        ts, aid = next_cursor_tuple
        next_cursor = base64.urlsafe_b64encode(
            f"{ts.isoformat()}|{aid}".encode()
        ).decode()
    return AnnotationListPage(
        items=[AnnotationOut.model_validate(a) for a in items],
        next_cursor=next_cursor,
    )


@router.post(
    "/{task_id}/annotations",
    response_model=AnnotationOut,
    status_code=201,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def create_annotation(
    task_id: uuid.UUID,
    data: AnnotationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    svc = AnnotationService(db)
    annotation = await svc.create(
        task_id=task_id,
        user_id=current_user.id,
        annotation_type=data.annotation_type,
        tool_unit_id=data.tool_unit_id,
        class_name=data.class_name,
        geometry=data.geometry.model_dump(),
        confidence=data.confidence,
        parent_prediction_id=data.parent_prediction_id,
        lead_time=data.lead_time,
        attributes=data.attributes,
    )
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    # v0.7.2 · annotation 编辑历史可追溯
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_CREATE,
        target_type="annotation",
        target_id=str(annotation.id),
        request=request,
        status_code=201,
        detail={
            "task_id": str(task_id),
            "class_name": annotation.class_name,
            "annotation_type": annotation.annotation_type,
            "source": annotation.source,
        },
    )
    await db.commit()
    await db.refresh(annotation)
    return annotation


@router.post(
    "/{task_id}/annotations/{annotation_id}/propagate-to-task",
    response_model=PropagateResponse,
    status_code=201,
)
async def propagate_annotation_to_task(
    task_id: uuid.UUID,
    annotation_id: uuid.UUID,
    data: PropagateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.14.1 · 跨帧目标延续: 把源 annotation 复制到 target_task(同 project 同 scene)。

    源 task 需对当前用户可见; 目标 task 需可见且可写(未进 review/completed 锁态)。
    复制 geometry/class/attributes + 共享 group_id; box_3d 的 convention_at_create
    取目标 dataset 的 axis_convention(详 service.propagate)。
    """
    source_task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, source_task, current_user)

    # 归属校验: annotation 必须属于 URL 里的源 task, 否则越权(借可见 task_id
    # 复制同 project 内不可见 batch 的他人草稿)。
    src_annotation = await db.get(Annotation, annotation_id)
    if src_annotation is None or src_annotation.task_id != task_id:
        raise HTTPException(status_code=404, detail="source annotation not found")

    target_task = await _load_task_or_404(db, data.target_task_id)
    await _assert_task_visible(db, target_task, current_user)
    _assert_task_editable(target_task, current_user)

    svc = AnnotationService(db)
    new_annotation, motion_compensated = await svc.propagate(
        source_annotation_id=annotation_id,
        target_task_id=data.target_task_id,
        user_id=current_user.id,
        override_psr=data.override_psr,
    )
    await TaskLockService(db).heartbeat(data.target_task_id, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_CREATE,
        target_type="annotation",
        target_id=str(new_annotation.id),
        request=request,
        status_code=201,
        detail={
            "task_id": str(data.target_task_id),
            "source_task_id": str(task_id),
            "source_annotation_id": str(annotation_id),
            "propagated": True,
            "motion_compensated": motion_compensated,
            "group_id": new_annotation.group_id,
            "class_name": new_annotation.class_name,
        },
    )
    await db.commit()
    await db.refresh(new_annotation)
    return PropagateResponse(
        annotation=AnnotationOut.model_validate(new_annotation),
        motion_compensated=motion_compensated,
    )


@router.post(
    "/{task_id}/annotations/propagate-batch",
    response_model=PropagateBatchResponse,
    status_code=201,
)
async def propagate_annotations_batch(
    task_id: uuid.UUID,
    data: PropagateBatchRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.15.1 · 多目标批量跨帧延续: 把源 task 的多个(或全部)box_3d 一次
    运动补偿 propagate 到目标 task。整批一个事务,任一失败全部回滚。
    """
    source_task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, source_task, current_user)

    target_task = await _load_task_or_404(db, data.target_task_id)
    await _assert_task_visible(db, target_task, current_user)
    _assert_task_editable(target_task, current_user)

    svc = AnnotationService(db)
    results, motion_compensated = await svc.propagate_batch(
        source_task_id=task_id,
        target_task_id=data.target_task_id,
        annotation_ids=data.annotation_ids,
        user_id=current_user.id,
    )
    await TaskLockService(db).heartbeat(data.target_task_id, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_CREATE,
        target_type="task",
        target_id=str(data.target_task_id),
        request=request,
        status_code=201,
        detail={
            "source_task_id": str(task_id),
            "propagated_batch": True,
            "motion_compensated": motion_compensated,
            "count": len(results),
            "created_annotation_ids": [str(ann.id) for _, ann in results],
        },
    )
    await db.commit()
    for _, ann in results:
        await db.refresh(ann)
    return PropagateBatchResponse(
        items=[
            PropagateBatchItem(
                source_annotation_id=src_id,
                annotation=AnnotationOut.model_validate(ann),
            )
            for src_id, ann in results
        ],
        motion_compensated=motion_compensated,
    )


@router.post(
    "/{task_id}/annotations/interpolate-range",
    response_model=InterpolateRangeResponse,
    status_code=201,
)
async def interpolate_annotations_range(
    task_id: uuid.UUID,
    data: InterpolateRangeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.15.1 · 关键帧区间插值: 路径 task = 区间起点帧,body.to_task_id =
    终点帧;同 group_id 链两端各有一个 box_3d,中间帧自动生成插值框
    (source="interpolated")。中间帧已有同 group 标注 → 幂等跳过。
    """
    from_task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, from_task, current_user)

    to_task = await _load_task_or_404(db, data.to_task_id)
    await _assert_task_visible(db, to_task, current_user)

    svc = AnnotationService(db)
    created, motion_compensated, skipped_frames = await svc.interpolate_range(
        group_id=data.group_id,
        from_task_id=task_id,
        to_task_id=data.to_task_id,
        user_id=current_user.id,
        assert_task_editable=lambda t: _assert_task_editable(t, current_user),
        assert_task_visible=lambda t: _assert_task_visible(db, t, current_user),
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_CREATE,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=201,
        detail={
            "interpolate_range": True,
            "group_id": data.group_id,
            "to_task_id": str(data.to_task_id),
            "motion_compensated": motion_compensated,
            "created": len(created),
            "created_annotation_ids": [str(a.id) for a in created],
            "skipped_frames": skipped_frames,
        },
    )
    await db.commit()
    for ann in created:
        await db.refresh(ann)
    return InterpolateRangeResponse(
        annotations=[AnnotationOut.model_validate(a) for a in created],
        motion_compensated=motion_compensated,
        skipped_frames=skipped_frames,
    )


@router.patch(
    "/{task_id}/annotations/{annotation_id}",
    response_model=AnnotationOut,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def update_annotation(
    task_id: uuid.UUID,
    annotation_id: uuid.UUID,
    data: AnnotationUpdate,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _task = await _load_task_or_404(db, task_id)
    _assert_task_editable(_task, current_user)
    svc = AnnotationService(db)
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    # 早 load 一次：用于 If-Match 校验 + 字段级审计 diff（attributes 变更）
    existing = await db.get(Annotation, annotation_id)
    if existing is None or not existing.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")

    before_attributes: dict | None = None
    if "attributes" in fields:
        before_attributes = dict(existing.attributes or {})

    # 乐观并发控制：If-Match 头校验
    if_match = request.headers.get("If-Match", "").strip()
    if if_match:
        expected_version = if_match.removeprefix('W/"').removesuffix('"')
        try:
            expected_v = int(expected_version)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid If-Match format")
        if existing.version != expected_v:
            raise HTTPException(
                status_code=409,
                detail={
                    "reason": "version_mismatch",
                    "current_version": existing.version,
                },
            )

    annotation = await svc.update(annotation_id, **fields)
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if annotation.task_id != task_id:
        raise HTTPException(
            status_code=400, detail="Annotation does not belong to this task"
        )
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    _audit_action = (
        AuditAction.TASK_REVIEWER_EDIT
        if _task.status == "review" and current_user.role in _REVIEWERS
        else AuditAction.ANNOTATION_UPDATE
    )
    await AuditService.log(
        db,
        actor=current_user,
        action=_audit_action,
        target_type="annotation",
        target_id=str(annotation.id),
        request=request,
        status_code=200,
        detail={"task_id": str(task_id), "fields": list(fields.keys())},
    )
    # 字段级审计：每个变更的 attribute key 单独记一行，便于 GIN 索引按 field_key 过滤
    # v0.6.3 Q-2：N 个属性变更 → 一次 add_all + 一次 flush（原本 N 次 flush）
    if before_attributes is not None:
        after_attributes = dict(annotation.attributes or {})
        all_keys = set(before_attributes.keys()) | set(after_attributes.keys())
        change_items: list[dict] = []
        for key in sorted(all_keys):
            before_v = before_attributes.get(key)
            after_v = after_attributes.get(key)
            if before_v == after_v:
                continue
            change_items.append(
                {
                    "target_id": str(annotation.id),
                    "detail": {
                        "task_id": str(task_id),
                        "field_key": key,
                        "before": before_v,
                        "after": after_v,
                    },
                }
            )
        if change_items:
            await AuditService.log_many(
                db,
                actor=current_user,
                action=AuditAction.ANNOTATION_ATTRIBUTE_CHANGE,
                target_type="annotation",
                request=request,
                status_code=200,
                items=change_items,
            )
    await db.commit()
    await db.refresh(annotation)
    response.headers["ETag"] = f'W/"{annotation.version}"'
    return annotation


@router.post(
    "/{task_id}/annotations/video/track-compositions",
    response_model=VideoTrackCompositionResponse,
)
async def compose_video_tracks(
    task_id: uuid.UUID,
    data: VideoTrackCompositionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    _assert_task_editable(task, current_user)
    if not data.annotation_ids:
        raise HTTPException(status_code=400, detail="annotation_ids is required")
    if len(set(data.annotation_ids)) != len(data.annotation_ids):
        raise HTTPException(status_code=400, detail="annotation_ids must be unique")

    annotations: list[Annotation] = []
    for annotation_id in data.annotation_ids:
        ann = await db.get(Annotation, annotation_id)
        if ann is None or not ann.is_active:
            raise HTTPException(status_code=404, detail="Annotation not found")
        if ann.task_id != task_id:
            raise HTTPException(
                status_code=400, detail="Annotation does not belong to this task"
            )
        annotations.append(ann)

    svc = AnnotationService(db)
    try:
        updated, created, deleted_ids = await svc.compose_video_tracks(
            task=task,
            annotations=annotations,
            user_id=current_user.id,
            operation=data.operation,
            frame_index=data.frame_index,
            delete_sources=data.delete_sources,
            gap_mode=data.gap_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_UPDATE,
        target_type="annotation",
        request=request,
        status_code=200,
        detail={
            "task_id": str(task_id),
            "operation": f"video_track.{data.operation}",
            "annotation_ids": [
                str(annotation_id) for annotation_id in data.annotation_ids
            ],
            "frame_index": data.frame_index,
            "created_count": len(created),
            "updated_count": len(updated),
            "deleted_count": len(deleted_ids),
        },
    )
    await db.commit()
    for ann in [*updated, *created]:
        await db.refresh(ann)
    return VideoTrackCompositionResponse(
        operation=data.operation,
        updated_annotations=[
            AnnotationOut.model_validate(ann, from_attributes=True) for ann in updated
        ],
        created_annotations=[
            AnnotationOut.model_validate(ann, from_attributes=True) for ann in created
        ],
        deleted_annotation_ids=deleted_ids,
    )


@router.post(
    "/{task_id}/annotations/{annotation_id}/video/convert-to-bboxes",
    response_model=VideoTrackConvertToBboxesResponse,
)
async def convert_video_track_to_bboxes(
    task_id: uuid.UUID,
    annotation_id: uuid.UUID,
    data: VideoTrackConvertToBboxesRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    _assert_task_editable(task, current_user)
    annotation = await db.get(Annotation, annotation_id)
    if annotation is None or not annotation.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if annotation.task_id != task_id:
        raise HTTPException(
            status_code=400, detail="Annotation does not belong to this task"
        )
    if (annotation.geometry or {}).get("type") != "video_track_bbox":
        raise HTTPException(
            status_code=400, detail="Annotation is not a video_track_bbox"
        )

    svc = AnnotationService(db)
    try:
        (
            source,
            created,
            deleted_source,
            removed_frame_indexes,
        ) = await svc.convert_video_track_to_bboxes(
            task=task,
            annotation=annotation,
            user_id=current_user.id,
            operation=data.operation,
            scope=data.scope,
            frame_index=data.frame_index,
            frame_mode=data.frame_mode,
            frame_count=await _video_frame_count(db, task),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_UPDATE,
        target_type="annotation",
        target_id=str(annotation_id),
        request=request,
        status_code=200,
        detail={
            "task_id": str(task_id),
            "operation": "video_track.convert_to_bboxes",
            "convert_operation": data.operation,
            "scope": data.scope,
            "frame_mode": data.frame_mode,
            "frame_index": data.frame_index,
            "created_count": len(created),
            "deleted_source": deleted_source,
        },
    )
    await db.commit()
    for ann in created:
        await db.refresh(ann)
    if source is not None:
        await db.refresh(source)
    return VideoTrackConvertToBboxesResponse(
        source_annotation=(
            AnnotationOut.model_validate(source, from_attributes=True)
            if source is not None
            else None
        ),
        created_annotations=[
            AnnotationOut.model_validate(ann, from_attributes=True) for ann in created
        ],
        deleted_source=deleted_source,
        removed_frame_indexes=removed_frame_indexes,
    )


@router.get("/{task_id}/predictions", response_model=list[PredictionOut])
async def get_predictions(
    task_id: uuid.UUID,
    model_version: str | None = None,
    min_confidence: float | None = Query(None, ge=0.0, le=1.0),
    limit: int | None = Query(None, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    返回该任务的预测。每个 Prediction.result 内含多个 shape；当 limit 设定时，
    按 shape 置信度 desc 跨 Prediction 排序、截取 [offset, offset+limit]，再回到原 Prediction 容器。
    """
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    svc = PredictionService(db)
    predictions = await svc.list_by_task(task_id, model_version=model_version)

    # v0.9.5 · 一次性 join PredictionMeta 取 cost / inference_time_ms（单条费用透传）
    pred_ids = [p.id for p in predictions]
    meta_map: dict[uuid.UUID, tuple[int | None, float | None]] = {}
    if pred_ids:
        from app.db.models.prediction import PredictionMeta

        meta_rows = await db.execute(
            select(
                PredictionMeta.prediction_id,
                PredictionMeta.inference_time_ms,
                PredictionMeta.total_cost,
            ).where(PredictionMeta.prediction_id.in_(pred_ids))
        )
        for pred_id, ms, cost in meta_rows:
            if pred_id is not None:
                meta_map[pred_id] = (ms, cost)

    # 第一步：LabelStudio → 内部 schema 适配 + min_confidence 过滤
    # v0.9.7 fix · DB 存 LabelStudio 标准 {type, value, score}, 前端期望 {type, class_name,
    # geometry, confidence}. 在 read 路径补 adapter, DB 不动 (保持导出兼容).
    # v0.9.11 · PredictionOut.result 类型从 list[dict] 收紧到 list[PredictionShape], 改为
    # 内部 shape 转换后再构造 PredictionOut (避免 raw LS shape 直接验证失败).
    from app.services.prediction import to_internal_shape

    def _build_out(p, shapes: list[dict]) -> PredictionOut:
        ms, cost = meta_map.get(p.id, (None, None))
        return PredictionOut.model_validate(
            {
                "id": p.id,
                "task_id": p.task_id,
                "project_id": p.project_id,
                "ml_backend_id": p.ml_backend_id,
                "model_version": p.model_version,
                "score": p.score,
                "source": getattr(p, "source", None),
                "tool_unit_id": getattr(p, "tool_unit_id", None) or "bbox",
                "result": shapes,
                "cluster": p.cluster,
                "created_at": p.created_at,
                "inference_time_ms": ms,
                "total_cost": cost,
            }
        )

    base: list[tuple[Any, list[dict]]] = []  # (raw prediction, internal shapes)
    for p in predictions:
        # B-37 · 跳过被驳回的 shape 下标; 防止刷新后 AI 待审框重现.
        rejected_set = set(p.rejected_shape_indexes or [])
        shapes = []
        for shape_index, raw_shape in enumerate(p.result or []):
            if shape_index in rejected_set:
                continue
            shape = dict(to_internal_shape(raw_shape))
            shape["shape_index"] = shape_index
            shapes.append(shape)
        if min_confidence is not None:
            shapes = [s for s in shapes if s.get("confidence", 0.0) >= min_confidence]
        if shapes:
            base.append((p, shapes))

    if limit is None and offset == 0:
        return [_build_out(p, shapes) for p, shapes in base]

    # 第二步：跨 Prediction 按置信度排序 + offset/limit 截取
    flat: list[tuple[int, dict]] = []
    for idx, (_, shapes) in enumerate(base):
        for s in shapes:
            flat.append((idx, s))
    flat.sort(key=lambda x: x[1].get("confidence", 0.0), reverse=True)
    sliced = flat[offset : (offset + limit) if limit else None]

    # 第三步：按原 Prediction 顺序重组
    grouped: dict[int, list[dict]] = {}
    for idx, s in sliced:
        grouped.setdefault(idx, []).append(s)
    result: list[PredictionOut] = []
    for idx, (p, _) in enumerate(base):
        if idx in grouped:
            result.append(_build_out(p, grouped[idx]))
    return result


@router.post(
    "/{task_id}/predictions/{prediction_id}/accept", response_model=list[AnnotationOut]
)
async def accept_prediction(
    task_id: uuid.UUID,
    prediction_id: uuid.UUID,
    shape_index: int | None = Query(
        None,
        ge=0,
        description="可选: 仅采纳指定下标的 shape (一个 prediction 可含多个 shape).",
    ),
    override_class_name: str | None = Query(
        None,
        description=(
            "可选: 采纳时把类别落到指定项目标签 (v0.14.17). 用于预测类名既不在项目标签集、"
            "又无 alias 命中时, 由人当场选项目类别再采纳, 避免 422 拒死。"
        ),
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    svc = AnnotationService(db)
    await svc.accept_prediction(
        prediction_id,
        current_user.id,
        shape_index=shape_index,
        override_class_name=override_class_name,
    )
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await db.commit()
    return await svc.list_by_task(task_id)


@router.post("/{task_id}/predictions/{prediction_id}/reject", status_code=204)
async def reject_prediction(
    task_id: uuid.UUID,
    prediction_id: uuid.UUID,
    shape_index: int | None = Query(
        None,
        ge=0,
        description="可选: 仅驳回指定下标的 shape; 不传则驳回该 Prediction 全部 shape.",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """B-37 · 驳回 AI 预测候选 shape, 持久化到 predictions.rejected_shape_indexes.

    后续 GET /tasks/{id}/predictions 会跳过这些下标, 刷新页面后 AI 待审框不会重现.
    驳回是软操作: prediction 行仍在库中, 仅在该数组追加被拒下标 (去重).
    """
    _assert_task_editable(await _load_task_or_404(db, task_id))
    # v0.10.25 · predictions 复合 PK (id, created_at) 后不能用 db.get(单值)，改按 id 查。
    pred = (
        await db.execute(select(Prediction).where(Prediction.id == prediction_id))
    ).scalar_one_or_none()
    if not pred or pred.task_id != task_id:
        raise HTTPException(status_code=404, detail="Prediction not found")
    total_shapes = len(pred.result or [])
    if shape_index is not None and shape_index >= total_shapes:
        raise HTTPException(
            status_code=400,
            detail=f"shape_index {shape_index} out of range (0..{total_shapes - 1})",
        )
    current = list(pred.rejected_shape_indexes or [])
    current_set = set(current)
    targets = [shape_index] if shape_index is not None else list(range(total_shapes))
    for idx in targets:
        if idx not in current_set:
            current.append(idx)
            current_set.add(idx)
    pred.rejected_shape_indexes = current
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await db.commit()
    return None


@router.delete(
    "/{task_id}/annotations/{annotation_id}",
    status_code=204,
    dependencies=[Depends(require_scopes("annotations:write"))],
)
async def delete_annotation(
    task_id: uuid.UUID,
    annotation_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    # 先取一份 detail 供 audit 用（soft delete 之后字段仍能读，但安全起见提前）
    pre = await db.get(Annotation, annotation_id)
    pre_class = pre.class_name if pre else None
    svc = AnnotationService(db)
    ok = await svc.delete(annotation_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    # v0.7.2 · annotation 编辑历史可追溯
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_DELETE,
        target_type="annotation",
        target_id=str(annotation_id),
        request=request,
        status_code=204,
        detail={"task_id": str(task_id), "soft": True, "class_name": pre_class},
    )
    await db.commit()


@router.post("/{task_id}/submit")
async def submit_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status not in ("pending", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_submittable", "status": task.status},
        )

    # v0.6.6: 提交者即 assignee。任务初始 assignee_id 为 NULL（创建时未指派），
    # 否则后续 withdraw/reopen 会因 assignee 校验失败而拒绝（"only assignee can withdraw"）。
    if task.assignee_id is None:
        task.assignee_id = current_user.id
        # v0.8.4：未预派任务由提交者兜底分派；assigned_at 同步写
        task.assigned_at = datetime.now(timezone.utc)

    task.status = "review"
    task.submitted_at = datetime.now(timezone.utc)
    # 清空上一轮 review 痕迹（reopen → 再次 submit 场景）
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None
    task.reject_reason_type = None

    lock_svc = TaskLockService(db)
    await lock_svc.release(task_id, current_user.id)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_SUBMIT,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
        },
    )

    await db.commit()
    return {"status": "submitted", "task_id": str(task_id)}


_VALID_SKIP_REASONS = {"image_corrupt", "no_target", "unclear", "other"}


class SkipTaskRequest(BaseModel):
    reason: str
    note: str | None = None


@router.post("/{task_id}/skip")
async def skip_task(
    task_id: uuid.UUID,
    body: SkipTaskRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.8.7 F7 · 标注员跳过任务并附原因，自动转 reviewer 复核。

    状态机：
      - pending / in_progress → review（与 submit 行为一致，但不要求有标注）
      - 其他状态 → 409
    业务约束：
      - reason ∈ {image_corrupt, no_target, unclear, other}；其他 422
      - reason="other" 时建议带 note，但 note 可空（前端兜底）
    """
    if body.reason not in _VALID_SKIP_REASONS:
        raise HTTPException(
            status_code=422,
            detail={"reason": "invalid_skip_reason", "value": body.reason},
        )

    task = await _load_task_or_404(db, task_id)
    if task.status not in ("pending", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_skippable", "status": task.status},
        )

    now = datetime.now(timezone.utc)
    if task.assignee_id is None:
        task.assignee_id = current_user.id
        task.assigned_at = now

    task.status = "review"
    task.skip_reason = body.reason
    task.skipped_at = now
    task.submitted_at = now
    # 清空上一轮 review 痕迹
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None
    task.reject_reason_type = None

    lock_svc = TaskLockService(db)
    await lock_svc.release(task_id, current_user.id)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_SKIP,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "skip_reason": body.reason,
            "note": body.note,
        },
    )
    await db.commit()
    return {
        "status": "skipped",
        "task_id": str(task_id),
        "skip_reason": body.reason,
    }


@router.post("/{task_id}/withdraw")
async def withdraw_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.6.5: 标注员撤回质检提交。
    前提：status=review、assignee == 当前用户、reviewer_claimed_at IS NULL。
    审核员一旦 claim 就锁死撤回入口，避免与审核动作打架。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_in_review", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value,
        UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(status_code=403, detail="only assignee can withdraw")
    if task.reviewer_claimed_at is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "task_already_claimed",
                "reviewer_id": str(task.reviewer_id) if task.reviewer_id else None,
            },
        )

    task.status = "in_progress"
    task.submitted_at = None

    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project:
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_WITHDRAW,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={"project_id": str(task.project_id)},
    )

    await db.commit()
    return {"status": "withdrawn", "task_id": str(task_id)}


# ── Review endpoints ───────────────────���────────────────────────────────────


class ReviewAction(BaseModel):
    """v0.10.16 · reviewer 驳回 payload。`reason_type` 自 v0.10.16 起必填，
    `reason` 仍为可空自由文本补充。"""

    reason_type: Literal["missing", "extra", "wrong_label", "wrong_geometry"] | None = (
        None
    )
    reason: str | None = None


@router.post("/{task_id}/review/claim", response_model=ReviewClaimResponse)
async def claim_review(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    """v0.6.5: 审核员进入审核页时调用（幂等）。
    第一个调用者写 reviewer_id + reviewer_claimed_at；
    后续调用者读取已存在的认领信息（不覆盖）。
    `reviewer_claimed_at` 一经设置即冻结标注员的 withdraw 入口。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_in_review", "status": task.status},
        )

    if task.reviewer_claimed_at is None:
        task.reviewer_id = current_user.id
        task.reviewer_claimed_at = datetime.now(timezone.utc)
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.TASK_REVIEW_CLAIM,
            target_type="task",
            target_id=str(task_id),
            request=request,
            status_code=200,
            detail={"project_id": str(task.project_id)},
        )
        await db.commit()

    return ReviewClaimResponse(
        task_id=task.id,
        reviewer_id=task.reviewer_id,
        reviewer_claimed_at=task.reviewer_claimed_at,
        is_self=(task.reviewer_id == current_user.id),
    )


@router.post("/{task_id}/review/approve")
async def approve_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(status_code=400, detail="Task is not in review status")

    task.status = "completed"
    now = datetime.now(timezone.utc)
    task.reviewed_at = now
    if task.reviewer_id is None:
        task.reviewer_id = current_user.id
    if task.reviewer_claimed_at is None:
        task.reviewer_claimed_at = now

    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project:
        project.completed_tasks = (project.completed_tasks or 0) + 1
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_APPROVE,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
        },
    )

    # 通知中心 fan-out：annotator 收到 task.approved（reviewer 自审场景跳过）
    if task.assignee_id is not None and task.assignee_id != current_user.id:
        from app.services.notification import NotificationService

        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=[task.assignee_id],
            type="task.approved",
            target_type="task",
            target_id=task.id,
            payload={
                "task_display_id": task.display_id,
                "project_id": str(task.project_id),
                "actor_id": str(current_user.id),
                "actor_name": current_user.name,
            },
        )

    await db.commit()
    return {"status": "approved", "task_id": str(task_id)}


@router.post("/{task_id}/review/reject")
async def reject_task(
    task_id: uuid.UUID,
    request: Request,
    body: ReviewAction | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(status_code=400, detail="Task is not in review status")

    reason_type = body.reason_type if body else None
    if reason_type is None:
        raise HTTPException(status_code=422, detail="reject reason_type is required")

    reason = (body.reason if body else None) or None
    reason_text = reason.strip() if reason else None

    task.status = "rejected"
    now = datetime.now(timezone.utc)
    task.reviewed_at = now
    task.reject_reason_type = reason_type
    task.reject_reason = reason_text
    if task.reviewer_id is None:
        task.reviewer_id = current_user.id
    if task.reviewer_claimed_at is None:
        task.reviewer_claimed_at = now
    await db.flush()

    # ADR-0027 第二段 · 双写到 annotation_feedbacks (kind=reject, anchor=task)
    from app.services.feedback import FeedbackService

    await FeedbackService(db).mirror_task_reject(task, reviewer_id=current_user.id)

    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project:
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_REJECT,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
            "reason_type": task.reject_reason_type,
            "reason": task.reject_reason,
        },
    )

    if task.assignee_id is not None and task.assignee_id != current_user.id:
        from app.services.notification import NotificationService

        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=[task.assignee_id],
            type="task.rejected",
            target_type="task",
            target_id=task.id,
            payload={
                "task_display_id": task.display_id,
                "project_id": str(task.project_id),
                "reject_reason_type": task.reject_reason_type,
                "reject_reason": task.reject_reason,
                "actor_id": str(current_user.id),
                "actor_name": current_user.name,
            },
        )

    await db.commit()
    return {
        "status": "rejected",
        "task_id": str(task_id),
        "reason_type": task.reject_reason_type,
        "reason": task.reject_reason,
    }


@router.post("/{task_id}/reopen")
async def reopen_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.6.5: 标注员对已通过任务单方面重开编辑。
    前提：status=completed 且 assignee == 当前用户（admin 兜底）。
    清空 reviewer_* 但 detail 留 original_reviewer_id 用于通知；
    annotations 原地保留可继续改，依赖 audit_logs 回溯历史。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "completed":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_completed", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value,
        UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(status_code=403, detail="only assignee can reopen")

    original_reviewer_id = task.reviewer_id
    task.status = "in_progress"
    task.reopened_count = (task.reopened_count or 0) + 1
    task.last_reopened_at = datetime.now(timezone.utc)
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None
    task.reject_reason_type = None
    task.submitted_at = None

    from app.db.models.project import Project

    project = await db.get(Project, task.project_id)
    if project:
        project.completed_tasks = max((project.completed_tasks or 0) - 1, 0)

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_REOPEN,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "original_reviewer_id": str(original_reviewer_id)
            if original_reviewer_id
            else None,
            "reopened_count": task.reopened_count,
        },
    )

    # v0.7.6 · 通知中心 fan-out：原 reviewer 收到 task.reopened
    if original_reviewer_id is not None:
        from app.services.notification import NotificationService

        notif_svc = NotificationService(db)
        await notif_svc.notify_many(
            user_ids=[original_reviewer_id],
            type="task.reopened",
            target_type="task",
            target_id=task.id,
            payload={
                "task_display_id": task.display_id,
                "project_id": str(task.project_id),
                "actor_id": str(current_user.id),
                "actor_name": current_user.name,
                "reopened_count": task.reopened_count,
            },
        )

    await db.commit()
    return {
        "status": "reopened",
        "task_id": str(task_id),
        "reopened_count": task.reopened_count,
    }


@router.post("/{task_id}/accept-rejection")
async def accept_rejection(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """M1 · 标注员接受退回，将 task 从 rejected 转回 in_progress 开始重做。
    不清空 reject_reason（保留审核员退回原因，前端可降级为"重做中"提示）。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "rejected":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_rejected", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value,
        UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(
            status_code=403, detail="only assignee can accept rejection"
        )

    task.status = "in_progress"

    from app.services.batch import BatchService

    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_ACCEPT_REJECTION,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "reject_reason": task.reject_reason,
        },
    )

    await db.commit()
    return {"status": "in_progress", "task_id": str(task_id)}


# ── Task Lock endpoints ─────────────────────────────────────────────────────


@router.post("/{task_id}/lock", response_model=TaskLockResponse)
async def acquire_lock(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    # B-21：任务的当前 assignee 重进时强制接管残留锁，
    # 否则上一个会话残留的他人 lock 会让本人误判"他人正在编辑"。
    task = await _load_task_or_404(db, task_id)
    is_assignee = task.assignee_id is not None and task.assignee_id == current_user.id
    svc = TaskLockService(db)
    lock = await svc.acquire(task_id, current_user.id, force_takeover=is_assignee)
    if not lock:
        active_lock = await svc.active_lock(task_id)
        locked_by = None
        if active_lock:
            briefs = await resolve_briefs(db, [active_lock.user_id])
            brief = briefs.get(str(active_lock.user_id))
            locked_by = brief.model_dump(mode="json") if brief else None
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "task_locked_by_other",
                "message": "Task is locked by another user",
                "user_id": str(active_lock.user_id) if active_lock else None,
                "expire_at": active_lock.expire_at.isoformat() if active_lock else None,
                "locked_by": locked_by,
            },
        )
    await db.commit()
    return lock


@router.post("/{task_id}/lock/heartbeat")
async def heartbeat_lock(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    svc = TaskLockService(db)
    ok = await svc.heartbeat(task_id, current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="No active lock found")
    await db.commit()
    return {"status": "renewed"}


@router.delete("/{task_id}/lock", status_code=204)
async def release_lock(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    svc = TaskLockService(db)
    await svc.release(task_id, current_user.id)
    await db.commit()


# ── Helpers ──────────────────────────────────────────────────────────────────


def _task_with_url(
    task: Task,
    width: int | None = None,
    height: int | None = None,
    thumbnail_path: str | None = None,
    blurhash: str | None = None,
    video_metadata: dict | None = None,
    briefs: dict | None = None,
) -> TaskOut:
    """v0.8.8 · 由手写 dict 改为 ``TaskOut.model_validate`` + 动态字段注入。

    Schema 漂移防护：DB 直读字段（如 v0.8.7 加的 ``skip_reason`` /
    ``skipped_at``、未来新增列）通过 ``from_attributes`` 自动映射，无需在此手写。
    本 helper 仅负责无法从 ORM 直读的部分：

    * ``file_url`` / ``thumbnail_url`` — MinIO presigned 签发
    * ``image_width`` / ``image_height`` / ``blurhash`` —— 来源可能是
      task 自身或关联的 :class:`DatasetItem`
    * ``assignee`` / ``reviewer`` (UserBrief) —— 调用方批量解析后传入
      ``briefs={str(user_id): UserBrief}``
    """
    bucket = (
        storage_service.datasets_bucket
        if task.dataset_item_id
        else storage_service.bucket
    )
    try:
        file_url = storage_service.generate_download_url(task.file_path, bucket=bucket)
    except Exception:
        file_url = None

    thumbnail_url: str | None = None
    if thumbnail_path:
        # v0.10.17 · thumbnails/* 走 media-cache 桶,其它(如旧路径)按 helper 默认走 datasets
        thumb_bucket = storage_service.bucket_for_cache_key(
            thumbnail_path, default=bucket
        )
        try:
            thumbnail_url = storage_service.generate_download_url(
                thumbnail_path, bucket=thumb_bucket
            )
        except Exception:
            pass

    out = TaskOut.model_validate(task, from_attributes=True)
    out.file_url = file_url
    out.thumbnail_url = thumbnail_url
    out.image_width = width
    out.image_height = height
    out.blurhash = blurhash
    out.video_metadata = (
        VideoMetadata.model_validate(video_metadata) if video_metadata else None
    )
    if briefs is not None:
        if task.assignee_id is not None:
            out.assignee = briefs.get(str(task.assignee_id))
        if task.reviewer_id is not None:
            out.reviewer = briefs.get(str(task.reviewer_id))
    return out


async def _attach_dimensions(
    db: AsyncSession,
    task: Task,
) -> tuple[int | None, int | None, str | None, str | None, dict | None]:
    if task.dataset_item_id:
        from app.db.models.dataset import DatasetItem

        item = await db.get(DatasetItem, task.dataset_item_id)
        if item:
            video_metadata = (
                dict((item.metadata_ or {}).get("video") or {})
                if item.file_type == "video"
                else None
            )
            return (
                item.width,
                item.height,
                item.thumbnail_path,
                item.blurhash,
                video_metadata,
            )
    return None, None, task.thumbnail_path, task.blurhash, None


async def _video_frame_count(db: AsyncSession, task: Task) -> int | None:
    if not task.dataset_item_id:
        return None
    item = await db.get(DatasetItem, task.dataset_item_id)
    if not item:
        return None
    video = (item.metadata_ or {}).get("video")
    if not isinstance(video, dict):
        return None
    frame_count = video.get("frame_count")
    try:
        return int(frame_count) if frame_count is not None else None
    except (TypeError, ValueError):
        return None


async def _attach_dimensions_batch(
    db: AsyncSession,
    tasks: list[Task],
) -> dict[
    uuid.UUID, tuple[int | None, int | None, str | None, str | None, dict | None]
]:
    result: dict[
        uuid.UUID,
        tuple[int | None, int | None, str | None, str | None, dict | None],
    ] = {}

    item_ids = [t.dataset_item_id for t in tasks if t.dataset_item_id]
    if item_ids:
        from app.db.models.dataset import DatasetItem

        rows = await db.execute(
            select(
                DatasetItem.id,
                DatasetItem.width,
                DatasetItem.height,
                DatasetItem.thumbnail_path,
                DatasetItem.blurhash,
                DatasetItem.file_type,
                DatasetItem.metadata_,
            ).where(DatasetItem.id.in_(item_ids))
        )
        item_data = {
            row[0]: (
                row[1],
                row[2],
                row[3],
                row[4],
                dict((row[6] or {}).get("video") or {}) if row[5] == "video" else None,
            )
            for row in rows
        }
        for t in tasks:
            if t.dataset_item_id:
                result[t.id] = item_data.get(
                    t.dataset_item_id, (None, None, None, None, None)
                )

    for t in tasks:
        if t.id not in result:
            result[t.id] = (None, None, t.thumbnail_path, t.blurhash, None)

    return result
