import base64
import logging
import uuid
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.task import Task
from app.db.models.dataset import DatasetItem
from app.schemas.task import (
    TaskOut,
    VideoMetadata,
)
from app.services.scheduler import (
    is_privileged_for_project,
    visible_batch_statuses_for,
)
from app.services.storage import storage_service
from app.db.models.task_batch import TaskBatch

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
