"""Project member performance aggregation.

The service reads immutable workflow audit rows for attribution and uses
current task rows only for the load snapshot.  Mutable ``Task`` reviewer and
assignee fields are never used to rewrite historical credit.
"""

from __future__ import annotations

import base64
import csv
import io
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import (
    String,
    and_,
    cast,
    func,
    literal,
    or_,
    select,
    text,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.annotation import Annotation
from app.db.models.audit_log import AuditLog
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_event import TaskEvent
from app.db.models.user import User
from app.services.scheduler import (
    effective_task_assignee_expr,
    effective_task_reviewer_expr,
)
from app.schemas.project_performance import (
    PerformanceBreakdown,
    PerformanceCoverage,
    PerformanceEvidenceItem,
    PerformanceEventsResponse,
    PerformanceMember,
    PerformanceMemberDetailResponse,
    PerformanceMemberMetrics,
    PerformanceMembersResponse,
    PerformanceMetric,
    PerformanceScope,
    PerformanceGeometryBreakdown,
    PerformanceSourceBreakdown,
    PerformanceTotals,
    PerformanceTrendPoint,
)
from app.services.audit import AuditAction
from app.services.csv_export import csv_literal


_WORKFLOW_ACTIONS = (
    AuditAction.TASK_SUBMIT.value,
    AuditAction.TASK_REVIEW_CLAIM.value,
    AuditAction.TASK_APPROVE.value,
    AuditAction.TASK_REJECT.value,
    AuditAction.TASK_REOPEN.value,
    AuditAction.TASK_ACCEPT_REJECTION.value,
    AuditAction.TASK_SKIP.value,
)
_DECISION_ACTIONS = {
    AuditAction.TASK_APPROVE.value,
    AuditAction.TASK_REJECT.value,
}
# A skip starts a review round and must remain available for round snapshots,
# but it is not a successful annotation submission.
_ROUND_START_ACTIONS = {
    AuditAction.TASK_SUBMIT.value,
    AuditAction.TASK_SKIP.value,
}
_SUBMISSION_ACTIONS = {
    AuditAction.TASK_SUBMIT.value,
}
_ANNOTATION_ACTIONS = {
    AuditAction.TASK_SUBMIT.value,
    AuditAction.TASK_REOPEN.value,
    AuditAction.TASK_ACCEPT_REJECTION.value,
    AuditAction.TASK_SKIP.value,
}
_REVIEW_ACTIONS = {
    AuditAction.TASK_REVIEW_CLAIM.value,
    AuditAction.TASK_APPROVE.value,
    AuditAction.TASK_REJECT.value,
}
_ANNOTATION_BACKLOG = {"pending", "in_progress", "rejected"}
_MAX_CALENDAR_DAYS = 90


@dataclass(frozen=True)
class ResolvedScope:
    start: datetime
    end: datetime
    timezone_name: str
    as_of: datetime

    def output(self) -> PerformanceScope:
        return PerformanceScope(
            from_=self.start,
            to=self.end,
            timezone=self.timezone_name,
            as_of=self.as_of,
        )


@dataclass(frozen=True)
class RosterEntry:
    user: User
    project_role: str | None
    is_owner: bool
    is_current_member: bool
    member_since: datetime | None


def _parse_boundary(raw: str | None, zone: ZoneInfo, *, end: bool) -> datetime | None:
    if raw is None:
        return None
    try:
        if len(raw) == 10:
            local_date = date.fromisoformat(raw)
            local = datetime.combine(local_date, time.min, tzinfo=zone)
            return local.astimezone(timezone.utc)
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"invalid date boundary: {raw}"
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=zone)
    return parsed.astimezone(timezone.utc)


def resolve_scope(
    from_: str | None = None,
    to: str | None = None,
    timezone_name: str | None = None,
    *,
    now: datetime | None = None,
) -> ResolvedScope:
    """Resolve local date boundaries to a half-open UTC interval."""
    name = timezone_name or "Asia/Shanghai"
    try:
        zone = ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(
            status_code=422, detail=f"unknown timezone: {name}"
        ) from exc
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    local_today = current.astimezone(zone).date()
    default_start = datetime.combine(
        local_today - timedelta(days=6), time.min, tzinfo=zone
    ).astimezone(timezone.utc)
    start = _parse_boundary(from_, zone, end=False) or default_start
    end = _parse_boundary(to, zone, end=True) or current
    if end > current + timedelta(minutes=1):
        raise HTTPException(
            status_code=422, detail="performance interval cannot end in the future"
        )
    if end > current:
        end = current
    if end <= start:
        raise HTTPException(
            status_code=422, detail="performance interval must be non-empty"
        )
    # Scope length is measured in complete local calendar days.  This keeps a
    # 90-day date-only range stable across DST transitions and also accepts the
    # equal-duration instant range used by the UI's previous-period query.
    local_start = start.astimezone(zone).replace(tzinfo=None)
    local_end = end.astimezone(zone).replace(tzinfo=None)
    if (local_end - local_start).days > _MAX_CALENDAR_DAYS:
        raise HTTPException(
            status_code=422, detail="performance interval is limited to 90 days"
        )
    return ResolvedScope(start=start, end=end, timezone_name=name, as_of=current)


def _decode_offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        value = json.loads(raw)
        offset = int(value["offset"])
        if offset < 0:
            raise ValueError
        return offset
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=422, detail="invalid performance cursor"
        ) from exc


def _encode_offset(offset: int) -> str:
    raw = json.dumps({"offset": offset}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _as_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _annotation_source_label(source: Any, imported: Any) -> str:
    """Prefer the authoritative import marker over the legacy source value."""
    if str(imported).casefold() in {"true", "1", "t"}:
        return "imported"
    return str(source or "manual")


def _detail(log: AuditLog) -> dict[str, Any]:
    return log.detail_json if isinstance(log.detail_json, dict) else {}


def _project_audit_filter(project_id: UUID):
    # ``contains`` works on PostgreSQL JSONB and is also understood by the
    # SQLite test dialect used by the API unit suite.
    return AuditLog.detail_json.contains({"project_id": str(project_id)})


async def resolve_performance_access(
    db: AsyncSession,
    project_id: UUID,
    user: User,
) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    team_access = user.role == UserRole.SUPER_ADMIN.value or project.owner_id == user.id
    if team_access:
        return project
    raise HTTPException(
        status_code=403, detail="仅项目负责人或超级管理员可查看项目绩效"
    )


async def _load_workflow(
    db: AsyncSession,
    project_id: UUID,
    *,
    start: datetime,
    end: datetime,
    task_ids: set[str] | None = None,
    actions: tuple[str, ...] = _WORKFLOW_ACTIONS,
    member_id: UUID | None = None,
    work_type: str | None = None,
) -> list[AuditLog]:
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.action.in_(actions),
            AuditLog.status_code == 200,
            _project_audit_filter(project_id),
            AuditLog.created_at < end,
            AuditLog.created_at >= start,
        )
        .order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
    )
    if task_ids:
        stmt = stmt.where(AuditLog.target_id.in_(task_ids))
    if member_id is not None:
        if work_type == "review":
            stmt = stmt.where(
                AuditLog.actor_id == member_id,
                AuditLog.action.in_(_REVIEW_ACTIONS),
            )
        else:
            stmt = stmt.where(
                or_(
                    and_(
                        AuditLog.actor_id == member_id,
                        AuditLog.action.in_(_ANNOTATION_ACTIONS),
                    ),
                    and_(
                        AuditLog.action.in_(_DECISION_ACTIONS),
                        AuditLog.detail_json.contains(
                            {"contributor_ids": [str(member_id)]}
                        ),
                    ),
                )
            )
    return list((await db.execute(stmt)).scalars().all())


async def _load_submission_history(
    db: AsyncSession,
    project_id: UUID,
    *,
    start: datetime,
    end: datetime,
    task_ids: set[str],
    decision_round_ids: set[str],
    interval_submit_task_ids: set[str],
) -> tuple[list[AuditLog], set[str]]:
    """Load only snapshots needed by in-range decisions and resubmission flags."""
    if not task_ids:
        return [], set()

    snapshots: list[AuditLog] = []
    if decision_round_ids:
        snapshot_stmt = (
            select(AuditLog)
            .where(
                AuditLog.action.in_(_ROUND_START_ACTIONS),
                AuditLog.status_code == 200,
                _project_audit_filter(project_id),
                AuditLog.target_id.in_(task_ids),
                AuditLog.detail_json["review_round_id"].astext.in_(decision_round_ids),
                AuditLog.created_at < end,
            )
            .order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
        )
        snapshots = list((await db.execute(snapshot_stmt)).scalars().all())

    prior_submission_task_ids: set[str] = set()
    if interval_submit_task_ids:
        prior_stmt = (
            select(AuditLog.target_id)
            .where(
                AuditLog.action.in_(_SUBMISSION_ACTIONS),
                AuditLog.status_code == 200,
                _project_audit_filter(project_id),
                AuditLog.target_id.in_(interval_submit_task_ids),
                AuditLog.created_at < start,
            )
            .distinct()
        )
        prior_submission_task_ids = {
            str(target_id)
            for (target_id,) in (await db.execute(prior_stmt)).all()
            if target_id is not None
        }
    return snapshots, prior_submission_task_ids


async def _load_submission_coverage(
    db: AsyncSession,
    project_id: UUID,
    scope: ResolvedScope,
) -> str:
    """Detect old video rounds whose submit audit was never retained."""
    submit_exists = (
        select(AuditLog.id)
        .where(
            AuditLog.action.in_(_ROUND_START_ACTIONS),
            AuditLog.status_code == 200,
            _project_audit_filter(project_id),
            AuditLog.target_id == cast(Task.id, String),
            AuditLog.created_at >= scope.start,
            AuditLog.created_at < scope.end,
        )
        .correlate(Task)
        .exists()
    )
    missing = await db.scalar(
        select(func.count(Task.id)).where(
            Task.project_id == project_id,
            Task.file_type == "video",
            Task.submitted_at >= scope.start,
            Task.submitted_at < scope.end,
            ~submit_exists,
        )
    )
    return "partial" if int(missing or 0) else "complete"


@dataclass(frozen=True)
class QualifiedTime:
    minutes: dict[UUID, dict[str, float]]
    coverage: dict[UUID, dict[str, str]]
    total_minutes: dict[str, float]
    total_coverage: dict[str, str]


async def _load_qualified_time(
    db: AsyncSession,
    project_id: UUID,
    scope: ResolvedScope,
    user_ids: set[UUID] | None = None,
) -> QualifiedTime:
    """Union qualified ranges in PostgreSQL before rows reach Python."""
    user_clause = ""
    params: dict[str, Any] = {
        "project_id": project_id,
        "start_at": scope.start,
        "end_at": scope.end,
    }
    if user_ids:
        if len(user_ids) == 1:
            user_clause = " AND te.user_id = :user_id"
            params["user_id"] = next(iter(user_ids))
        else:
            # The list is the filtered roster, never an unbounded event list.
            user_clause = " AND te.user_id = ANY(:user_ids)"
            params["user_ids"] = list(user_ids)

    coverage_rows = await db.execute(
        text(
            f"""
            SELECT te.user_id, te.kind,
                   count(*) AS total_count,
                   count(*) FILTER (
                       WHERE te.collection_source = 'session'
                         AND te.collection_coverage = 'qualified'
                   )
                       AS qualified_count
            FROM task_events AS te
            JOIN tasks AS t ON t.id = te.task_id
            WHERE t.project_id = :project_id
              AND te.project_id = :project_id
              AND te.started_at < :end_at
              AND te.ended_at > :start_at
              {user_clause}
            GROUP BY te.user_id, te.kind
            """
        ),
        params,
    )
    coverage_map = {
        (row.user_id, row.kind): (int(row.total_count), int(row.qualified_count))
        for row in coverage_rows
    }
    duration_rows = await db.execute(
        text(
            f"""
            WITH clipped AS (
                SELECT te.user_id, te.kind,
                       GREATEST(te.started_at, :start_at) AS interval_start,
                       LEAST(te.ended_at, :end_at) AS interval_end
                FROM task_events AS te
                JOIN tasks AS t ON t.id = te.task_id
                WHERE t.project_id = :project_id
                  AND te.project_id = :project_id
                  AND te.started_at < :end_at
                  AND te.ended_at > :start_at
                  AND te.collection_source = 'session'
                  AND te.collection_coverage = 'qualified'
                  {user_clause}
            ), ordered AS (
                SELECT *,
                       max(interval_end) OVER (
                           PARTITION BY user_id, kind
                           ORDER BY interval_start, interval_end
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                       ) AS previous_end
                FROM clipped
            ), marked AS (
                SELECT *,
                       sum(
                           CASE
                               WHEN previous_end IS NULL
                                    OR interval_start > previous_end THEN 1
                               ELSE 0
                           END
                       ) OVER (
                           PARTITION BY user_id, kind
                           ORDER BY interval_start, interval_end
                           ROWS UNBOUNDED PRECEDING
                       ) AS interval_group
                FROM ordered
            ), merged AS (
                SELECT user_id, kind, interval_group,
                       min(interval_start) AS interval_start,
                       max(interval_end) AS interval_end
                FROM marked
                GROUP BY user_id, kind, interval_group
            )
            SELECT user_id, kind,
                   sum(EXTRACT(EPOCH FROM (interval_end - interval_start))) / 60.0
                       AS minutes
            FROM merged
            GROUP BY user_id, kind
            """
        ),
        params,
    )
    minutes: dict[UUID, dict[str, float]] = defaultdict(dict)
    coverage: dict[UUID, dict[str, str]] = defaultdict(dict)
    total_minutes: dict[str, float] = {}
    total_coverage: dict[str, str] = {}
    for row in duration_rows:
        minutes[row.user_id][row.kind] = round(float(row.minutes or 0), 1)
    for (user_id, kind), (total_count, qualified_count) in coverage_map.items():
        if qualified_count:
            coverage[user_id][kind] = (
                "partial" if qualified_count < total_count else "complete"
            )
        else:
            coverage[user_id][kind] = "unknown"
    for kind in {"annotate", "review"}:
        members = [
            (user_id, stats.get(kind, 0.0))
            for user_id, stats in minutes.items()
            if kind in stats
        ]
        if members:
            total_minutes[kind] = round(sum(value for _, value in members), 1)
            total_coverage[kind] = (
                "partial"
                if any(
                    total_count > qualified_count
                    for (user_id, event_kind), (
                        total_count,
                        qualified_count,
                    ) in coverage_map.items()
                    if event_kind == kind
                )
                else "complete"
            )
        else:
            total_coverage[kind] = "unknown"
    return QualifiedTime(
        minutes=dict(minutes),
        coverage=dict(coverage),
        total_minutes=total_minutes,
        total_coverage=total_coverage,
    )


def _union_minutes(intervals: list[tuple[datetime, datetime]]) -> float:
    if not intervals:
        return 0.0
    intervals.sort(key=lambda item: item[0])
    merged_start, merged_end = intervals[0]
    total_seconds = 0.0
    for start, end in intervals[1:]:
        if start <= merged_end:
            merged_end = max(merged_end, end)
            continue
        total_seconds += (merged_end - merged_start).total_seconds()
        merged_start, merged_end = start, end
    total_seconds += (merged_end - merged_start).total_seconds()
    return total_seconds / 60


def _qualified_time(events: list[TaskEvent], scope: ResolvedScope) -> QualifiedTime:
    """Clip and union qualified sessions independently per member and kind."""
    all_intervals: dict[tuple[UUID, str], list[tuple[datetime, datetime]]] = (
        defaultdict(list)
    )
    qualified_intervals: dict[tuple[UUID, str], list[tuple[datetime, datetime]]] = (
        defaultdict(list)
    )
    users_by_kind: dict[str, set[UUID]] = defaultdict(set)
    for event in events:
        if event.kind not in {"annotate", "review"}:
            continue
        start = max(event.started_at, scope.start)
        end = min(event.ended_at, scope.end)
        if end <= start:
            continue
        key = (event.user_id, event.kind)
        all_intervals[key].append((start, end))
        users_by_kind[event.kind].add(event.user_id)
        if (
            event.collection_source == "session"
            and event.collection_coverage == "qualified"
        ):
            qualified_intervals[key].append((start, end))

    minutes: dict[UUID, dict[str, float]] = defaultdict(dict)
    coverage: dict[UUID, dict[str, str]] = defaultdict(dict)
    total_minutes: dict[str, float] = {}
    total_coverage: dict[str, str] = {}
    for kind in {"annotate", "review"}:
        kind_total = 0.0
        kind_has_qualified = False
        kind_has_unverified = False
        for user_id in users_by_kind[kind]:
            key = (user_id, kind)
            qualified = qualified_intervals.get(key, [])
            kind_has_unverified = kind_has_unverified or (
                len(all_intervals[key]) != len(qualified)
            )
            if qualified:
                kind_has_qualified = True
                value = _union_minutes(qualified)
                minutes[user_id][kind] = round(value, 1)
                coverage[user_id][kind] = (
                    "partial"
                    if len(all_intervals[key]) != len(qualified)
                    else "complete"
                )
                kind_total += value
            else:
                coverage[user_id][kind] = "unknown"
        if kind_has_qualified:
            total_minutes[kind] = round(kind_total, 1)
            total_coverage[kind] = "partial" if kind_has_unverified else "complete"
        else:
            total_coverage[kind] = "unknown"
    return QualifiedTime(
        minutes=dict(minutes),
        coverage=dict(coverage),
        total_minutes=total_minutes,
        total_coverage=total_coverage,
    )


async def _build_roster(
    db: AsyncSession,
    project: Project,
    *,
    include_historical: bool,
    account_status: str,
    query: str | None,
    history: list[AuditLog],
    scope: ResolvedScope,
    target_user_id: UUID | None = None,
) -> list[RosterEntry]:
    rows = (
        await db.execute(
            select(ProjectMember, User)
            .join(User, User.id == ProjectMember.user_id)
            .where(ProjectMember.project_id == project.id)
        )
    ).all()
    by_id: dict[UUID, RosterEntry] = {}
    for membership, user in rows:
        by_id[user.id] = RosterEntry(
            user=user,
            project_role="owner" if user.id == project.owner_id else membership.role,
            is_owner=user.id == project.owner_id,
            is_current_member=True,
            member_since=membership.assigned_at,
        )

    owner = by_id.get(project.owner_id)
    if owner is None:
        owner_user = await db.get(User, project.owner_id)
        if owner_user is not None:
            by_id[owner_user.id] = RosterEntry(
                user=owner_user,
                project_role="owner",
                is_owner=True,
                is_current_member=True,
                member_since=project.created_at,
            )

    if include_historical:
        historical_ids: set[UUID] = set()
        for log in history:
            historical_ids.add(log.actor_id) if log.actor_id else None
            values = _detail(log).get("contributor_ids")
            if isinstance(values, list):
                historical_ids.update(
                    value for value in (_as_uuid(item) for item in values) if value
                )
        if target_user_id is not None:
            target_activity = await db.scalar(
                select(AuditLog.id)
                .where(
                    AuditLog.action.in_(_WORKFLOW_ACTIONS),
                    AuditLog.status_code == 200,
                    _project_audit_filter(project.id),
                    AuditLog.created_at >= scope.start,
                    AuditLog.created_at < scope.end,
                    or_(
                        AuditLog.actor_id == target_user_id,
                        AuditLog.detail_json.contains(
                            {"contributor_ids": [str(target_user_id)]}
                        ),
                    ),
                )
                .limit(1)
            )
            if target_activity is not None:
                historical_ids.add(target_user_id)
        annotation_ids = await db.execute(
            select(Annotation.user_id)
            .where(
                Annotation.project_id == project.id,
                Annotation.user_id.is_not(None),
                Annotation.created_at >= scope.start,
                Annotation.created_at < scope.end,
            )
            .distinct()
        )
        historical_ids.update(value for (value,) in annotation_ids if value is not None)
        event_ids = await db.execute(
            select(TaskEvent.user_id)
            .join(Task, Task.id == TaskEvent.task_id)
            .where(
                Task.project_id == project.id,
                TaskEvent.project_id == project.id,
                TaskEvent.collection_source == "session",
                TaskEvent.collection_coverage == "qualified",
                TaskEvent.started_at < scope.end,
                TaskEvent.ended_at > scope.start,
            )
            .distinct()
        )
        historical_ids.update(value for (value,) in event_ids if value is not None)
        missing = historical_ids.difference(by_id)
        if missing:
            users = (
                await db.execute(select(User).where(User.id.in_(missing)))
            ).scalars()
            for user in users:
                by_id[user.id] = RosterEntry(
                    user=user,
                    project_role=None,
                    is_owner=False,
                    is_current_member=False,
                    member_since=None,
                )

    text_query = query.strip().casefold() if query else None
    entries = []
    for entry in by_id.values():
        if account_status != "all":
            active = "active" if entry.user.is_active else "inactive"
            if active != account_status:
                continue
        if text_query and text_query not in (
            f"{entry.user.name} {entry.user.email}".casefold()
        ):
            continue
        entries.append(entry)

    return entries


async def _annotation_activity(
    db: AsyncSession,
    project_id: UUID,
    scope: ResolvedScope,
    user_ids: set[UUID],
) -> tuple[
    dict[UUID, tuple[int, int]],
    dict[UUID, Counter[str]],
    dict[UUID, Counter[str]],
    dict[UUID, Counter[str]],
]:
    """Return retained object/task counts and source/geometry breakdowns."""
    if not user_ids:
        return {}, {}, {}, {}
    base = (
        Annotation.project_id == project_id,
        Annotation.user_id.in_(user_ids),
        Annotation.is_active.is_(True),
        Annotation.was_cancelled.is_(False),
        Annotation.created_at >= scope.start,
        Annotation.created_at < scope.end,
    )
    totals = await db.execute(
        select(
            Annotation.user_id,
            func.count(Annotation.id),
            func.count(func.distinct(Annotation.task_id)),
        )
        .where(*base)
        .group_by(Annotation.user_id)
    )
    count_map = {
        user_id: (int(objects or 0), int(tasks or 0))
        for user_id, objects, tasks in totals
        if user_id is not None
    }
    imported_expr = Annotation.attributes["_imported"].astext
    breakdown_rows = await db.execute(
        select(
            Annotation.user_id,
            Annotation.source,
            Annotation.annotation_type,
            Annotation.class_name,
            imported_expr,
            func.count(Annotation.id),
        )
        .where(*base)
        .group_by(
            Annotation.user_id,
            Annotation.source,
            Annotation.annotation_type,
            Annotation.class_name,
            imported_expr,
        )
    )
    sources: dict[UUID, Counter[str]] = defaultdict(Counter)
    geometries: dict[UUID, Counter[str]] = defaultdict(Counter)
    classes: dict[UUID, Counter[str]] = defaultdict(Counter)
    for user_id, source, annotation_type, class_name, imported, count in breakdown_rows:
        if user_id is None:
            continue
        source_name = _annotation_source_label(source, imported)
        sources[user_id][source_name] += int(count or 0)
        geometries[user_id][str(annotation_type or "unknown")] += int(count or 0)
        classes[user_id][str(class_name or "unknown")] += int(count or 0)
    return count_map, sources, geometries, classes


async def _load_backlog_counts(
    db: AsyncSession,
    project_id: UUID,
    user_ids: set[UUID],
) -> tuple[dict[UUID, tuple[int, int]], int, int]:
    """Aggregate the live load in SQL without materializing every task."""
    assignee = effective_task_assignee_expr()
    reviewer = effective_task_reviewer_expr()
    rows = await db.execute(
        select(
            Task.status,
            assignee,
            reviewer,
            func.count(Task.id),
        )
        .outerjoin(TaskBatch, TaskBatch.id == Task.batch_id)
        .where(
            Task.project_id == project_id,
            Task.status.in_(_ANNOTATION_BACKLOG | {"review"}),
        )
        .group_by(Task.status, assignee, reviewer)
    )
    per_member: dict[UUID, list[int]] = defaultdict(lambda: [0, 0])
    current_total = 0
    review_total = 0
    for status, assignee_id, reviewer_id, count in rows:
        count = int(count or 0)
        if status in _ANNOTATION_BACKLOG:
            current_total += count
            if assignee_id in user_ids:
                per_member[assignee_id][0] += count
        elif status == "review":
            review_total += count
            if reviewer_id in user_ids:
                per_member[reviewer_id][1] += count
    return (
        {user_id: (values[0], values[1]) for user_id, values in per_member.items()},
        current_total,
        review_total,
    )


async def _load_first_review_facts(
    db: AsyncSession,
    project_id: UUID,
    scope: ResolvedScope,
    decision_task_ids: set[str],
) -> list[tuple[UUID, bool | None, datetime | None, str | None, list[str] | None]]:
    """Load only facts in the requested cohort plus legacy decision targets."""
    first_in_scope = (
        Task.first_reviewed_at >= scope.start,
        Task.first_reviewed_at < scope.end,
    )
    stmt = select(
        Task.id,
        Task.first_review_eligible,
        Task.first_reviewed_at,
        Task.first_review_result,
        Task.first_review_contributor_ids,
    ).where(Task.project_id == project_id)
    if decision_task_ids:
        stmt = stmt.where(
            (Task.id.in_(decision_task_ids))
            | (Task.first_reviewed_at >= scope.start)
            & (Task.first_reviewed_at < scope.end)
        )
    else:
        stmt = stmt.where(*first_in_scope)
    return list((await db.execute(stmt)).all())


async def _load_task_display_ids(
    db: AsyncSession, project_id: UUID, task_ids: set[UUID]
) -> dict[UUID, str]:
    if not task_ids:
        return {}
    rows = await db.execute(
        select(Task.id, Task.display_id).where(
            Task.project_id == project_id, Task.id.in_(task_ids)
        )
    )
    return {task_id: display_id for task_id, display_id in rows}


@dataclass
class MemberAccumulator:
    submitted: set[str]
    submit_attempts: int
    resubmissions: int
    contributed_tasks: int
    retained_objects: int
    approved_outcomes: set[str]
    first_review_passed: int
    first_review_total: int
    first_review_partial: bool
    review_decisions: set[str]
    approvals: set[str]
    rejections: set[str]
    reviewed_tasks: set[str]
    current_backlog: int
    review_backlog: int
    recorded_time_minutes: float | None
    recorded_time_coverage: str
    recorded_review_minutes: float | None
    recorded_review_coverage: str

    @classmethod
    def new(cls) -> MemberAccumulator:
        return cls(
            submitted=set(),
            submit_attempts=0,
            resubmissions=0,
            contributed_tasks=0,
            retained_objects=0,
            approved_outcomes=set(),
            first_review_passed=0,
            first_review_total=0,
            first_review_partial=False,
            review_decisions=set(),
            approvals=set(),
            rejections=set(),
            reviewed_tasks=set(),
            current_backlog=0,
            review_backlog=0,
            recorded_time_minutes=None,
            recorded_time_coverage="unknown",
            recorded_review_minutes=None,
            recorded_review_coverage="unknown",
        )


def _metric(
    value: int | float | None,
    unit: str,
    *,
    numerator: int | None = None,
    denominator: int | None = None,
    coverage: str | None = "complete",
) -> PerformanceMetric:
    return PerformanceMetric(
        value=value,
        unit=unit,
        numerator=numerator,
        denominator=denominator,
        coverage=coverage,
    )


def _round_snapshots(submits: list[AuditLog]) -> dict[tuple[str, str], set[UUID]]:
    snapshots: dict[tuple[str, str], set[UUID]] = {}
    for log in submits:
        round_id = _as_uuid(_detail(log).get("review_round_id"))
        if round_id is None or log.target_id is None:
            continue
        values = _detail(log).get("contributor_ids")
        if not isinstance(values, list):
            continue
        contributor_ids = {
            value for value in (_as_uuid(item) for item in values) if value is not None
        }
        if contributor_ids:
            snapshots.setdefault((str(log.target_id), str(round_id)), contributor_ids)
    return snapshots


def _decision_snapshot(
    log: AuditLog, snapshots: dict[tuple[str, str], set[UUID]]
) -> set[UUID]:
    round_id = _as_uuid(_detail(log).get("review_round_id"))
    if round_id is None or log.target_id is None:
        return set()
    return snapshots.get((str(log.target_id), str(round_id)), set())


def _member_metrics(
    acc: MemberAccumulator,
    *,
    submission_coverage: str = "complete",
) -> PerformanceMemberMetrics:
    first_rate = (
        round(acc.first_review_passed / acc.first_review_total * 100, 1)
        if acc.first_review_total
        else None
    )
    return PerformanceMemberMetrics(
        submitted_tasks=_metric(
            len(acc.submitted),
            "tasks",
            numerator=len(acc.submitted),
            coverage=submission_coverage,
        ),
        resubmissions=_metric(
            acc.resubmissions,
            "tasks",
            numerator=acc.resubmissions,
            denominator=acc.submit_attempts,
            coverage=submission_coverage,
        ),
        contributed_tasks=_metric(
            acc.contributed_tasks,
            "tasks",
            numerator=acc.contributed_tasks,
        ),
        retained_objects=_metric(
            acc.retained_objects,
            "objects",
            numerator=acc.retained_objects,
        ),
        approved_task_outcomes=_metric(
            len(acc.approved_outcomes),
            "tasks",
            numerator=len(acc.approved_outcomes),
        ),
        first_review_pass_rate=_metric(
            first_rate,
            "percent",
            numerator=acc.first_review_passed,
            denominator=acc.first_review_total,
            coverage="partial" if acc.first_review_partial else "complete",
        ),
        # Only qualified TaskEvent rows contribute to duration.  Legacy rows
        # remain evidence but are not silently treated as measured work.
        recorded_time_minutes=_metric(
            acc.recorded_time_minutes,
            "minutes",
            coverage=acc.recorded_time_coverage,
        ),
        current_backlog=_metric(
            acc.current_backlog, "tasks", numerator=acc.current_backlog
        ),
        review_decisions=_metric(
            len(acc.review_decisions),
            "decisions",
            numerator=len(acc.review_decisions),
        ),
        approvals=_metric(
            len(acc.approvals), "decisions", numerator=len(acc.approvals)
        ),
        rejections=_metric(
            len(acc.rejections), "decisions", numerator=len(acc.rejections)
        ),
        reviewed_tasks=_metric(
            len(acc.reviewed_tasks), "tasks", numerator=len(acc.reviewed_tasks)
        ),
        recorded_review_minutes=_metric(
            acc.recorded_review_minutes,
            "minutes",
            coverage=acc.recorded_review_coverage,
        ),
        review_backlog=_metric(
            acc.review_backlog, "tasks", numerator=acc.review_backlog
        ),
    )


def _member_out(
    entry: RosterEntry,
    acc: MemberAccumulator,
    *,
    submission_coverage: str = "complete",
) -> PerformanceMember:
    return PerformanceMember(
        user_id=entry.user.id,
        name=entry.user.name,
        email=entry.user.email,
        project_role=entry.project_role,
        account_status="active" if entry.user.is_active else "inactive",
        is_owner=entry.is_owner,
        is_current_member=entry.is_current_member,
        member_since=entry.member_since,
        metrics=_member_metrics(acc, submission_coverage=submission_coverage),
    )


def _first_rate_metric(
    passed: int, total: int, *, partial: bool = False
) -> PerformanceMetric:
    return _metric(
        round(passed / total * 100, 1) if total else None,
        "percent",
        numerator=passed,
        denominator=total,
        coverage="partial" if partial else "complete",
    )


def _totals(
    *,
    submitted: int,
    approved: int,
    first_passed: int,
    first_total: int,
    first_partial: bool,
    recorded_time_minutes: float | None,
    recorded_time_coverage: str,
    current_backlog: int,
    review_decisions: int,
    approvals: int,
    rejections: int,
    review_backlog: int,
    submission_coverage: str = "complete",
) -> PerformanceTotals:
    return PerformanceTotals(
        submitted_tasks=_metric(
            submitted,
            "tasks",
            numerator=submitted,
            coverage=submission_coverage,
        ),
        approved_task_outcomes=_metric(approved, "tasks", numerator=approved),
        first_review_pass_rate=_first_rate_metric(
            first_passed, first_total, partial=first_partial
        ),
        recorded_time_minutes=_metric(
            recorded_time_minutes,
            "minutes",
            coverage=recorded_time_coverage,
        ),
        current_backlog=_metric(current_backlog, "tasks", numerator=current_backlog),
        review_decisions=_metric(
            review_decisions, "decisions", numerator=review_decisions
        ),
        approvals=_metric(approvals, "decisions", numerator=approvals),
        rejections=_metric(rejections, "decisions", numerator=rejections),
        review_backlog=_metric(review_backlog, "tasks", numerator=review_backlog),
    )


@dataclass
class AggregatedPerformance:
    scope: ResolvedScope
    coverage: PerformanceCoverage
    items: list[PerformanceMember]
    totals: PerformanceTotals
    trend: dict[UUID, dict[str, list[int]]]
    reject_reasons: dict[UUID, Counter[str]]
    classes: dict[UUID, Counter[str]]
    sources: dict[UUID, Counter[str]]
    geometries: dict[UUID, Counter[str]]
    snapshots: dict[tuple[str, str], set[UUID]]
    workflow: list[AuditLog]
    users: dict[UUID, User]


async def _aggregate(
    db: AsyncSession,
    project: Project,
    entries: list[RosterEntry],
    scope: ResolvedScope,
    *,
    work_type: str = "annotation",
    time_user_ids: set[UUID] | None = None,
    history: list[AuditLog] | None = None,
    prior_submission_task_ids: set[str] | None = None,
    submission_coverage: str = "complete",
) -> AggregatedPerformance:
    if history is None:
        history = await _load_workflow(db, project.id, start=scope.start, end=scope.end)
    interval = [log for log in history if log.created_at >= scope.start]
    round_history = [log for log in history if log.action in _ROUND_START_ACTIONS]
    snapshots = _round_snapshots(round_history)
    user_ids = {entry.user.id for entry in entries}
    accumulators = {user_id: MemberAccumulator.new() for user_id in user_ids}
    trend: dict[UUID, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0, 0])
    )
    approved_trend_seen: set[tuple[UUID, str, str]] = set()
    reject_reasons: dict[UUID, Counter[str]] = defaultdict(Counter)
    interval_submitted: set[str] = set()
    interval_approved_tasks: set[str] = set()
    seen_submission_tasks = set(prior_submission_task_ids or ())
    interval_decisions = 0
    interval_approvals = 0
    interval_rejections = 0
    first_by_task: dict[str, AuditLog] = {}
    for log in history:
        if log.action in _DECISION_ACTIONS and log.target_id:
            first_by_task.setdefault(str(log.target_id), log)

    first_total = 0
    first_passed = 0
    first_partial = False
    for log in interval:
        target_id = str(log.target_id) if log.target_id is not None else None
        day = (
            log.created_at.astimezone(ZoneInfo(scope.timezone_name)).date().isoformat()
        )
        detail = _detail(log)
        if log.action in _SUBMISSION_ACTIONS and work_type == "annotation":
            is_resubmission = (
                target_id is not None and target_id in seen_submission_tasks
            )
            if target_id is not None:
                seen_submission_tasks.add(target_id)
            if target_id:
                interval_submitted.add(target_id)
            if log.actor_id in accumulators and target_id:
                acc = accumulators[log.actor_id]
                acc.submitted.add(target_id)
                acc.submit_attempts += 1
                if is_resubmission:
                    acc.resubmissions += 1
                trend[log.actor_id][day][0] += 1
        elif log.action in _DECISION_ACTIONS:
            if work_type == "review":
                interval_decisions += 1
                if log.action == AuditAction.TASK_APPROVE.value:
                    interval_approvals += 1
                else:
                    interval_rejections += 1
                if log.actor_id in accumulators:
                    acc = accumulators[log.actor_id]
                    if target_id:
                        acc.reviewed_tasks.add(target_id)
                    acc.review_decisions.add(str(log.id))
                    if log.action == AuditAction.TASK_APPROVE.value:
                        acc.approvals.add(str(log.id))
                    else:
                        acc.rejections.add(str(log.id))
                    trend[log.actor_id][day][2] += 1
                    reason = detail.get("reason_type") or "unknown"
                    if log.action == AuditAction.TASK_REJECT.value:
                        reject_reasons[log.actor_id][str(reason)] += 1

            if work_type == "annotation":
                if log.action == AuditAction.TASK_APPROVE.value and target_id:
                    interval_approved_tasks.add(target_id)
                contributors = _decision_snapshot(log, snapshots)
                if log.action == AuditAction.TASK_REJECT.value:
                    reason = str(detail.get("reason_type") or "unknown")
                    for user_id in contributors.intersection(user_ids):
                        reject_reasons[user_id][reason] += 1
                for user_id in contributors.intersection(user_ids):
                    acc = accumulators[user_id]
                    if log.action == AuditAction.TASK_APPROVE.value:
                        if target_id:
                            acc.approved_outcomes.add(target_id)
                            trend_key = (user_id, day, target_id)
                            if trend_key not in approved_trend_seen:
                                approved_trend_seen.add(trend_key)
                                trend[user_id][day][1] += 1
        elif log.action in _ANNOTATION_ACTIONS and log.actor_id in accumulators:
            # Reopen/accept-rejection are useful evidence but do not count as
            # another submitted task until a subsequent submit audit exists.
            if log.action == AuditAction.TASK_REJECT.value:
                reason = detail.get("reason_type") or "unknown"
                reject_reasons[log.actor_id][str(reason)] += 1

    decision_task_ids = {
        str(log.target_id)
        for log in interval
        if log.action in _DECISION_ACTIONS and log.target_id is not None
    }
    first_facts = await _load_first_review_facts(
        db, project.id, scope, decision_task_ids
    )
    task_meta: dict[
        str, tuple[datetime, bool | None, datetime | None, str | None, list[str] | None]
    ] = {}
    for (
        task_id,
        first_eligible,
        first_reviewed_at,
        first_result,
        first_contributor_ids,
    ) in first_facts:
        task_meta[str(task_id)] = (
            first_reviewed_at or scope.end,
            first_eligible,
            first_reviewed_at,
            first_result,
            first_contributor_ids,
        )

    # First-review facts are written once in the locked approve/reject
    # transaction.  They remain trustworthy when old audit rows are archived.
    for task_id, (
        _,
        first_eligible,
        first_reviewed_at,
        first_result,
        first_contributor_ids,
    ) in task_meta.items():
        if (
            first_reviewed_at is not None
            and scope.start <= first_reviewed_at < scope.end
        ):
            contributors = {
                value
                for value in (_as_uuid(item) for item in (first_contributor_ids or []))
                if value is not None
            }
            if first_eligible is not True or first_result not in {
                "approved",
                "rejected",
            }:
                first_partial = True
                for user_id in contributors.intersection(user_ids):
                    accumulators[user_id].first_review_partial = True
                continue
            first_total += 1
            if first_result == "approved":
                first_passed += 1
            if not contributors:
                first_partial = True
            for user_id in contributors.intersection(user_ids):
                acc = accumulators[user_id]
                acc.first_review_total += 1
                if first_result == "approved":
                    acc.first_review_passed += 1

    # A legacy decision in the requested interval has no retention-safe fact.
    # Keep it out of the rate and surface partial coverage instead of replaying
    # a potentially truncated audit history as a first pass.
    for task_id, log in first_by_task.items():
        if not (scope.start <= log.created_at < scope.end):
            continue
        metadata = task_meta.get(task_id)
        if metadata is None or metadata[2] is None:
            first_partial = True

    backlog_by_member, current_backlog, review_backlog = await _load_backlog_counts(
        db, project.id, user_ids
    )
    for user_id, (member_current, member_review) in backlog_by_member.items():
        accumulators[user_id].current_backlog = member_current
        accumulators[user_id].review_backlog = member_review

    annotation_counts, sources, geometries, classes = await _annotation_activity(
        db, project.id, scope, user_ids
    )
    for user_id, (retained_objects, contributed_tasks) in annotation_counts.items():
        accumulators[user_id].retained_objects = retained_objects
        accumulators[user_id].contributed_tasks = contributed_tasks
    qualified_time = await _load_qualified_time(
        db, project.id, scope, user_ids=time_user_ids
    )
    for user_id, acc in accumulators.items():
        acc.recorded_time_minutes = qualified_time.minutes.get(user_id, {}).get(
            "annotate"
        )
        acc.recorded_time_coverage = qualified_time.coverage.get(user_id, {}).get(
            "annotate", "unknown"
        )
        acc.recorded_review_minutes = qualified_time.minutes.get(user_id, {}).get(
            "review"
        )
        acc.recorded_review_coverage = qualified_time.coverage.get(user_id, {}).get(
            "review", "unknown"
        )
    users = {entry.user.id: entry.user for entry in entries}
    time_kind = "annotate" if work_type == "annotation" else "review"
    time_coverage = qualified_time.total_coverage.get(time_kind, "unknown")
    coverage_state = (
        "complete"
        if (
            time_coverage == "complete"
            and not first_partial
            and submission_coverage == "complete"
        )
        else "partial"
        if (
            time_coverage in {"complete", "partial"}
            or first_partial
            or submission_coverage == "partial"
        )
        else "unknown"
    )
    coverage_detail = (
        "workflow audits are project scoped; legacy review rounds without a submit snapshot "
        f"are excluded from member attribution; retained_objects and distributions count "
        f"retained annotation records (compact tracks once, scene instances individually); "
        f"{work_type} session coverage is {time_coverage}; submission coverage is "
        f"{submission_coverage}"
    )
    coverage = PerformanceCoverage(
        state=coverage_state,
        source="audit_logs+tasks+annotations",
        detail=coverage_detail,
    )
    items = [
        _member_out(
            entry,
            accumulators[entry.user.id],
            submission_coverage=submission_coverage,
        )
        for entry in entries
        if entry.user.id in accumulators
    ]
    totals = _totals(
        submitted=len(interval_submitted),
        approved=len(interval_approved_tasks),
        first_passed=first_passed,
        first_total=first_total,
        first_partial=first_partial,
        recorded_time_minutes=qualified_time.total_minutes.get(time_kind),
        recorded_time_coverage=time_coverage,
        current_backlog=current_backlog,
        review_decisions=interval_decisions,
        approvals=interval_approvals,
        rejections=interval_rejections,
        review_backlog=review_backlog,
        submission_coverage=submission_coverage,
    )
    return AggregatedPerformance(
        scope=scope,
        coverage=coverage,
        items=items,
        totals=totals,
        trend=trend,
        reject_reasons=reject_reasons,
        classes=classes,
        sources=sources,
        geometries=geometries,
        snapshots=snapshots,
        workflow=interval,
        users=users,
    )


_SORT_FIELDS = {
    "name": lambda item: item.name.casefold(),
    "submitted_tasks": lambda item: item.metrics.submitted_tasks.value,
    "approved_task_outcomes": lambda item: item.metrics.approved_task_outcomes.value,
    "first_review_pass_rate": lambda item: item.metrics.first_review_pass_rate.value,
    "recorded_time_minutes": lambda item: item.metrics.recorded_time_minutes.value,
    "current_backlog": lambda item: item.metrics.current_backlog.value,
    "review_decisions": lambda item: item.metrics.review_decisions.value,
}


def _sort_items(
    items: list[PerformanceMember], sort: str | None
) -> list[PerformanceMember]:
    requested = sort or "+name"
    direction = requested[0] if requested[:1] in {"+", "-"} else "+"
    field = requested[1:] if requested[:1] in {"+", "-"} else requested
    key_fn = _SORT_FIELDS.get(field)
    if key_fn is None:
        raise HTTPException(
            status_code=422, detail=f"unsupported performance sort: {field}"
        )
    non_null = [item for item in items if key_fn(item) is not None]
    nulls = [item for item in items if key_fn(item) is None]
    non_null.sort(
        key=lambda item: (key_fn(item), str(item.user_id)),
        reverse=direction == "-",
    )
    return non_null + nulls


def _trend_for(
    aggregate: AggregatedPerformance, user_id: UUID
) -> list[PerformanceTrendPoint]:
    zone = ZoneInfo(aggregate.scope.timezone_name)
    first_day = aggregate.scope.start.astimezone(zone).date()
    last_day = (aggregate.scope.end - timedelta(microseconds=1)).astimezone(zone).date()
    values = aggregate.trend.get(user_id, {})
    result: list[PerformanceTrendPoint] = []
    day = first_day
    while day <= last_day:
        submitted, approved, decisions = values.get(day.isoformat(), [0, 0, 0])
        result.append(
            PerformanceTrendPoint(
                date=day.isoformat(),
                submitted_tasks=submitted,
                approved_task_outcomes=approved,
                review_decisions=decisions,
            )
        )
        day += timedelta(days=1)
    return result


def _breakdowns(counts: Counter[str], *, key: str) -> list[PerformanceBreakdown]:
    total = sum(counts.values())
    rows: list[PerformanceBreakdown] = []
    for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        rows.append(
            PerformanceBreakdown(
                **{key: label},
                count=count,
                pct=round(count / total * 100, 1) if total else None,
            )
        )
    return rows


def _source_breakdowns(counts: Counter[str]) -> list[PerformanceSourceBreakdown]:
    total = sum(counts.values())
    return [
        PerformanceSourceBreakdown(
            source=label,
            count=count,
            pct=round(count / total * 100, 1) if total else None,
        )
        for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def _geometry_breakdowns(
    counts: Counter[str],
) -> list[PerformanceGeometryBreakdown]:
    total = sum(counts.values())
    return [
        PerformanceGeometryBreakdown(
            annotation_type=label,
            count=count,
            pct=round(count / total * 100, 1) if total else None,
        )
        for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


async def _load_evidence_page(
    db: AsyncSession,
    project_id: UUID,
    member_id: UUID,
    member_name: str,
    scope: ResolvedScope,
    work_type: str,
    cursor: str | None,
    limit: int,
) -> tuple[list[PerformanceEvidenceItem], str | None]:
    """Fetch one bounded, SQL-paginated page of audit and session evidence."""
    audit_detail = func.coalesce(
        AuditLog.detail_json["reason"].astext,
        AuditLog.detail_json["result"].astext,
        AuditLog.detail_json["reason_type"].astext,
    )
    audit_stmt = select(
        literal("audit").label("source_kind"),
        cast(AuditLog.id, String).label("source_id"),
        AuditLog.created_at.label("at"),
        AuditLog.action.label("action"),
        AuditLog.target_id.label("task_id"),
        audit_detail.label("detail"),
    ).where(
        AuditLog.status_code == 200,
        _project_audit_filter(project_id),
        AuditLog.created_at >= scope.start,
        AuditLog.created_at < scope.end,
    )
    if work_type == "review":
        audit_stmt = audit_stmt.where(
            AuditLog.actor_id == member_id,
            AuditLog.action.in_(_REVIEW_ACTIONS),
        )
    else:
        audit_stmt = audit_stmt.where(
            or_(
                and_(
                    AuditLog.actor_id == member_id,
                    AuditLog.action.in_(_ANNOTATION_ACTIONS),
                ),
                and_(
                    AuditLog.action.in_(_DECISION_ACTIONS),
                    AuditLog.detail_json.contains(
                        {"contributor_ids": [str(member_id)]}
                    ),
                ),
            )
        )

    event_kind = "review" if work_type == "review" else "annotate"
    session_stmt = (
        select(
            literal("session").label("source_kind"),
            cast(TaskEvent.id, String).label("source_id"),
            TaskEvent.started_at.label("at"),
            (literal("session.") + TaskEvent.kind).label("action"),
            cast(TaskEvent.task_id, String).label("task_id"),
            cast(TaskEvent.duration_ms, String).label("detail"),
        )
        .join(Task, Task.id == TaskEvent.task_id)
        .where(
            Task.project_id == project_id,
            TaskEvent.project_id == project_id,
            TaskEvent.user_id == member_id,
            TaskEvent.kind == event_kind,
            TaskEvent.collection_source == "session",
            TaskEvent.collection_coverage == "qualified",
            TaskEvent.started_at < scope.end,
            TaskEvent.ended_at > scope.start,
        )
    )
    combined = union_all(audit_stmt, session_stmt).subquery()
    offset = _decode_offset(cursor)
    rows = (
        await db.execute(
            select(
                combined.c.source_kind,
                combined.c.source_id,
                combined.c.at,
                combined.c.action,
                combined.c.task_id,
                combined.c.detail,
            )
            .order_by(combined.c.at.desc(), combined.c.source_id.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    task_ids = {
        value for value in (_as_uuid(row.task_id) for row in rows) if value is not None
    }
    display_ids = await _load_task_display_ids(db, project_id, task_ids)
    items = []
    for row in rows[:limit]:
        task_id = _as_uuid(row.task_id)
        detail = str(row.detail) if row.detail is not None else None
        if row.source_kind == "session" and detail is not None:
            detail = f"{detail} ms"
        items.append(
            PerformanceEvidenceItem(
                id=f"{row.source_kind}-{row.source_id}",
                at=row.at,
                action=row.action,
                task_id=task_id,
                task_display_id=display_ids.get(task_id) if task_id else None,
                detail=detail,
                contributor_name=member_name,
            )
        )
    next_cursor = _encode_offset(offset + limit) if len(rows) > limit else None
    return items, next_cursor


async def _prepare_aggregate(
    db: AsyncSession,
    project_id: UUID,
    user: User,
    scope: ResolvedScope,
    *,
    target_user_id: UUID | None,
    work_type: str,
    include_historical: bool,
    account_status: str,
    query: str | None,
) -> AggregatedPerformance:
    project = await resolve_performance_access(db, project_id, user)
    workflow = await _load_workflow(
        db,
        project_id,
        start=scope.start,
        end=scope.end,
        member_id=target_user_id,
        work_type=work_type,
    )
    task_ids = {str(log.target_id) for log in workflow if log.target_id is not None}
    decision_round_ids = (
        {
            str(round_id)
            for log in workflow
            if log.action in _DECISION_ACTIONS
            and (round_id := _detail(log).get("review_round_id"))
        }
        if work_type == "annotation"
        else set()
    )
    interval_submit_task_ids = (
        {
            str(log.target_id)
            for log in workflow
            if log.action in _SUBMISSION_ACTIONS and log.target_id is not None
        }
        if work_type == "annotation"
        else set()
    )
    submission_history, prior_submission_task_ids = await _load_submission_history(
        db,
        project_id,
        start=scope.start,
        end=scope.end,
        task_ids=task_ids,
        decision_round_ids=decision_round_ids,
        interval_submit_task_ids=interval_submit_task_ids,
    )
    history_by_id = {log.id: log for log in [*workflow, *submission_history]}
    history = sorted(history_by_id.values(), key=lambda log: (log.created_at, log.id))
    entries = await _build_roster(
        db,
        project,
        include_historical=include_historical,
        account_status=account_status,
        query=query,
        history=workflow,
        scope=scope,
        target_user_id=target_user_id,
    )
    if target_user_id is not None:
        entries = [entry for entry in entries if entry.user.id == target_user_id]
    if target_user_id is not None and not entries:
        raise HTTPException(status_code=404, detail="成员不存在或不在当前项目")
    aggregate = await _aggregate(
        db,
        project,
        entries,
        scope,
        work_type=work_type,
        time_user_ids={target_user_id} if target_user_id is not None else None,
        history=history,
        prior_submission_task_ids=prior_submission_task_ids,
        submission_coverage=(
            await _load_submission_coverage(db, project.id, scope)
            if project.data_type == "video"
            else "complete"
        ),
    )
    return aggregate


async def list_members_performance(
    db: AsyncSession,
    project_id: UUID,
    user: User,
    *,
    from_: str | None = None,
    to: str | None = None,
    timezone_name: str | None = None,
    work_type: str = "annotation",
    account_status: str = "all",
    include_historical: bool = False,
    query: str | None = None,
    sort: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    all_items: bool = False,
) -> PerformanceMembersResponse:
    scope = resolve_scope(from_, to, timezone_name)
    aggregate = await _prepare_aggregate(
        db,
        project_id,
        user,
        scope,
        target_user_id=None,
        work_type=work_type,
        include_historical=include_historical,
        account_status=account_status,
        query=query,
    )
    items = _sort_items(aggregate.items, sort)
    if all_items:
        page = items
        next_cursor = None
    else:
        offset = _decode_offset(cursor)
        page = items[offset : offset + limit]
        next_cursor = (
            _encode_offset(offset + limit) if offset + limit < len(items) else None
        )
    return PerformanceMembersResponse(
        scope=scope.output(),
        coverage=aggregate.coverage,
        project_totals=aggregate.totals,
        items=page,
        next_cursor=next_cursor,
    )


async def member_performance_detail(
    db: AsyncSession,
    project_id: UUID,
    member_id: UUID,
    user: User,
    *,
    from_: str | None = None,
    to: str | None = None,
    timezone_name: str | None = None,
    work_type: str = "annotation",
    account_status: str = "all",
    include_historical: bool = False,
    query: str | None = None,
    evidence_cursor: str | None = None,
    limit: int = 50,
) -> PerformanceMemberDetailResponse:
    scope = resolve_scope(from_, to, timezone_name)
    aggregate = await _prepare_aggregate(
        db,
        project_id,
        user,
        scope,
        target_user_id=member_id,
        work_type=work_type,
        include_historical=include_historical,
        account_status=account_status,
        query=query,
    )
    member = aggregate.items[0]
    evidence_page, evidence_next = await _load_evidence_page(
        db,
        project_id,
        member_id,
        aggregate.items[0].name,
        scope,
        work_type,
        evidence_cursor,
        limit,
    )
    return PerformanceMemberDetailResponse(
        scope=scope.output(),
        coverage=aggregate.coverage,
        member=member,
        trend=_trend_for(aggregate, member_id),
        reject_reasons=_breakdowns(
            aggregate.reject_reasons.get(member_id, Counter()), key="reason_type"
        ),
        class_distribution=_breakdowns(
            aggregate.classes.get(member_id, Counter()), key="class_name"
        ),
        source_distribution=_source_breakdowns(
            aggregate.sources.get(member_id, Counter())
        ),
        geometry_distribution=_geometry_breakdowns(
            aggregate.geometries.get(member_id, Counter())
        ),
        evidence=evidence_page,
        evidence_next_cursor=evidence_next,
    )


async def member_performance_events(
    db: AsyncSession,
    project_id: UUID,
    member_id: UUID,
    user: User,
    *,
    from_: str | None = None,
    to: str | None = None,
    timezone_name: str | None = None,
    work_type: str = "annotation",
    account_status: str = "all",
    include_historical: bool = False,
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
) -> PerformanceEventsResponse:
    scope = resolve_scope(from_, to, timezone_name)
    aggregate = await _prepare_aggregate(
        db,
        project_id,
        user,
        scope,
        target_user_id=member_id,
        work_type=work_type,
        include_historical=include_historical,
        account_status=account_status,
        query=query,
    )
    page, next_cursor = await _load_evidence_page(
        db,
        project_id,
        member_id,
        aggregate.items[0].name,
        scope,
        work_type,
        cursor,
        limit,
    )
    return PerformanceEventsResponse(
        scope=scope.output(), items=page, next_cursor=next_cursor
    )


_CSV_METRICS = (
    "submitted_tasks",
    "resubmissions",
    "contributed_tasks",
    "retained_objects",
    "approved_task_outcomes",
    "first_review_pass_rate",
    "recorded_time_minutes",
    "current_backlog",
    "review_decisions",
    "approvals",
    "rejections",
    "reviewed_tasks",
    "recorded_review_minutes",
    "review_backlog",
)


async def export_members_csv(
    db: AsyncSession,
    project_id: UUID,
    user: User,
    **kwargs: Any,
) -> bytes:
    response = await list_members_performance(
        db, project_id, user, all_items=True, **kwargs
    )
    headers = [
        "user_id",
        "name",
        "email",
        "project_role",
        "account_status",
        "is_owner",
        "is_current_member",
        "member_since",
    ]
    for metric_name in _CSV_METRICS:
        headers.extend(
            [
                f"{metric_name}.value",
                f"{metric_name}.unit",
                f"{metric_name}.numerator",
                f"{metric_name}.denominator",
                f"{metric_name}.coverage",
            ]
        )
    output = io.StringIO(newline="")
    output.write(f"# Scope from: {response.scope.from_.isoformat()}\n")
    output.write(f"# Scope to: {response.scope.to.isoformat()}\n")
    output.write(f"# Scope timezone: {response.scope.timezone}\n")
    output.write(f"# Scope project: {project_id}\n")
    output.write(f"# Scope work type: {kwargs.get('work_type', 'annotation')}\n")
    output.write(f"# Scope as of: {response.scope.as_of.isoformat()}\n")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(headers)
    for item in response.items:
        row: list[str] = [
            str(item.user_id),
            csv_literal(item.name),
            csv_literal(item.email),
            csv_literal(item.project_role or ""),
            item.account_status,
            str(item.is_owner).lower(),
            str(item.is_current_member).lower(),
            item.member_since.isoformat() if item.member_since else "",
        ]
        for metric_name in _CSV_METRICS:
            metric = getattr(item.metrics, metric_name)
            row.extend(
                [
                    "" if metric.value is None else str(metric.value),
                    metric.unit,
                    "" if metric.numerator is None else str(metric.numerator),
                    "" if metric.denominator is None else str(metric.denominator),
                    metric.coverage or "",
                ]
            )
        writer.writerow(row)
    return ("\ufeff" + output.getvalue()).encode("utf-8")
