"""Read-only project-role discrepancy / reconciliation audit.

Increment A preparation for the project-scoped employee roles plan
(``docs/plans/1789807315_project-scoped-employee-roles.md``).  The command
only reads the database: it opens a ``READ ONLY`` transaction and never
writes roles, memberships or assignments.  It is safe to run before the
employee conversion and is meant to gate the later data migration.

Report shape (versioned JSON)::

    {
      "report_version": "project-role-audit/1",
      "run_id": "<uuid>",
      "generated_at": "<iso8601>",
      "read_only": true,
      "baseline": {...alembic revisions + script heads...},
      "limits": {...},
      "summary": {...},
      "findings": {
        "role_discrepancies": {...},
        "assignment_membership_gaps": {...},
        "invitations": {...},
        "review_evidence": {...}
      },
      "reconciliation": {...}
    }

The report contains only IDs, roles, counts and timestamps.  It never emits
password hashes, invitation tokens, signed URLs or free-form reasons.

Usage::

    cd apps/api
    uv run python scripts/audit_project_roles.py --output /tmp/role-audit.json
    uv run python scripts/audit_project_roles.py --pretty

Exit codes:
    0  audit completed (findings do not fail the command)
    2  the audit could not run (connection or schema error)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

AUDIT_REPORT_VERSION = "project-role-audit/1"
DEFAULT_MAX_ROWS = 1000

# Fixed role vocabularies.  They are embedded as SQL literals because they are
# module constants, never user input.
PLATFORM_ROLES = ("super_admin", "project_admin", "annotator", "reviewer", "viewer")
PROJECT_ROLES = ("annotator", "reviewer", "viewer")
EMPLOYEE_PLATFORM_ROLES = ("annotator", "reviewer")
ADMIN_PLATFORM_ROLES = ("super_admin", "project_admin")
LEGACY_MIRRORED_PROJECT_ROLE = {
    "annotator": "annotator",
    "reviewer": "reviewer",
    "viewer": "viewer",
}

_PLATFORM_ROLES_SQL = "('super_admin','project_admin','annotator','reviewer','viewer')"
_PROJECT_ROLES_SQL = "('annotator','reviewer','viewer')"
_EMPLOYEE_PLATFORM_ROLES_SQL = "('annotator','reviewer')"
_ADMIN_PLATFORM_ROLES_SQL = "('super_admin','project_admin')"

PLAN_DOCUMENT = "docs/plans/1789807315_project-scoped-employee-roles.md"

# Effective task assignment: an explicit task value wins over the inherited
# batch default, matching existing business semantics.
_EFFECTIVE_ASSIGNMENT_CTE = """
WITH effective AS (
    SELECT t.id AS task_id,
           t.project_id,
           t.status,
           COALESCE(t.assignee_id, b.annotator_id) AS effective_assignee_id,
           COALESCE(t.reviewer_id, b.reviewer_id) AS effective_reviewer_id
    FROM tasks t
    LEFT JOIN task_batches b ON b.id = t.batch_id
)
"""
_EFFECTIVE_ASSIGNMENT_JOINS = """
LEFT JOIN project_members ma
       ON ma.project_id = e.project_id AND ma.user_id = e.effective_assignee_id
LEFT JOIN users ua ON ua.id = e.effective_assignee_id
LEFT JOIN project_members mr
       ON mr.project_id = e.project_id AND mr.user_id = e.effective_reviewer_id
LEFT JOIN users ur ON ur.id = e.effective_reviewer_id
"""
_EFFECTIVE_ASSIGNMENT_SELECT = (
    "SELECT e.task_id, e.project_id, e.status, "
    "e.effective_assignee_id, ma.role AS assignee_member_role, "
    "ua.is_active AS assignee_active, "
    "e.effective_reviewer_id, mr.role AS reviewer_member_role, "
    "ur.is_active AS reviewer_active "
    "FROM effective e " + _EFFECTIVE_ASSIGNMENT_JOINS
)

_REVIEW_ACTIVITY_SQL = (
    "review_round_id IS NOT NULL OR reviewer_claimed_at IS NOT NULL "
    "OR reviewed_at IS NOT NULL OR status IN ('review','completed')"
)


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


async def _fetch(db: AsyncSession, sql: str, **params: Any) -> list[dict]:
    result = await db.execute(text(sql), params)
    return [dict(row) for row in result.mappings().all()]


async def _scalar(db: AsyncSession, sql: str, **params: Any) -> int:
    value = await db.scalar(text(sql), params)
    return int(value or 0)


def _limited(rows: list[dict], total: int, max_rows: int) -> dict:
    """Shape a bounded entity list plus its true count."""
    return {
        "total": total,
        "returned": len(rows),
        "truncated": total > len(rows),
        "items": rows,
    }


async def _count_and_rows(
    db: AsyncSession,
    *,
    count_sql: str,
    rows_sql: str,
    max_rows: int,
) -> dict:
    total = await _scalar(db, count_sql)
    if total == 0:
        return _limited([], 0, max_rows)
    rows = await _fetch(db, rows_sql, max_rows=max_rows)
    return _limited(rows, total, max_rows)


# ---------------------------------------------------------------------------
# Baseline
# ---------------------------------------------------------------------------


def script_heads() -> list[str]:
    """Return the Alembic head revisions declared by the checked-in scripts."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    api_root = Path(__file__).resolve().parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    return sorted(ScriptDirectory.from_config(config).get_heads())


async def audit_schema_baseline(db: AsyncSession) -> dict:
    database_revisions = [
        row["version_num"]
        for row in await _fetch(db, "SELECT version_num FROM alembic_version")
    ]
    heads = script_heads()
    return {
        "plan_document": PLAN_DOCUMENT,
        "increment": "A",
        "report_tool": "apps/api/scripts/audit_project_roles.py",
        "database_revisions": sorted(database_revisions),
        "script_heads": heads,
        "schema_in_sync": set(database_revisions) == set(heads),
    }


# ---------------------------------------------------------------------------
# Role discrepancies
# ---------------------------------------------------------------------------


async def audit_role_discrepancies(db: AsyncSession, *, max_rows: int) -> dict:
    unknown_platform_roles = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM users "
            f"WHERE role IS NULL OR role NOT IN {_PLATFORM_ROLES_SQL}"
        ),
        rows_sql=(
            "SELECT id, role FROM users "
            f"WHERE role IS NULL OR role NOT IN {_PLATFORM_ROLES_SQL} "
            "ORDER BY id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    unknown_member_roles = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM project_members "
            f"WHERE role IS NULL OR role NOT IN {_PROJECT_ROLES_SQL}"
        ),
        rows_sql=(
            "SELECT id, project_id, user_id, role FROM project_members "
            f"WHERE role IS NULL OR role NOT IN {_PROJECT_ROLES_SQL} "
            "ORDER BY id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    # Cross-project mixed roles are expected after the feature ships: an
    # employee may annotate in A and review in B.  Report them separately so a
    # migration review does not mistake them for corruption.
    mixed_roles = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM project_members pm "
            "JOIN users u ON u.id = pm.user_id "
            f"WHERE u.role IN {_EMPLOYEE_PLATFORM_ROLES_SQL} "
            f"AND pm.role IN {_PROJECT_ROLES_SQL} AND pm.role <> u.role"
        ),
        rows_sql=(
            "SELECT pm.id, pm.project_id, pm.user_id, u.role AS platform_role, "
            "pm.role AS project_role FROM project_members pm "
            "JOIN users u ON u.id = pm.user_id "
            f"WHERE u.role IN {_EMPLOYEE_PLATFORM_ROLES_SQL} "
            f"AND pm.role IN {_PROJECT_ROLES_SQL} AND pm.role <> u.role "
            "ORDER BY pm.project_id, pm.user_id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    # A platform viewer may only hold viewer memberships; anything else is a
    # genuine inconsistency rather than a legitimate mixed role.
    viewer_membership_conflicts = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM project_members pm "
            "JOIN users u ON u.id = pm.user_id "
            "WHERE u.role = 'viewer' "
            "AND (pm.role IS NULL OR pm.role IS DISTINCT FROM 'viewer')"
        ),
        rows_sql=(
            "SELECT pm.id, pm.project_id, pm.user_id, u.role AS platform_role, "
            "pm.role AS project_role FROM project_members pm "
            "JOIN users u ON u.id = pm.user_id "
            "WHERE u.role = 'viewer' "
            "AND (pm.role IS NULL OR pm.role IS DISTINCT FROM 'viewer') "
            "ORDER BY pm.project_id, pm.user_id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    # Administrators derive authority from ownership/platform role, not from an
    # ordinary employee membership.  Surface the rows for migration review.
    administrator_memberships = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM project_members pm "
            "JOIN users u ON u.id = pm.user_id "
            f"WHERE u.role IN {_ADMIN_PLATFORM_ROLES_SQL}"
        ),
        rows_sql=(
            "SELECT pm.id, pm.project_id, pm.user_id, u.role AS platform_role, "
            "pm.role AS project_role FROM project_members pm "
            "JOIN users u ON u.id = pm.user_id "
            f"WHERE u.role IN {_ADMIN_PLATFORM_ROLES_SQL} "
            "ORDER BY pm.project_id, pm.user_id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    # An employee/unknown owner is a migration blocker: administrative
    # privilege requires a valid admin platform role plus ownership.
    invalid_owners = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM projects p "
            "LEFT JOIN users u ON u.id = p.owner_id "
            f"WHERE u.id IS NULL OR u.role IS NULL OR u.role NOT IN {_ADMIN_PLATFORM_ROLES_SQL}"
        ),
        rows_sql=(
            "SELECT p.id AS project_id, p.owner_id, u.role AS owner_role "
            "FROM projects p LEFT JOIN users u ON u.id = p.owner_id "
            f"WHERE u.id IS NULL OR u.role IS NULL OR u.role NOT IN {_ADMIN_PLATFORM_ROLES_SQL} "
            "ORDER BY p.id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    inactive_owners = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM projects p JOIN users u ON u.id = p.owner_id "
            "WHERE u.is_active IS NOT TRUE"
        ),
        rows_sql=(
            "SELECT p.id AS project_id, p.owner_id, u.role AS owner_role "
            "FROM projects p JOIN users u ON u.id = p.owner_id "
            "WHERE u.is_active IS NOT TRUE ORDER BY p.id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    return {
        "unknown_platform_roles": unknown_platform_roles,
        "unknown_member_roles": unknown_member_roles,
        "cross_project_mixed_roles": mixed_roles,
        "viewer_membership_conflicts": viewer_membership_conflicts,
        "administrator_memberships": administrator_memberships,
        "invalid_administrative_owners": invalid_owners,
        "inactive_administrative_owners": inactive_owners,
    }


# ---------------------------------------------------------------------------
# Assignment / membership gaps
# ---------------------------------------------------------------------------


async def audit_assignment_gaps(db: AsyncSession, *, max_rows: int) -> dict:
    def count_sql(predicate: str) -> str:
        return (
            _EFFECTIVE_ASSIGNMENT_CTE
            + "SELECT count(*) FROM effective e "
            + _EFFECTIVE_ASSIGNMENT_JOINS
            + f" WHERE {predicate}"
        )

    def rows_sql(predicate: str) -> str:
        return (
            _EFFECTIVE_ASSIGNMENT_SELECT
            + f" WHERE {predicate} ORDER BY e.task_id LIMIT :max_rows"
        )

    async def category(predicate: str) -> dict:
        return await _count_and_rows(
            db,
            count_sql=count_sql(predicate),
            rows_sql=rows_sql(predicate),
            max_rows=max_rows,
        )

    assignee_missing = await category(
        "e.effective_assignee_id IS NOT NULL AND ma.id IS NULL"
    )
    assignee_wrong = await category(
        "ma.id IS NOT NULL AND ma.role IS DISTINCT FROM 'annotator'"
    )
    reviewer_missing = await category(
        "e.effective_reviewer_id IS NOT NULL AND mr.id IS NULL"
    )
    reviewer_wrong = await category(
        "mr.id IS NOT NULL AND mr.role IS DISTINCT FROM 'reviewer'"
    )
    inactive_assignments = await category(
        "(e.effective_assignee_id IS NOT NULL AND ua.is_active IS NOT TRUE) "
        "OR (e.effective_reviewer_id IS NOT NULL AND ur.is_active IS NOT TRUE)"
    )
    inactive_unfinished = await _count_and_rows(
        db,
        count_sql=(
            _EFFECTIVE_ASSIGNMENT_CTE + "SELECT count(DISTINCT u.id) FROM effective e "
            "JOIN users u ON u.is_active IS NOT TRUE "
            "AND u.id IN (e.effective_assignee_id, e.effective_reviewer_id) "
            "WHERE e.status <> 'completed'"
        ),
        rows_sql=(
            _EFFECTIVE_ASSIGNMENT_CTE
            + "SELECT u.id AS user_id, u.role, count(*) AS unfinished_tasks "
            "FROM effective e JOIN users u ON u.is_active IS NOT TRUE "
            "AND u.id IN (e.effective_assignee_id, e.effective_reviewer_id) "
            "WHERE e.status <> 'completed' "
            "GROUP BY u.id, u.role ORDER BY u.id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    return {
        "annotator_missing_membership": assignee_missing,
        "annotator_wrong_membership_role": assignee_wrong,
        "reviewer_missing_membership": reviewer_missing,
        "reviewer_wrong_membership_role": reviewer_wrong,
        "assignment_to_inactive_account": inactive_assignments,
        "inactive_accounts_with_unfinished_work": inactive_unfinished,
    }


# ---------------------------------------------------------------------------
# Invitations
# ---------------------------------------------------------------------------


async def audit_invitations(db: AsyncSession, *, max_rows: int) -> dict:
    status_counts = {
        "pending": await _scalar(
            db,
            "SELECT count(*) FROM user_invitations "
            "WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
        ),
        "accepted": await _scalar(
            db, "SELECT count(*) FROM user_invitations WHERE accepted_at IS NOT NULL"
        ),
        "revoked": await _scalar(
            db,
            "SELECT count(*) FROM user_invitations "
            "WHERE accepted_at IS NULL AND revoked_at IS NOT NULL",
        ),
        "expired": await _scalar(
            db,
            "SELECT count(*) FROM user_invitations "
            "WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()",
        ),
    }
    pending_rows_sql = (
        "SELECT i.id, i.project_id, i.role, i.project_role, i.expires_at, "
        "i.invited_by, (p.id IS NOT NULL) AS target_exists "
        "FROM user_invitations i LEFT JOIN projects p ON p.id = i.project_id "
        "WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL "
        "AND i.expires_at > now() ORDER BY i.project_id NULLS FIRST, i.id "
        "LIMIT :max_rows"
    )
    pending = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM user_invitations "
            "WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()"
        ),
        rows_sql=pending_rows_sql,
        max_rows=max_rows,
    )
    account_only_count = await _scalar(
        db,
        "SELECT count(*) FROM user_invitations WHERE project_id IS NULL "
        "AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
    )
    project_target_count = await _scalar(
        db,
        "SELECT count(*) FROM user_invitations WHERE project_id IS NOT NULL "
        "AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
    )
    deleted_targets = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM user_invitations i "
            "LEFT JOIN projects p ON p.id = i.project_id "
            "WHERE i.project_id IS NOT NULL AND p.id IS NULL "
            "AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()"
        ),
        rows_sql=(
            "SELECT i.id, i.project_id, i.role, i.project_role, i.expires_at "
            "FROM user_invitations i LEFT JOIN projects p ON p.id = i.project_id "
            "WHERE i.project_id IS NOT NULL AND p.id IS NULL "
            "AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() "
            "ORDER BY i.id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    # Legacy pending project invitations still carry their project role in the
    # platform ``role`` column; the migration must move it before converting.
    project_role_to_backfill = await _scalar(
        db,
        "SELECT count(*) FROM user_invitations WHERE project_id IS NOT NULL "
        "AND project_role IS NULL AND accepted_at IS NULL AND revoked_at IS NULL "
        "AND expires_at > now()",
    )
    account_invitation_with_project_role = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM user_invitations "
            "WHERE project_id IS NULL AND project_role IS NOT NULL "
            "AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()"
        ),
        rows_sql=(
            "SELECT id, role, project_role FROM user_invitations "
            "WHERE project_id IS NULL AND project_role IS NOT NULL "
            "AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() "
            "ORDER BY id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    return {
        "status_counts": status_counts,
        "pending": pending,
        "pending_account_only": {"total": account_only_count},
        "pending_project_target": {"total": project_target_count},
        "pending_deleted_project_target": deleted_targets,
        "pending_project_role_to_backfill": {"total": project_role_to_backfill},
        "account_invitation_with_project_role": account_invitation_with_project_role,
    }


# ---------------------------------------------------------------------------
# Review evidence
# ---------------------------------------------------------------------------


async def audit_review_evidence(db: AsyncSession, *, max_rows: int) -> dict:
    complete = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM tasks WHERE "
            f"({_REVIEW_ACTIVITY_SQL}) AND review_contributor_ids IS NOT NULL"
        ),
        rows_sql=(
            "SELECT id AS task_id, project_id, review_round_id, "
            "review_submitter_id FROM tasks WHERE "
            f"({_REVIEW_ACTIVITY_SQL}) AND review_contributor_ids IS NOT NULL "
            "ORDER BY id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    # Unknown evidence (NULL) on a task that has review activity is the
    # rollout-blocking case: review writes must stay blocked until repaired.
    unknown = await _count_and_rows(
        db,
        count_sql=(
            "SELECT count(*) FROM tasks WHERE "
            f"({_REVIEW_ACTIVITY_SQL}) AND review_contributor_ids IS NULL"
        ),
        rows_sql=(
            "SELECT id AS task_id, project_id, review_round_id, "
            "review_submitter_id FROM tasks WHERE "
            f"({_REVIEW_ACTIVITY_SQL}) AND review_contributor_ids IS NULL "
            "ORDER BY id LIMIT :max_rows"
        ),
        max_rows=max_rows,
    )
    absent = await _scalar(
        db,
        "SELECT count(*) FROM tasks WHERE "
        f"NOT ({_REVIEW_ACTIVITY_SQL}) AND review_contributor_ids IS NULL",
    )
    first_review_eligible_counts = {
        row["first_review_eligible"]: int(row["count"])
        for row in await _fetch(
            db,
            "SELECT first_review_eligible, count(*) AS count FROM tasks "
            "GROUP BY first_review_eligible",
        )
    }
    return {
        "complete": complete,
        "unknown": unknown,
        "no_review_activity": {"total": absent},
        "first_review_eligible_distribution": {
            ("true" if key is True else "false" if key is False else "unknown"): value
            for key, value in first_review_eligible_counts.items()
        },
    }


# ---------------------------------------------------------------------------
# Reconciliation totals
# ---------------------------------------------------------------------------


async def audit_reconciliation(db: AsyncSession) -> dict:
    async def grouped(sql: str, key: str) -> dict:
        return {
            (row[key] if row[key] is not None else "unknown"): int(row["count"])
            for row in await _fetch(db, sql)
        }

    users_by_role = await grouped(
        "SELECT role, count(*) AS count FROM users GROUP BY role", "role"
    )
    memberships_by_role = await grouped(
        "SELECT role, count(*) AS count FROM project_members GROUP BY role", "role"
    )
    tasks_by_status = await grouped(
        "SELECT status, count(*) AS count FROM tasks GROUP BY status", "status"
    )
    projects_by_status = await grouped(
        "SELECT status, count(*) AS count FROM projects GROUP BY status", "status"
    )
    annotations_by_source = await grouped(
        "SELECT source, count(*) AS count FROM annotations GROUP BY source", "source"
    )
    first_review_by_result = await grouped(
        "SELECT first_review_result, count(*) AS count FROM tasks "
        "WHERE first_review_result IS NOT NULL GROUP BY first_review_result",
        "first_review_result",
    )
    # Per-author annotation totals and per-assignee unfinished workload keep the
    # report bounded while allowing the deployment maintainer to reconcile
    # historical performance against the approved transformation.
    annotations_by_author = await _fetch(
        db,
        "SELECT user_id, count(*) AS active_annotations FROM annotations "
        "WHERE is_active IS TRUE AND was_cancelled IS FALSE AND user_id IS NOT NULL "
        "GROUP BY user_id ORDER BY user_id",
    )
    return {
        "users": {
            "total": await _scalar(db, "SELECT count(*) FROM users"),
            "active": await _scalar(
                db, "SELECT count(*) FROM users WHERE is_active IS TRUE"
            ),
            "inactive": await _scalar(
                db, "SELECT count(*) FROM users WHERE is_active IS NOT TRUE"
            ),
            "by_role": users_by_role,
        },
        "memberships": {
            "total": await _scalar(db, "SELECT count(*) FROM project_members"),
            "by_role": memberships_by_role,
        },
        "projects": {
            "total": await _scalar(db, "SELECT count(*) FROM projects"),
            "by_status": projects_by_status,
        },
        "tasks": {
            "total": await _scalar(db, "SELECT count(*) FROM tasks"),
            "by_status": tasks_by_status,
        },
        "assignments": {
            "with_effective_assignee": await _scalar(
                db,
                _EFFECTIVE_ASSIGNMENT_CTE + "SELECT count(*) FROM effective e "
                "WHERE e.effective_assignee_id IS NOT NULL",
            ),
            "with_effective_reviewer": await _scalar(
                db,
                _EFFECTIVE_ASSIGNMENT_CTE + "SELECT count(*) FROM effective e "
                "WHERE e.effective_reviewer_id IS NOT NULL",
            ),
            "unassigned_not_completed": await _scalar(
                db,
                _EFFECTIVE_ASSIGNMENT_CTE + "SELECT count(*) FROM effective e "
                "WHERE e.effective_assignee_id IS NULL AND e.status <> 'completed'",
            ),
            "review_claimed_not_completed": await _scalar(
                db,
                "SELECT count(*) FROM tasks "
                "WHERE reviewer_claimed_at IS NOT NULL AND status = 'review'",
            ),
        },
        "locks": {
            "total": await _scalar(db, "SELECT count(*) FROM task_locks"),
            "unexpired": await _scalar(
                db, "SELECT count(*) FROM task_locks WHERE expire_at > now()"
            ),
        },
        "annotations": {
            "total": await _scalar(db, "SELECT count(*) FROM annotations"),
            "active": await _scalar(
                db,
                "SELECT count(*) FROM annotations "
                "WHERE is_active IS TRUE AND was_cancelled IS FALSE",
            ),
            "cancelled": await _scalar(
                db, "SELECT count(*) FROM annotations WHERE was_cancelled IS TRUE"
            ),
            "distinct_authors": await _scalar(
                db,
                "SELECT count(DISTINCT user_id) FROM annotations "
                "WHERE user_id IS NOT NULL",
            ),
            "by_source": annotations_by_source,
        },
        "historical_review": {
            "first_reviewed": await _scalar(
                db, "SELECT count(*) FROM tasks WHERE first_reviewed_at IS NOT NULL"
            ),
            "by_first_review_result": first_review_by_result,
        },
        "annotations_by_author": annotations_by_author,
    }


# ---------------------------------------------------------------------------
# Report assembly
# ---------------------------------------------------------------------------


def build_summary(
    *,
    baseline: dict,
    roles: dict,
    assignments: dict,
    invitations: dict,
    evidence: dict,
) -> dict:
    """Derive the headline counts the deployer triages first (pure function)."""
    return {
        "schema_in_sync": baseline["schema_in_sync"],
        "unknown_platform_roles": roles["unknown_platform_roles"]["total"],
        "unknown_member_roles": roles["unknown_member_roles"]["total"],
        "cross_project_mixed_roles": roles["cross_project_mixed_roles"]["total"],
        "viewer_membership_conflicts": roles["viewer_membership_conflicts"]["total"],
        "administrator_memberships": roles["administrator_memberships"]["total"],
        "invalid_administrative_owners": roles["invalid_administrative_owners"][
            "total"
        ],
        "inactive_administrative_owners": roles["inactive_administrative_owners"][
            "total"
        ],
        "annotator_missing_membership": assignments["annotator_missing_membership"][
            "total"
        ],
        "reviewer_missing_membership": assignments["reviewer_missing_membership"][
            "total"
        ],
        "annotator_wrong_membership_role": assignments[
            "annotator_wrong_membership_role"
        ]["total"],
        "reviewer_wrong_membership_role": assignments["reviewer_wrong_membership_role"][
            "total"
        ],
        "assignment_to_inactive_account": assignments["assignment_to_inactive_account"][
            "total"
        ],
        "inactive_accounts_with_unfinished_work": assignments[
            "inactive_accounts_with_unfinished_work"
        ]["total"],
        "pending_invitations": invitations["status_counts"]["pending"],
        "pending_deleted_project_target": invitations["pending_deleted_project_target"][
            "total"
        ],
        "pending_project_role_to_backfill": invitations[
            "pending_project_role_to_backfill"
        ]["total"],
        "review_evidence_unknown": evidence["unknown"]["total"],
        "review_evidence_complete": evidence["complete"]["total"],
    }


def collect_limits(*sections: dict, max_rows: int = DEFAULT_MAX_ROWS) -> dict:
    """Return the ``limits`` block for any truncated entity list."""
    truncated = sorted(
        {name for section in sections for name, _ in _walk_sections(section)}
    )
    return {"max_rows_per_section": max_rows, "truncated_sections": truncated}


def _walk_sections(section: dict) -> list[tuple[str, dict]]:
    found: list[tuple[str, dict]] = []
    for name, value in section.items():
        if isinstance(value, dict) and "truncated" in value and value["truncated"]:
            found.append((name, value))
    return found


async def collect_report(
    db: AsyncSession,
    *,
    run_id: str | None = None,
    generated_at: datetime | None = None,
    max_rows: int = DEFAULT_MAX_ROWS,
) -> dict:
    run_id = run_id or str(uuid.uuid4())
    generated_at = generated_at or datetime.now(timezone.utc)
    baseline = await audit_schema_baseline(db)
    roles = await audit_role_discrepancies(db, max_rows=max_rows)
    assignments = await audit_assignment_gaps(db, max_rows=max_rows)
    invitations = await audit_invitations(db, max_rows=max_rows)
    evidence = await audit_review_evidence(db, max_rows=max_rows)
    reconciliation = await audit_reconciliation(db)
    summary = build_summary(
        baseline=baseline,
        roles=roles,
        assignments=assignments,
        invitations=invitations,
        evidence=evidence,
    )
    return {
        "report_version": AUDIT_REPORT_VERSION,
        "run_id": run_id,
        "generated_at": generated_at,
        "read_only": True,
        "baseline": baseline,
        "limits": collect_limits(
            roles, assignments, invitations, evidence, max_rows=max_rows
        ),
        "summary": summary,
        "findings": {
            "role_discrepancies": roles,
            "assignment_membership_gaps": assignments,
            "invitations": invitations,
            "review_evidence": evidence,
        },
        "reconciliation": reconciliation,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _json_default(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


async def _run(
    database_url: str, *, max_rows: int, output: str | None, pretty: bool
) -> int:
    engine = create_async_engine(database_url, echo=False)
    try:
        sessionmaker = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        async with sessionmaker() as db:
            # Read-only at the transaction level: even a future bug cannot
            # mutate roles or memberships from this command.
            await db.execute(text("SET TRANSACTION READ ONLY"))
            report = await collect_report(db, max_rows=max_rows)
            await db.rollback()
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"audit failed: {type(exc).__name__}", file=sys.stderr)
        return 2
    finally:
        await engine.dispose()

    rendered = json.dumps(
        report,
        default=_json_default,
        ensure_ascii=False,
        indent=2 if pretty else None,
    )
    if output:
        Path(output).write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=None,
        help="read-only audit target; defaults to settings.database_url",
    )
    parser.add_argument("--output", help="write the JSON report to this path")
    parser.add_argument(
        "--max-rows",
        type=int,
        default=DEFAULT_MAX_ROWS,
        help="cap on entity rows returned per finding (counts stay exact)",
    )
    parser.add_argument("--pretty", action="store_true", help="indent output")
    args = parser.parse_args()

    database_url = args.database_url
    if database_url is None:
        from app.config import settings

        database_url = settings.database_url

    sys.exit(
        asyncio.run(
            _run(
                database_url,
                max_rows=args.max_rows,
                output=args.output,
                pretty=args.pretty,
            )
        )
    )


if __name__ == "__main__":
    main()
