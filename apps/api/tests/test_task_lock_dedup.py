"""B-6 回归：task_locks 表 unique 约束是 (task_id, user_id)，不阻止同 task_id 多行。

历史并发 / 残留可能让同一 task_id 出现多行（不同 user_id）。
旧实现里 TaskLockService.acquire / is_locked 与 scheduler.get_next_task
都用 scalar_one_or_none()，遇到多行直接抛 MultipleResultsFound → 500，
前端会同时弹"服务器错误"toast 和"该任务正被其他用户编辑"横幅（即 BUG B-6）。

本套校验：多行残留下，acquire / is_locked 不再 500，并按"我的锁优先 + 清理重复"的策略归一。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_lock import TaskLock
from app.services.task_lock import TaskLockService


async def _seed_project_and_task(db: AsyncSession, owner_id: uuid.UUID) -> Task:
    suffix = uuid.uuid4().hex[:8]
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-LD-{suffix}",
        name="LockDedup",
        type_label="图像-检测",
        type_key="image-det",
        owner_id=owner_id,
        classes=["car"],
    )
    db.add(project)
    await db.flush()

    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id=f"T-LD-{suffix}",
        file_name="x.jpg",
        file_path="/tmp/x.jpg",
        file_type="image",
        tags=[],
        status="in_progress",
        assignee_id=owner_id,
    )
    db.add(task)
    await db.flush()
    return task


def _stale_lock(task_id: uuid.UUID, user_id: uuid.UUID, ttl_s: int = 300) -> TaskLock:
    return TaskLock(
        id=uuid.uuid4(),
        task_id=task_id,
        user_id=user_id,
        expire_at=datetime.now(timezone.utc) + timedelta(seconds=ttl_s),
        unique_id=uuid.uuid4(),
    )


class TestTaskLockMultiRowResilience:
    async def test_acquire_with_my_existing_and_others_stale_renews_and_dedups(
        self, db_session, annotator, reviewer
    ):
        """同 task 出现 [我, 他] 两行残留 → acquire 应续期我的锁，并删除他人残留。"""
        ann_user, _ = annotator
        rev_user, _ = reviewer
        task = await _seed_project_and_task(db_session, owner_id=ann_user.id)

        db_session.add(_stale_lock(task.id, ann_user.id))
        db_session.add(_stale_lock(task.id, rev_user.id))
        await db_session.flush()

        svc = TaskLockService(db_session)
        lock = await svc.acquire(task.id, ann_user.id)

        assert lock is not None
        assert lock.user_id == ann_user.id

        rows = (
            await db_session.execute(
                select(TaskLock).where(TaskLock.task_id == task.id)
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].user_id == ann_user.id

    async def test_acquire_when_only_others_hold_returns_none(
        self, db_session, annotator, reviewer
    ):
        """只剩他人锁残留时，我 acquire 应返回 None（不抛 500），由 endpoint 上抛 409。"""
        ann_user, _ = annotator
        rev_user, _ = reviewer
        task = await _seed_project_and_task(db_session, owner_id=ann_user.id)

        db_session.add(_stale_lock(task.id, rev_user.id))
        await db_session.flush()

        svc = TaskLockService(db_session)
        lock = await svc.acquire(task.id, ann_user.id)
        assert lock is None

    async def test_is_locked_tolerates_multi_row(self, db_session, annotator, reviewer):
        """is_locked 在多行残留下也不能 500。"""
        ann_user, _ = annotator
        rev_user, _ = reviewer
        task = await _seed_project_and_task(db_session, owner_id=ann_user.id)

        db_session.add(_stale_lock(task.id, ann_user.id))
        db_session.add(_stale_lock(task.id, rev_user.id))
        await db_session.flush()

        svc = TaskLockService(db_session)
        locked, _holder = await svc.is_locked(task.id)
        assert locked is True
