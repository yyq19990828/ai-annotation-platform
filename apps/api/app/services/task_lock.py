from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.task_lock import TaskLock


class TaskLockService:
    DEFAULT_TTL = 300

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def acquire(self, task_id: uuid.UUID, user_id: uuid.UUID, ttl: int | None = None) -> TaskLock | None:
        # B-6 修复：表上 unique 约束是 (task_id, user_id)，并不阻止同一 task_id 出现多行（不同用户）。
        # 历史并发 / 残留可能留下重复行，原本 scalar_one_or_none() 会抛 MultipleResultsFound → 500。
        # 这里改为读取全部行：若我已持有则续期并清掉同 task 的他人重复锁；否则视为他人占用。
        await self._cleanup_expired()

        result = await self.db.execute(
            select(TaskLock).where(TaskLock.task_id == task_id)
        )
        locks = list(result.scalars().all())

        my_lock = next((l for l in locks if l.user_id == user_id), None)
        new_expire = datetime.now(timezone.utc) + timedelta(seconds=ttl or self.DEFAULT_TTL)

        if my_lock:
            for l in locks:
                if l is not my_lock:
                    await self.db.delete(l)
            my_lock.expire_at = new_expire
            await self.db.flush()
            return my_lock

        if locks:
            return None

        lock = TaskLock(
            id=uuid.uuid4(),
            task_id=task_id,
            user_id=user_id,
            expire_at=new_expire,
            unique_id=uuid.uuid4(),
        )
        self.db.add(lock)
        await self.db.flush()
        return lock

    async def release(self, task_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            select(TaskLock).where(TaskLock.task_id == task_id, TaskLock.user_id == user_id)
        )
        lock = result.scalar_one_or_none()
        if not lock:
            return False
        await self.db.delete(lock)
        await self.db.flush()
        return True

    async def heartbeat(self, task_id: uuid.UUID, user_id: uuid.UUID, ttl: int | None = None) -> bool:
        result = await self.db.execute(
            select(TaskLock).where(TaskLock.task_id == task_id, TaskLock.user_id == user_id)
        )
        lock = result.scalar_one_or_none()
        if not lock:
            return False
        lock.expire_at = datetime.now(timezone.utc) + timedelta(seconds=ttl or self.DEFAULT_TTL)
        await self.db.flush()
        return True

    async def is_locked(self, task_id: uuid.UUID) -> tuple[bool, uuid.UUID | None]:
        # B-6 修复：见 acquire() 注释 — 同 task_id 可能有多行残留，使用 first() 兜底。
        await self._cleanup_expired()
        result = await self.db.execute(
            select(TaskLock).where(TaskLock.task_id == task_id)
        )
        lock = result.scalars().first()
        if lock:
            return True, lock.user_id
        return False, None

    async def _cleanup_expired(self) -> int:
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            delete(TaskLock).where(TaskLock.expire_at < now)
        )
        return result.rowcount
