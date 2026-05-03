from __future__ import annotations

import uuid
from sqlalchemy import select, func, or_, and_, cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_lock import TaskLock
from app.db.models.annotation import Annotation
from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.user import User
from app.services.task_lock import TaskLockService


def is_privileged_for_project(user: User, project: Project) -> bool:
    """super_admin 或项目 owner 可越权看所有 batch；其他角色受 batch 可见性约束。"""
    return user.role == UserRole.SUPER_ADMIN or project.owner_id == user.id


# 非特权用户只能看到「已发布到工作台」的 batch（draft / archived 等不可见）。
# 与 scheduler.candidates 的 TaskBatch.status.in_(...) 一致。
WORKBENCH_VISIBLE_BATCH_STATUSES = ["active", "annotating"]


def batch_visibility_clause(user: User):
    """返回应用到 TaskBatch 的可见性 WHERE 子句：batch 处于工作台可见状态
    且（批次未分派 或 当前用户在 assigned_user_ids 中）。

    调用方需自行 JOIN TaskBatch。
    """
    user_id_str = str(user.id)
    return and_(
        TaskBatch.status.in_(WORKBENCH_VISIBLE_BATCH_STATUSES),
        or_(
            TaskBatch.assigned_user_ids == cast([], JSONB),
            TaskBatch.assigned_user_ids.contains(cast([user_id_str], JSONB)),
        ),
    )


# 兼容别名（v0.6.10 改名）。如外部调用方未更新可继续工作。
assigned_user_ids_clause = batch_visibility_clause


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

    # 3. Build candidate query: unlabeled, not already annotated by this user
    already_annotated_subq = (
        select(Annotation.task_id)
        .where(Annotation.user_id == user_id, Annotation.is_active.is_(True))
        .scalar_subquery()
    )

    candidates = (
        select(Task)
        .join(TaskBatch, Task.batch_id == TaskBatch.id)
        .where(
            Task.project_id == project_id,
            Task.is_labeled.is_(False),
            ~Task.id.in_(already_annotated_subq),
            TaskBatch.status.in_(["active", "annotating"]),
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
        candidates = candidates.where(Task.total_annotations < project.maximum_annotations)

    # 5. Apply sampling strategy (batch priority as primary sort)
    if project.sampling == "uncertainty":
        candidates = (
            candidates
            .outerjoin(Prediction, Prediction.task_id == Task.id)
            .order_by(TaskBatch.priority.desc(), Prediction.score.asc().nullslast())
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
