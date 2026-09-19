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
from sqlalchemy import String, delete, func, or_, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.enums import (
    MANAGER_PLATFORM_ROLES,
    PlatformRole,
    ProjectRole,
)
from app.db.models.async_job import AsyncJob
from app.db.models.notification import Notification
from app.db.models.notification_preference import NotificationPreference
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.user import User
from app.services.project_aggregates import (
    platform_role_is_manager,
    valid_membership_conditions,
)


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


def _effective_project_text_expr():
    """SQL text expression for a notification's actual project scope.

    Prefers an explicit ``payload.project_id`` and falls back to the owning
    project of an export/async job target.  A malformed or absent value yields
    NULL, which fails closed because it matches no accessible project.
    """

    export_project = (
        select(func.cast(AsyncJob.project_id, String))
        .where(AsyncJob.id == Notification.target_id)
        .correlate(Notification)
        .scalar_subquery()
    )
    return func.coalesce(Notification.payload["project_id"].astext, export_project)


def _is_restricted_expr():
    """A notification is project-restricted when it names or targets a project."""

    return or_(
        Notification.target_type == "export",
        Notification.payload["project_id"].astext.is_not(None),
    )


def _member_project_text_select(user: User, *project_roles: str):
    stmt = (
        select(func.cast(ProjectMember.project_id, String))
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.user_id == user.id, *valid_membership_conditions())
    )
    if project_roles:
        stmt = stmt.where(ProjectMember.role.in_(list(project_roles)))
    return stmt


def _owned_project_text_select(user: User):
    return select(func.cast(Project.id, String)).where(Project.owner_id == user.id)


def _accessible_project_clause(user: User, project_text):
    if user.role == PlatformRole.SUPER_ADMIN.value:
        return None
    arms = [project_text.in_(_member_project_text_select(user))]
    if platform_role_is_manager(user.role):
        arms.append(project_text.in_(_owned_project_text_select(user)))
    return or_(*arms)


def _export_capable_project_clause(user: User, project_text):
    if user.role == PlatformRole.SUPER_ADMIN.value:
        return None
    arms = [
        project_text.in_(_member_project_text_select(user, ProjectRole.REVIEWER.value))
    ]
    if platform_role_is_manager(user.role):
        arms.append(project_text.in_(_owned_project_text_select(user)))
    return or_(*arms)


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
        """Write a de-duplicated fan-out, publishing once for the whole batch.

        Rows are always written with ``defer_publish=True`` internally so the
        delivery re-authorization runs once per fan-out instead of once per row.
        """

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
                defer_publish=True,
            )
            if row is not None:
                out.append(row)
        if not defer_publish and out:
            await self.publish_committed(out)
        return out

    async def _resolve_delivery_scopes(
        self, rows: list[Notification]
    ) -> list[tuple[bool, uuid.UUID | None, bool]]:
        """Resolve ``(restricted, project_id, export_required)`` per notification.

        ``payload.project_id`` is preferred; export/async-job targets resolve the
        owning ``AsyncJob`` in one batched query.  A missing/malformed restricted
        target resolves to ``None`` and therefore fails closed, while a job with
        no project (explicit system/global work) is preserved as global.
        """

        job_ids = {
            row.target_id for row in rows if row.target_type in {"export", "async_job"}
        }
        jobs: dict[uuid.UUID, tuple[uuid.UUID | None, str | None]] = {}
        if job_ids:
            job_rows = await self.db.execute(
                select(AsyncJob.id, AsyncJob.project_id, AsyncJob.kind).where(
                    AsyncJob.id.in_(job_ids)
                )
            )
            jobs = {jid: (pid, kind) for jid, pid, kind in job_rows.all()}

        scopes: list[tuple[bool, uuid.UUID | None, bool]] = []
        for row in rows:
            payload = row.payload if isinstance(row.payload, dict) else {}
            restricted = row.target_type == "export"
            export_required = row.target_type == "export"
            project_id = _notification_project_id(row)
            if "project_id" in payload:
                restricted = True
            if row.target_type in {"export", "async_job"}:
                job = jobs.get(row.target_id)
                if job is None:
                    restricted = True
                    project_id = None
                else:
                    job_project, _job_kind = job
                    if row.target_type == "export":
                        restricted = True
                        export_required = True
                        project_id = job_project
                    elif job_project is not None:
                        restricted = True
                        project_id = job_project
            scopes.append((restricted, project_id, export_required))
        return scopes

    async def _allowed_delivery_indices(
        self,
        rows: list[Notification],
        scopes: list[tuple[bool, uuid.UUID | None, bool]],
    ) -> set[int]:
        pairs = {
            (pid, row.user_id)
            for row, (restricted, pid, _export) in zip(rows, scopes)
            if restricted and pid is not None
        }
        allowed: set[int] = set()
        if not pairs:
            return {
                index
                for index, (restricted, _pid, _export) in enumerate(scopes)
                if not restricted
            }

        member_rows = await self.db.execute(
            select(ProjectMember.project_id, ProjectMember.user_id)
            .join(User, User.id == ProjectMember.user_id)
            .where(
                tuple_(ProjectMember.project_id, ProjectMember.user_id).in_(pairs),
                *valid_membership_conditions(),
            )
        )
        member_pairs = {(pid, uid) for pid, uid in member_rows.all()}

        reviewer_rows = await self.db.execute(
            select(ProjectMember.project_id, ProjectMember.user_id)
            .join(User, User.id == ProjectMember.user_id)
            .where(
                tuple_(ProjectMember.project_id, ProjectMember.user_id).in_(pairs),
                *valid_membership_conditions(),
                ProjectMember.role == ProjectRole.REVIEWER.value,
            )
        )
        reviewer_pairs = {(pid, uid) for pid, uid in reviewer_rows.all()}

        owner_rows = await self.db.execute(
            select(Project.id, Project.owner_id)
            .join(User, User.id == Project.owner_id)
            .where(
                tuple_(Project.id, Project.owner_id).in_(pairs),
                User.is_active.is_(True),
                User.role.in_(list(MANAGER_PLATFORM_ROLES)),
            )
        )
        owner_pairs = {(pid, uid) for pid, uid in owner_rows.all()}

        super_rows = await self.db.execute(
            select(User.id).where(
                User.id.in_({uid for _pid, uid in pairs}),
                User.is_active.is_(True),
                User.role == PlatformRole.SUPER_ADMIN.value,
            )
        )
        super_ids = set(super_rows.scalars().all())
        super_pairs = {(pid, uid) for pid, uid in pairs if uid in super_ids}

        base_pairs = member_pairs | owner_pairs | super_pairs
        export_pairs = reviewer_pairs | owner_pairs | super_pairs
        for index, (restricted, pid, export_required) in enumerate(scopes):
            if not restricted:
                allowed.add(index)
                continue
            if pid is None:
                continue
            pair = (pid, rows[index].user_id)
            if export_required:
                if pair in export_pairs:
                    allowed.add(index)
            elif pair in base_pairs:
                allowed.add(index)
        return allowed

    async def publish_committed(self, notifications: Iterable[Notification]) -> None:
        """Best-effort publish for rows whose enclosing transaction committed.

        This method deliberately does not commit, enqueue, or retain state.  The
        caller owns the request-local collection and invokes it only after a
        successful business ``commit``.  A Redis failure is logged per row and can
        never turn an already committed write into a failed request.

        Project-scoped rows are re-authorized against current project access, so
        losing a membership stops future restricted deliveries for that project
        while unrelated notifications still publish.  Export deliveries require
        the export capability, not mere membership.
        """
        rows = list(notifications)
        try:
            scopes = await self._resolve_delivery_scopes(rows)
            allowed = await self._allowed_delivery_indices(rows, scopes)
        except Exception:
            # Fail closed for project-scoped rows; never turn an already
            # committed business write into a failed request.
            log.exception("notification delivery authorization failed")
            allowed = set()
            for index, row in enumerate(rows):
                payload = row.payload if isinstance(row.payload, dict) else {}
                restricted = row.target_type == "export" or "project_id" in payload
                if not restricted:
                    allowed.add(index)

        for index, row in enumerate(rows):
            if index not in allowed:
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

    def _scope_conditions(self, user: User) -> list:
        """SQL conditions hiding project-restricted rows the account cannot read.

        Mirrors the shared resolver: super administrators see everything; every
        other account sees explicit global rows plus rows whose actual project is
        one they manage or hold a valid membership in.  Export rows additionally
        require the reviewer/manager export capability.
        """

        if user.role == PlatformRole.SUPER_ADMIN.value:
            return []
        project_text = _effective_project_text_expr()
        restricted = _is_restricted_expr()
        return [
            or_(~restricted, _accessible_project_clause(user, project_text)),
            or_(
                Notification.target_type != "export",
                _export_capable_project_clause(user, project_text),
            ),
        ]

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        *,
        unread_only: bool = False,
        limit: int = 30,
        offset: int = 0,
    ) -> tuple[list[Notification], int, int]:
        user = await self.db.get(User, user_id)
        if user is None:
            return [], 0, 0
        scope = self._scope_conditions(user)
        base = select(Notification).where(Notification.user_id == user_id, *scope)
        count_q = select(func.count(Notification.id)).where(
            Notification.user_id == user_id, *scope
        )
        unread_q = select(func.count(Notification.id)).where(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
            *scope,
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
        user = await self.db.get(User, user_id)
        if user is None:
            return 0
        scope = self._scope_conditions(user)
        q = select(func.count(Notification.id)).where(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
            *scope,
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
