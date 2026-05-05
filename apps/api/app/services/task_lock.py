from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.task_lock import TaskLock


class TaskLockService:
    DEFAULT_TTL = 300

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def acquire(
        self, task_id: uuid.UUID, user_id: uuid.UUID, ttl: int | None = None
    ) -> TaskLock | None:
        # B-6 修复：表上 unique 约束是 (task_id, user_id)，并不阻止同一 task_id 出现多行（不同用户）。
        # 历史并发 / 残留可能留下重复行，原本 scalar_one_or_none() 会抛 MultipleResultsFound → 500。
        # 这里改为读取全部行：若我已持有则续期并清掉同 task 的他人重复锁；否则视为他人占用。
        await self._cleanup_expired()

        result = await self.db.execute(
            select(TaskLock).where(TaskLock.task_id == task_id)
        )
        locks = list(result.scalars().all())

        # v0.6.8 B-13：同一 user_id 下多行兜底 —— 取 expire_at 最新的那行作为 my_lock，
        # 其余删除（应对 keepalive DELETE / acquire 乱序到达留下的残影）。
        mine = [lock for lock in locks if lock.user_id == user_id]
        my_lock = max(mine, key=lambda lock: lock.expire_at) if mine else None
        others = [lock for lock in locks if lock.user_id != user_id]
        new_expire = datetime.now(timezone.utc) + timedelta(
            seconds=ttl or self.DEFAULT_TTL
        )

        if my_lock:
            for lock in locks:
                if lock is not my_lock:
                    await self.db.delete(lock)
            my_lock.expire_at = new_expire
            await self.db.flush()
            return my_lock

        if others:
            # v0.6.7 B-13：他人锁存在但若全部「即将过期」（last heartbeat > TTL/2 前）→ 视为悬挂残留自动接管。
            # 真活会话每 60s 心跳一次，expire_at - now ∈ [240, 300]；阈值 TTL/2 = 150s 给两次心跳容错窗。
            #
            # 注：v0.6.8 评估过加「持有者非任务 assignee 即接管」，但会破坏审核员合法持锁
            # （reviewer 不是 assignee 仍要锁审核中的任务），舍弃，只保留单锁场景的更宽阈值。
            now = datetime.now(timezone.utc)
            stale_threshold = now + timedelta(seconds=self.DEFAULT_TTL // 2)

            takeover = all(lock.expire_at < stale_threshold for lock in others)
            if takeover:
                for lock in others:
                    await self.db.delete(lock)
                await self.db.flush()
            else:
                return None

        # v0.6.7 二修 B-13：用 INSERT ... ON CONFLICT 而非裸 INSERT，避免快速重进时
        # 两个并发请求都看到「empty + my_lock=None」→ 都尝试 INSERT → 第二个撞
        # unique(task_id, user_id) 抛 IntegrityError → 500 → 前端误显「他人占用」横幅。
        stmt = (
            pg_insert(TaskLock)
            .values(
                id=uuid.uuid4(),
                task_id=task_id,
                user_id=user_id,
                expire_at=new_expire,
                unique_id=uuid.uuid4(),
            )
            .on_conflict_do_update(
                index_elements=["task_id", "user_id"],
                set_={"expire_at": new_expire},
            )
            .returning(TaskLock.id)
        )
        result = await self.db.execute(stmt)
        lock_id = result.scalar_one()
        await self.db.flush()
        # 重新读出实际行（id 可能是新建的或既有的）
        return await self.db.get(TaskLock, lock_id)

    async def release(self, task_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            select(TaskLock).where(
                TaskLock.task_id == task_id, TaskLock.user_id == user_id
            )
        )
        lock = result.scalar_one_or_none()
        if not lock:
            return False
        await self.db.delete(lock)
        await self.db.flush()
        return True

    async def heartbeat(
        self, task_id: uuid.UUID, user_id: uuid.UUID, ttl: int | None = None
    ) -> bool:
        result = await self.db.execute(
            select(TaskLock).where(
                TaskLock.task_id == task_id, TaskLock.user_id == user_id
            )
        )
        lock = result.scalar_one_or_none()
        if not lock:
            return False
        lock.expire_at = datetime.now(timezone.utc) + timedelta(
            seconds=ttl or self.DEFAULT_TTL
        )
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
        result = await self.db.execute(delete(TaskLock).where(TaskLock.expire_at < now))
        return result.rowcount
