from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.dataset import DatasetItem
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_dataset_item_link import TaskDatasetItemLink
from app.db.models.task_lock import TaskLock
from app.db.models.annotation import Annotation
from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.user import User
from app.services.scene import _resolve_primary_item_id
from app.services.task_lock import TaskLockService

_PRIMARY_LIDAR_ROLE = "primary_lidar"


def is_privileged_for_project(user: User, project: Project) -> bool:
    """super_admin 或项目 owner 可越权看所有 batch；其他角色受 batch 可见性约束。"""
    return user.role == UserRole.SUPER_ADMIN or project.owner_id == user.id


# v0.7.0：按角色分拆可见性集合。
# 标注员能看到 active / annotating（自己分派的批次）+ rejected（特例：让他们看到 reviewer 留言并重做）。
# Reviewer 能看到 active / annotating / reviewing（跨批次审核），不受 assigned_user_ids 约束。
ANNOTATOR_VISIBLE_BATCH_STATUSES = ["active", "annotating", "rejected"]
REVIEWER_VISIBLE_BATCH_STATUSES = ["active", "annotating", "reviewing"]

# 兼容别名（保留 B-16 时引入的常量名；指向 annotator 集合的核心三态）。
WORKBENCH_VISIBLE_BATCH_STATUSES = ["active", "annotating"]


def batch_visibility_clause(user: User):
    """返回应用到 TaskBatch 的可见性 WHERE 子句，按角色分支：

    - reviewer：active / annotating / reviewing，**不**受 annotator 约束
    - annotator（默认）：active / annotating（annotator_id == self 或 annotator_id IS NULL）
      + rejected 特例（仅当 annotator_id == self）

    super_admin / 项目 owner 走 is_privileged_for_project 越权放行，不调本 helper。

    v0.7.2：从 list 语义切换为单值（batch.annotator_id）。
    调用方需自行 JOIN TaskBatch。
    """
    if user.role == UserRole.REVIEWER:
        return TaskBatch.status.in_(REVIEWER_VISIBLE_BATCH_STATUSES)

    is_self = TaskBatch.annotator_id == user.id
    return or_(
        and_(
            TaskBatch.status.in_(["active", "annotating"]),
            or_(TaskBatch.annotator_id.is_(None), is_self),
        ),
        # rejected 对**被分派**的标注员可见（看 reviewer 留言 + 重做）
        and_(TaskBatch.status == "rejected", is_self),
    )


def visible_batch_statuses_for(user: User) -> list[str]:
    """非 SQL 路径用：给定角色返回扁平的 status 白名单（用于点查 _assert_task_visible）。"""
    if user.role == UserRole.REVIEWER:
        return list(REVIEWER_VISIBLE_BATCH_STATUSES)
    return list(ANNOTATOR_VISIBLE_BATCH_STATUSES)


# 兼容别名
assigned_user_ids_clause = batch_visibility_clause


async def _filter_assignable_task_ids(
    db: AsyncSession,
    user: User,
    project: Project,
    batch_id: uuid.UUID | None,
    task_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """v0.14.1 · 在 task_ids 子集内套用与 get_next_task 主路径一致的可标候选约束,
    额外排除被**他人**持有的未过期锁。返回可分配的 task_id 集合。"""
    already_annotated = (
        select(Annotation.id)
        .where(
            Annotation.task_id == Task.id,
            Annotation.user_id == user.id,
            Annotation.is_active.is_(True),
        )
        .correlate(Task)
        .exists()
    )
    now = datetime.now(timezone.utc)
    other_lock = (
        select(TaskLock.id)
        .where(
            TaskLock.task_id == Task.id,
            TaskLock.user_id != user.id,
            TaskLock.expire_at > now,
        )
        .correlate(Task)
        .exists()
    )
    q = (
        select(Task.id)
        .join(TaskBatch, Task.batch_id == TaskBatch.id)
        .where(
            Task.id.in_(task_ids),
            Task.project_id == project.id,
            Task.is_labeled.is_(False),
            ~already_annotated,
            ~other_lock,
            TaskBatch.status.in_(["active", "annotating"]),
            TaskBatch.admin_locked.is_(False),
        )
    )
    if batch_id:
        q = q.where(Task.batch_id == batch_id)
    if not is_privileged_for_project(user, project):
        q = q.where(assigned_user_ids_clause(user))
    if project.maximum_annotations > 1:
        q = q.where(Task.total_annotations < project.maximum_annotations)
    rows = (await db.execute(q)).scalars().all()
    return set(rows)


async def _next_same_scene_task(
    db: AsyncSession,
    *,
    user: User,
    project: Project,
    batch_id: uuid.UUID | None,
) -> Task | None:
    """v0.14.1 · scene 连续标注: 找"用户最近提交 task 的同 scene 下一帧"可标 task。

    - 找用户在 window 内最近创建的 active annotation → 其 task → scene_id + frame_index
    - 在该 scene 内取 frame_index 严格大于当前帧的、按帧升序第一个可分配 task
    - 任何一步缺数据(无 recent / 无 scene_id / 无后续帧 / 全被占)→ None,调用方回退既有策略
    不强制独占 scene(其它帧仍可分配给他人)。
    """
    window_min = project.scene_continuation_window_min or 30
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_min)
    recent_task_id = (
        await db.execute(
            select(Annotation.task_id)
            .where(
                Annotation.user_id == user.id,
                Annotation.project_id == project.id,
                Annotation.is_active.is_(True),
                Annotation.created_at >= cutoff,
            )
            .order_by(Annotation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if recent_task_id is None:
        return None

    recent_task = await db.get(Task, recent_task_id)
    if recent_task is None:
        return None
    primary_item_id = await _resolve_primary_item_id(db, recent_task)
    if primary_item_id is None:
        return None
    item = await db.get(DatasetItem, primary_item_id)
    if item is None or item.scene_id is None or item.frame_index is None:
        return None

    next_items = (
        await db.execute(
            select(DatasetItem.id, DatasetItem.frame_index)
            .where(
                DatasetItem.scene_id == item.scene_id,
                DatasetItem.frame_index.is_not(None),
                DatasetItem.frame_index > item.frame_index,
            )
            .order_by(DatasetItem.frame_index)
        )
    ).all()
    if not next_items:
        return None
    next_item_ids = [r[0] for r in next_items]

    # 双路径反查 item → task(直挂 dataset_item_id / primary_lidar link)
    item_to_task: dict[uuid.UUID, uuid.UUID] = {}
    for tid, diid in (
        await db.execute(
            select(Task.id, Task.dataset_item_id).where(
                Task.dataset_item_id.in_(next_item_ids)
            )
        )
    ).all():
        if diid is not None:
            item_to_task[diid] = tid
    for diid, tid in (
        await db.execute(
            select(
                TaskDatasetItemLink.dataset_item_id, TaskDatasetItemLink.task_id
            ).where(
                TaskDatasetItemLink.dataset_item_id.in_(next_item_ids),
                TaskDatasetItemLink.role == _PRIMARY_LIDAR_ROLE,
            )
        )
    ).all():
        item_to_task.setdefault(diid, tid)

    ordered_task_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for diid, _fi in next_items:
        tid = item_to_task.get(diid)
        if tid is not None and tid not in seen:
            seen.add(tid)
            ordered_task_ids.append(tid)
    if not ordered_task_ids:
        return None

    valid = await _filter_assignable_task_ids(
        db, user, project, batch_id, ordered_task_ids
    )
    for tid in ordered_task_ids:
        if tid in valid:
            return await db.get(Task, tid)
    return None


async def get_next_task(
    user: User,
    project_id: uuid.UUID,
    db: AsyncSession,
    batch_id: uuid.UUID | None = None,
) -> Task | None:
    user_id = user.id
    lock_svc = TaskLockService(db)

    # 1. Check if user already has a locked task in this project
    # B-6 修复：用户在同一项目下可能因切换任务残留多把锁，scalar_one_or_none() 会抛 500。
    # 改用 .first() 取最新一把作为"当前任务"。
    locked_result = await db.execute(
        select(TaskLock)
        .join(Task, Task.id == TaskLock.task_id)
        .where(TaskLock.user_id == user_id, Task.project_id == project_id)
        .order_by(TaskLock.expire_at.desc())
    )
    existing_lock = locked_result.scalars().first()
    if existing_lock:
        task = await db.get(Task, existing_lock.task_id)
        if task and not task.is_labeled:
            return task

    # 2. Get project config
    project = await db.get(Project, project_id)
    if not project:
        return None

    # v0.14.1 · scene 连续标注优先(默认 OFF, 既有项目零回归): 显式打开后, 在套用既有
    # sampling 策略前, 优先返回"用户最近提交 task 的同 scene 下一帧"。找不到则回退。
    if project.prefer_same_scene_continuation:
        scene_task = await _next_same_scene_task(
            db, user=user, project=project, batch_id=batch_id
        )
        if scene_task is not None:
            await lock_svc.acquire(
                scene_task.id, user_id, ttl=project.task_lock_ttl_seconds
            )
            return scene_task

    # 3. Build candidate query: unlabeled, not already annotated by this user.
    # v0.11.30 · 相关 NOT EXISTS 取代 NOT IN(子查询)：标注员标注量大时 NOT IN 会让
    # Postgres 物化整个 task_id 集合（大表热路径放大）；NOT EXISTS 可直接走索引短路。
    already_annotated = (
        select(Annotation.id)
        .where(
            Annotation.task_id == Task.id,
            Annotation.user_id == user_id,
            Annotation.is_active.is_(True),
        )
        .correlate(Task)
        .exists()
    )

    candidates = (
        select(Task)
        .join(TaskBatch, Task.batch_id == TaskBatch.id)
        .where(
            Task.project_id == project_id,
            Task.is_labeled.is_(False),
            ~already_annotated,
            TaskBatch.status.in_(["active", "annotating"]),
            TaskBatch.admin_locked.is_(False),  # v0.9.15 · ADR-0008
        )
    )

    # Batch filtering
    if batch_id:
        candidates = candidates.where(Task.batch_id == batch_id)

    # Assignment filtering: super_admin / 项目 owner 越权放行（可代标注员补刀），
    # 其他角色无论是否显式指定 batch_id，都必须命中 assigned_user_ids（或批次未分派）。
    if not is_privileged_for_project(user, project):
        candidates = candidates.where(assigned_user_ids_clause(user))

    # 4. Multi-annotator overlap
    if project.maximum_annotations > 1:
        candidates = candidates.where(
            Task.total_annotations < project.maximum_annotations
        )

    # 5. Apply sampling strategy (batch priority as primary sort)
    if project.sampling == "uncertainty":
        # v0.11.30 · 相关标量子查询取每 task 最低预测分，取代 outerjoin Prediction：
        # outerjoin 会按预测条数行扇出（一 task 多 prediction）再对扇出行排序，大表代价高。
        min_pred_score = (
            select(func.min(Prediction.score))
            .where(Prediction.task_id == Task.id)
            .correlate(Task)
            .scalar_subquery()
        )
        candidates = candidates.order_by(
            TaskBatch.priority.desc(), min_pred_score.asc().nullslast()
        )
    elif project.sampling == "uniform":
        candidates = candidates.order_by(TaskBatch.priority.desc(), func.random())
    else:
        candidates = candidates.order_by(
            TaskBatch.priority.desc(),
            Task.sequence_order.asc().nullslast(),
            Task.created_at,
        )

    # 6. Pick one and lock
    result = await db.execute(candidates.limit(1))
    next_task = result.scalar_one_or_none()

    if next_task:
        await lock_svc.acquire(next_task.id, user_id, ttl=project.task_lock_ttl_seconds)

    return next_task
