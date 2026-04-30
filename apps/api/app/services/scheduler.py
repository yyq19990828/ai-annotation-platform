from __future__ import annotations

import uuid
from sqlalchemy import select, func, or_, cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_lock import TaskLock
from app.db.models.annotation import Annotation
from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.services.task_lock import TaskLockService


async def get_next_task(
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    db: AsyncSession,
    batch_id: uuid.UUID | None = None,
) -> Task | None:
    lock_svc = TaskLockService(db)

    # 1. Check if user already has a locked task in this project
    locked_result = await db.execute(
        select(TaskLock)
        .join(Task, Task.id == TaskLock.task_id)
        .where(TaskLock.user_id == user_id, Task.project_id == project_id)
    )
    existing_lock = locked_result.scalar_one_or_none()
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
    else:
        # Only show tasks from batches the user is assigned to (or unassigned batches)
        user_id_str = str(user_id)
        candidates = candidates.where(
            or_(
                TaskBatch.assigned_user_ids == cast([], JSONB),
                TaskBatch.assigned_user_ids.contains(cast([user_id_str], JSONB)),
            )
        )

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
