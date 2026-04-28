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
        await self._cleanup_expired()

        result = await self.db.execute(
            select(TaskLock).where(TaskLock.task_id == task_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            if existing.user_id == user_id:
                existing.expire_at = datetime.now(timezone.utc) + timedelta(seconds=ttl or self.DEFAULT_TTL)
                await self.db.flush()
                return existing
            return None

        lock = TaskLock(
            id=uuid.uuid4(),
            task_id=task_id,
            user_id=user_id,
            expire_at=datetime.now(timezone.utc) + timedelta(seconds=ttl or self.DEFAULT_TTL),
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
        await self._cleanup_expired()
        result = await self.db.execute(
            select(TaskLock).where(TaskLock.task_id == task_id)
        )
        lock = result.scalar_one_or_none()
        if lock:
            return True, lock.user_id
        return False, None

    async def _cleanup_expired(self) -> int:
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            delete(TaskLock).where(TaskLock.expire_at < now)
        )
        return result.rowcount
