"""v0.6.9 · NotificationService: 写表 + Redis Pub/Sub 推送。

频道命名 `notify:{user_id}`，消息体 = NotificationOut JSON。
WS 端订阅同名频道把消息直送到登录会话；同时表里有持久化记录，
WS 断线 / 多端登录 / 离线场景都能从 GET /notifications 拉到。
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterable
from datetime import datetime, timezone

import redis.asyncio as aioredis
from sqlalchemy import select, update, func, and_, delete, or_, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.enums import (
    MANAGER_PLATFORM_ROLES,
    PLATFORM_ROLES,
    PlatformRole,
    ProjectRole,
)
from app.db.models.notification import Notification
from app.db.models.notification_preference import NotificationPreference
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.user import User


log = logging.getLogger(__name__)


def channel_for(user_id: uuid.UUID | str) -> str:
    return f"notify:{user_id}"


def _notification_project_id(row: Notification) -> uuid.UUID | None:
    """Extract the project scope carried by a notification payload, if any."""

    payload = row.payload
    if not isinstance(payload, dict):
        return None
    raw = payload.get("project_id")
    if raw is None:
        return None
    try:
        return uuid.UUID(str(raw))
    except (TypeError, ValueError):
        return None


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _is_in_app_muted(self, user_id: uuid.UUID, type: str) -> bool:
        """v0.7.0：查 notification_preferences；channels.in_app=False 表示用户已静音此 type。
        无记录默认 in_app=True（现网用户向后兼容）。"""
        row = (
            await self.db.execute(
                select(NotificationPreference.channels).where(
                    NotificationPreference.user_id == user_id,
                    NotificationPreference.type == type,
                )
            )
        ).scalar_one_or_none()
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
        defer_publish: bool = False,
    ) -> Notification | None:
        """Write one notification and optionally publish it immediately.

        ``defer_publish`` is intentionally opt-in.  Existing callers retain the
        historical write+best-effort-publish behavior, while request handlers that
        must not publish before their business transaction commits can collect the
        returned rows and call :meth:`publish_committed` after ``db.commit()``.
        """
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

        if not defer_publish:
            await self.publish_committed([row])

        return row

    async def notify_many(
        self,
        *,
        user_ids: list[uuid.UUID],
        type: str,
        target_type: str,
        target_id: uuid.UUID,
        payload: dict | None = None,
        defer_publish: bool = False,
    ) -> list[Notification]:
        """Write a de-duplicated fan-out, optionally deferring all publishes."""
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
                defer_publish=defer_publish,
            )
            if row is not None:
                out.append(row)
        return out

    async def delivery_allowed_pairs(
        self, pairs: set[tuple[uuid.UUID, uuid.UUID]]
    ) -> set[tuple[uuid.UUID, uuid.UUID]]:
        """Pairs of ``(project_id, user_id)`` that may still receive deliveries.

        A project-scoped notification is only delivered while the recipient has
        a current valid membership or legitimate ownership.  One batched query
        per party keeps fan-out delivery from an N+1 lookup.
        """

        if not pairs:
            return set()
        allowed: set[tuple[uuid.UUID, uuid.UUID]] = set()

        member_rows = await self.db.execute(
            select(ProjectMember.project_id, ProjectMember.user_id)
            .join(User, User.id == ProjectMember.user_id)
            .where(
                tuple_(ProjectMember.project_id, ProjectMember.user_id).in_(pairs),
                User.is_active.is_(True),
                User.role.in_(list(PLATFORM_ROLES)),
                or_(
                    User.role != PlatformRole.VIEWER.value,
                    ProjectMember.role == ProjectRole.VIEWER.value,
                ),
            )
        )
        allowed.update((pid, uid) for pid, uid in member_rows.all())

        owner_rows = await self.db.execute(
            select(Project.id, Project.owner_id)
            .join(User, User.id == Project.owner_id)
            .where(
                tuple_(Project.id, Project.owner_id).in_(pairs),
                User.is_active.is_(True),
                User.role.in_(list(MANAGER_PLATFORM_ROLES)),
            )
        )
        allowed.update((pid, uid) for pid, uid in owner_rows.all())
        return allowed

    async def publish_committed(self, notifications: Iterable[Notification]) -> None:
        """Best-effort publish for rows whose enclosing transaction committed.

        This method deliberately does not commit, enqueue, or retain state.  The
        caller owns the request-local collection and invokes it only after a
        successful business ``commit``.  A Redis failure is logged per row and can
        never turn an already committed write into a failed request.

        Project-scoped rows are re-authorized against current project access, so
        losing a membership stops future restricted deliveries for that project
        while unrelated notifications still publish.
        """
        rows = list(notifications)
        pairs: set[tuple[uuid.UUID, uuid.UUID]] = set()
        for row in rows:
            project_id = _notification_project_id(row)
            if project_id is not None:
                pairs.add((project_id, row.user_id))
        try:
            allowed = await self.delivery_allowed_pairs(pairs)
        except Exception:
            # Fail closed for project-scoped rows; never turn an already
            # committed business write into a failed request.
            log.exception("notification delivery authorization failed")
            allowed = set()

        for row in rows:
            project_id = _notification_project_id(row)
            if project_id is not None and (project_id, row.user_id) not in allowed:
                log.info(
                    "notification suppressed for revoked project access user=%s type=%s",
                    row.user_id,
                    row.type,
                )
                continue
            try:
                await _publish(
                    user_id=row.user_id,
                    message={
                        "id": str(row.id),
                        "type": row.type,
                        "target_type": row.target_type,
                        "target_id": str(row.target_id),
                        "payload": row.payload,
                        "created_at": (
                            row.created_at or datetime.now(timezone.utc)
                        ).isoformat(),
                    },
                )
            except Exception as e:
                log.warning(
                    "notification publish failed user=%s type=%s err=%s",
                    row.user_id,
                    row.type,
                    e,
                )

    async def publish_sync(self, user_id: uuid.UUID, *, reason: str) -> None:
        """Best-effort ``notifications.sync`` publication for a committed change.

        Handlers call this only after their business transaction committed and
        only when the operation changed rows, so another session that receives
        the event always observes committed state. Publication failures are
        logged and never turn the already committed request into a failure.
        """
        try:
            await _publish(
                user_id=user_id,
                message={"type": "notifications.sync", "reason": reason},
            )
        except Exception as e:
            log.warning(
                "notification sync publish failed user=%s reason=%s err=%s",
                user_id,
                reason,
                e,
            )

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        *,
        unread_only: bool = False,
        limit: int = 30,
        offset: int = 0,
    ) -> tuple[list[Notification], int, int]:
        base = select(Notification).where(Notification.user_id == user_id)
        count_q = select(func.count(Notification.id)).where(
            Notification.user_id == user_id
        )
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
        """Mark one row read. The handler publishes ``reason=read`` after commit."""
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
        """Mark all rows read. The handler publishes ``reason=read`` after commit."""
        result = await self.db.execute(
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        return int(result.rowcount or 0)

    async def delete_for_user(
        self, user_id: uuid.UUID, notification_id: uuid.UUID
    ) -> bool:
        """Delete one row. The handler publishes ``reason=deleted`` after commit."""
        result = await self.db.execute(
            delete(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user_id,
            )
        )
        return (result.rowcount or 0) > 0

    async def clear_read(self, user_id: uuid.UUID) -> int:
        """Delete all read rows. The handler publishes ``reason=deleted`` after commit."""
        result = await self.db.execute(
            delete(Notification).where(
                Notification.user_id == user_id,
                Notification.read_at.is_not(None),
            )
        )
        return int(result.rowcount or 0)


async def _publish(*, user_id: uuid.UUID, message: dict) -> None:
    r = aioredis.from_url(settings.redis_url)
    try:
        await r.publish(channel_for(user_id), json.dumps(message))
    finally:
        await r.close()
