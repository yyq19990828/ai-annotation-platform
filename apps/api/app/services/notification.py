"""v0.6.9 · NotificationService: 写表 + Redis Pub/Sub 推送。

频道命名 `notify:{user_id}`，消息体 = NotificationOut JSON。
WS 端订阅同名频道把消息直送到登录会话；同时表里有持久化记录，
WS 断线 / 多端登录 / 离线场景都能从 GET /notifications 拉到。
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis
from sqlalchemy import select, update, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.notification import Notification
from app.db.models.notification_preference import NotificationPreference


log = logging.getLogger(__name__)


def channel_for(user_id: uuid.UUID | str) -> str:
    return f"notify:{user_id}"


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _is_in_app_muted(self, user_id: uuid.UUID, type: str) -> bool:
        """v0.7.0：查 notification_preferences；channels.in_app=False 表示用户已静音此 type。
        无记录默认 in_app=True（现网用户向后兼容）。"""
        row = (await self.db.execute(
            select(NotificationPreference.channels).where(
                NotificationPreference.user_id == user_id,
                NotificationPreference.type == type,
            )
        )).scalar_one_or_none()
        if row is None:
            return False
        in_app = row.get("in_app", True) if isinstance(row, dict) else True
        return not bool(in_app)

    async def notify(
        self,
        *,
        user_id: uuid.UUID,
        type: str,
        target_type: str,
        target_id: uuid.UUID,
        payload: dict | None = None,
    ) -> Notification | None:
        """v0.7.0：偏好静音的 type 直接跳过（不写表、不发 pubsub）。"""
        if await self._is_in_app_muted(user_id, type):
            return None

        row = Notification(
            id=uuid.uuid4(),
            user_id=user_id,
            type=type,
            target_type=target_type,
            target_id=target_id,
            payload=payload or {},
        )
        self.db.add(row)
        await self.db.flush()

        try:
            await _publish(
                user_id=user_id,
                message={
                    "id": str(row.id),
                    "type": row.type,
                    "target_type": row.target_type,
                    "target_id": str(row.target_id),
                    "payload": row.payload,
                    "created_at": (row.created_at or datetime.now(timezone.utc)).isoformat(),
                },
            )
        except Exception as e:
            log.warning("notification publish failed user=%s type=%s err=%s", user_id, type, e)

        return row

    async def notify_many(
        self,
        *,
        user_ids: list[uuid.UUID],
        type: str,
        target_type: str,
        target_id: uuid.UUID,
        payload: dict | None = None,
    ) -> list[Notification]:
        out: list[Notification] = []
        seen: set[uuid.UUID] = set()
        for uid in user_ids:
            if uid in seen:
                continue
            seen.add(uid)
            row = await self.notify(
                user_id=uid,
                type=type,
                target_type=target_type,
                target_id=target_id,
                payload=payload,
            )
            if row is not None:
                out.append(row)
        return out

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        *,
        unread_only: bool = False,
        limit: int = 30,
        offset: int = 0,
    ) -> tuple[list[Notification], int, int]:
        base = select(Notification).where(Notification.user_id == user_id)
        count_q = select(func.count(Notification.id)).where(Notification.user_id == user_id)
        unread_q = select(func.count(Notification.id)).where(
            and_(Notification.user_id == user_id, Notification.read_at.is_(None))
        )

        q = base
        if unread_only:
            q = q.where(Notification.read_at.is_(None))
        q = q.order_by(Notification.created_at.desc()).offset(offset).limit(limit)

        items = list((await self.db.execute(q)).scalars().all())
        total = (await self.db.execute(count_q)).scalar() or 0
        unread = (await self.db.execute(unread_q)).scalar() or 0
        return items, int(total), int(unread)

    async def unread_count(self, user_id: uuid.UUID) -> int:
        q = select(func.count(Notification.id)).where(
            and_(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
        return int((await self.db.execute(q)).scalar() or 0)

    async def mark_read(self, user_id: uuid.UUID, notification_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            update(Notification)
            .where(
                Notification.id == notification_id,
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        return (result.rowcount or 0) > 0

    async def mark_all_read(self, user_id: uuid.UUID) -> int:
        result = await self.db.execute(
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        return int(result.rowcount or 0)


async def _publish(*, user_id: uuid.UUID, message: dict) -> None:
    r = aioredis.from_url(settings.redis_url)
    try:
        await r.publish(channel_for(user_id), json.dumps(message))
    finally:
        await r.close()
