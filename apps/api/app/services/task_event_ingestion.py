"""Trust boundary for Workbench task-time events.

The browser supplies a closed interval, but it cannot choose the account or
project that owns it.  This module is shared by the API and Celery worker so a
queued event is held to the same rules when it is finally persisted.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks._shared import _assert_task_visible
from app.db.enums import UserRole
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_event import TaskEvent
from app.db.models.user import User
from app.schemas.task_event import TaskEventIn

MAX_EVENT_DURATION_MS = 4 * 60 * 60 * 1000
MAX_ANNOTATION_COUNT = 1_000_000
MAX_TIMESTAMP_SKEW_MS = 1
FINAL_CLOSE_GRACE_MS = 5 * 60 * 1000
SESSION_COLLECTOR_VERSION = "session-v2"

_ANNOTATE_ROLES = {
    UserRole.SUPER_ADMIN.value,
    UserRole.PROJECT_ADMIN.value,
    UserRole.ANNOTATOR.value,
}
_REVIEW_ROLES = {
    UserRole.SUPER_ADMIN.value,
    UserRole.PROJECT_ADMIN.value,
    UserRole.REVIEWER.value,
}


def _reject(reason: str, *, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"reason": reason})


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise _reject("timestamp_timezone_required")
    return value.astimezone(timezone.utc)


def validate_interval(
    *,
    started_at: datetime,
    ended_at: datetime,
    duration_ms: int,
    now: datetime | None = None,
) -> tuple[datetime, datetime]:
    """Normalize and validate one event independently of SQLAlchemy."""

    started = _utc(started_at)
    ended = _utc(ended_at)
    if ended < started:
        raise _reject("ended_before_started")
    if duration_ms < 0 or duration_ms > MAX_EVENT_DURATION_MS:
        raise _reject("duration_out_of_range")
    elapsed_ms = round((ended - started).total_seconds() * 1000)
    if abs(elapsed_ms - int(duration_ms)) > MAX_TIMESTAMP_SKEW_MS:
        raise _reject("duration_mismatch")
    current = _utc(now or datetime.now(timezone.utc))
    if ended > current:
        raise _reject("interval_in_future")
    return started, ended


def _within_final_close_grace(
    *, ended_at: datetime | None, transition_at: datetime | None
) -> bool:
    """Keep the terminal-state exception tied to the actual transition."""

    if ended_at is None or transition_at is None:
        return False
    try:
        ended = _utc(ended_at)
        transition = _utc(transition_at)
    except HTTPException:
        return False
    return abs((ended - transition).total_seconds() * 1000) <= FINAL_CLOSE_GRACE_MS


async def assert_task_event_access(
    db: AsyncSession,
    *,
    task: Task,
    user: User,
    kind: str,
    ended_at: datetime | None = None,
) -> None:
    """Apply the normal project/task visibility policy with final-close grace.

    A task can transition to review/completed between the last visible render
    and the next task switch. The task's own actor binding is enough to close
    that actor's interval when its end is within the five-minute transition
    window, while a foreign or stale task still fails the normal policy.
    """

    allowed_roles = _REVIEW_ROLES if kind == "review" else _ANNOTATE_ROLES
    if user.role not in allowed_roles:
        raise _reject("work_type_not_allowed", status_code=403)

    project = await db.get(Project, task.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if user.role != UserRole.SUPER_ADMIN.value and project.owner_id != user.id:
        member = await db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == user.id,
            )
        )
        if member is None:
            raise HTTPException(status_code=404, detail="Task not found")

    try:
        await _assert_task_visible(db, task, user)
    except HTTPException as exc:
        can_close_submitted = (
            kind == "annotate"
            and task.assignee_id == user.id
            and task.submitted_at is not None
            and task.status in {"review", "rejected", "completed"}
            and _within_final_close_grace(
                ended_at=ended_at, transition_at=task.submitted_at
            )
        )
        can_close_reviewed = (
            kind == "review"
            and task.reviewer_id == user.id
            and task.reviewed_at is not None
            and task.status in {"rejected", "completed"}
            and _within_final_close_grace(
                ended_at=ended_at, transition_at=task.reviewed_at
            )
        )
        if exc.status_code != 404 or not (can_close_submitted or can_close_reviewed):
            raise


def _fingerprint(payload: dict[str, Any]) -> tuple[Any, ...]:
    def canonical(value: Any) -> str:
        if isinstance(value, datetime):
            return _utc(value).isoformat()
        return str(value)

    return (
        canonical(payload["task_id"]),
        canonical(payload["user_id"]),
        canonical(payload["project_id"]),
        canonical(payload["kind"]),
        canonical(payload["started_at"]),
        canonical(payload["ended_at"]),
        canonical(payload["duration_ms"]),
        canonical(payload.get("annotation_count", 0)),
        canonical(payload.get("was_rejected", False)),
        canonical(payload.get("collector_version")),
    )


async def validate_api_events(
    db: AsyncSession,
    *,
    user: User,
    events: Iterable[TaskEventIn],
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Validate browser payloads and return authoritative DB-ready rows."""

    event_list = list(events)
    task_ids = {event.task_id for event in event_list}
    task_rows = (
        await db.execute(select(Task).where(Task.id.in_(task_ids)))
        if task_ids
        else None
    )
    tasks = {task.id: task for task in task_rows.scalars()} if task_rows else {}
    seen: dict[UUID, tuple[Any, ...]] = {}
    rows: list[dict[str, Any]] = []
    for event in event_list:
        task = tasks.get(event.task_id)
        if task is None:
            raise _reject("task_not_found", status_code=404)
        if task.project_id != event.project_id:
            raise _reject("task_project_mismatch")
        started, ended = validate_interval(
            started_at=event.started_at,
            ended_at=event.ended_at,
            duration_ms=event.duration_ms,
            now=now,
        )
        await assert_task_event_access(
            db, task=task, user=user, kind=event.kind, ended_at=ended
        )

        event_id = event.client_id or uuid4()
        row = {
            "id": event_id,
            "task_id": task.id,
            "user_id": user.id,
            "project_id": task.project_id,
            "kind": event.kind,
            "started_at": started,
            "ended_at": ended,
            "duration_ms": event.duration_ms,
            "annotation_count": event.annotation_count,
            "was_rejected": event.was_rejected,
            "collector_version": event.collector_version,
            "collection_source": (
                "session"
                if event.collector_version == SESSION_COLLECTOR_VERSION
                else "legacy"
            ),
            "collection_coverage": (
                "qualified"
                if event.collector_version == SESSION_COLLECTOR_VERSION
                else "unverified_collection"
            ),
        }
        if event.client_id is not None:
            fingerprint = _fingerprint(
                {
                    **row,
                    "task_id": str(row["task_id"]),
                    "user_id": str(row["user_id"]),
                    "project_id": str(row["project_id"]),
                    "started_at": started.isoformat(),
                    "ended_at": ended.isoformat(),
                }
            )
            previous = seen.get(event.client_id)
            if previous is not None and previous != fingerprint:
                raise _reject("duplicate_client_event_conflict", status_code=409)
            if previous is not None:
                continue
            seen[event.client_id] = fingerprint
        rows.append(row)

    client_ids = {
        event.client_id for event in event_list if event.client_id is not None
    }
    if client_ids:
        existing = (
            await db.execute(select(TaskEvent).where(TaskEvent.id.in_(client_ids)))
        ).scalars()
        existing_by_id = {row.id: row for row in existing}
        for row in rows:
            stored = existing_by_id.get(row["id"])
            if stored is None:
                continue
            stored_fingerprint = _fingerprint(
                {
                    "task_id": stored.task_id,
                    "user_id": stored.user_id,
                    "project_id": stored.project_id,
                    "kind": stored.kind,
                    "started_at": stored.started_at,
                    "ended_at": stored.ended_at,
                    "duration_ms": stored.duration_ms,
                    "annotation_count": stored.annotation_count,
                    "was_rejected": stored.was_rejected,
                    "collector_version": stored.collector_version,
                }
            )
            if _fingerprint(row) != stored_fingerprint:
                raise _reject("duplicate_client_event_conflict", status_code=409)
    return rows


async def validate_worker_event(
    db: AsyncSession,
    payload: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Revalidate one Celery payload; invalid/stale messages are discarded."""

    try:
        event_id = UUID(str(payload["id"]))
        task_id = UUID(str(payload["task_id"]))
        user_id = UUID(str(payload["user_id"]))
        client_project_id = UUID(str(payload["project_id"]))
        kind = str(payload["kind"])
        started_at = datetime.fromisoformat(str(payload["started_at"]))
        ended_at = datetime.fromisoformat(str(payload["ended_at"]))
        duration_ms = int(payload["duration_ms"])
        annotation_count = int(payload.get("annotation_count", 0))
        was_rejected = bool(payload.get("was_rejected", False))
        collector_version = payload.get("collector_version")
    except (KeyError, TypeError, ValueError):
        return None

    if (
        kind not in {"annotate", "review"}
        or not 0 <= annotation_count <= MAX_ANNOTATION_COUNT
        or (
            collector_version is not None
            and (not isinstance(collector_version, str) or len(collector_version) > 32)
        )
    ):
        return None
    try:
        started, ended = validate_interval(
            started_at=started_at,
            ended_at=ended_at,
            duration_ms=duration_ms,
            now=now,
        )
    except HTTPException:
        return None

    user = await db.get(User, user_id)
    task = await db.get(Task, task_id)
    if user is None or not user.is_active or task is None:
        return None
    if task.project_id != client_project_id:
        return None
    try:
        await assert_task_event_access(
            db, task=task, user=user, kind=kind, ended_at=ended
        )
    except HTTPException:
        return None

    return {
        "id": event_id,
        "task_id": task.id,
        "user_id": user.id,
        "project_id": task.project_id,
        "kind": kind,
        "started_at": started,
        "ended_at": ended,
        "duration_ms": duration_ms,
        "annotation_count": annotation_count,
        "was_rejected": was_rejected,
        "collector_version": collector_version,
        "collection_source": (
            "session" if collector_version == SESSION_COLLECTOR_VERSION else "legacy"
        ),
        "collection_coverage": (
            "qualified"
            if collector_version == SESSION_COLLECTOR_VERSION
            else "unverified_collection"
        ),
    }


async def insert_task_events(
    db: AsyncSession,
    rows: list[dict[str, Any]],
) -> int:
    """Insert idempotently by event ID and return newly inserted row count."""

    if not rows:
        return 0
    result = await db.execute(
        pg_insert(TaskEvent)
        .values(rows)
        .on_conflict_do_nothing(index_elements=[TaskEvent.id])
    )
    await db.commit()
    return max(0, int(result.rowcount or 0))
