"""Pure contract checks for the read-only project-role audit.

No database is required; these tests pin the versioned report contract and the
Alembic graph invariants so a later increment cannot silently drop the
preparation revision or change the report version.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from scripts.audit_project_roles import (
    AUDIT_REPORT_VERSION,
    _json_default,
    _limited,
    build_summary,
    collect_limits,
    script_heads,
)

_MEMBERSHIP_KEYS = (
    "unknown_platform_roles",
    "unknown_member_roles",
    "cross_project_mixed_roles",
    "viewer_membership_conflicts",
    "administrator_memberships",
    "invalid_administrative_owners",
    "inactive_administrative_owners",
)
_ASSIGNMENT_KEYS = (
    "annotator_missing_membership",
    "annotator_wrong_membership_role",
    "reviewer_missing_membership",
    "reviewer_wrong_membership_role",
    "assignment_to_inactive_account",
    "inactive_accounts_with_unfinished_work",
)


def test_report_version_is_explicit() -> None:
    assert AUDIT_REPORT_VERSION == "project-role-audit/1"


def test_script_graph_has_single_head_and_preparation_revision() -> None:
    heads = script_heads()
    assert len(heads) == 1, f"expected a single alembic head, got {heads}"

    api_root = Path(__file__).resolve().parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    revisions = {
        revision.revision
        for revision in ScriptDirectory.from_config(config).walk_revisions()
    }
    # Later increments may extend the chain; 0173 must never be dropped.
    assert "0173" in revisions


def test_limited_marks_truncation() -> None:
    rows = [{"id": 1}, {"id": 2}]
    assert _limited(rows, 5, 10) == {
        "total": 5,
        "returned": 2,
        "truncated": True,
        "items": rows,
    }
    assert _limited(rows, 2, 10)["truncated"] is False


def test_collect_limits_reports_only_truncated_sections() -> None:
    section = {"pending": _limited([{"id": 1}], 3, 1), "summary": {"total": 0}}
    limits = collect_limits(section, max_rows=1)
    assert limits == {"max_rows_per_section": 1, "truncated_sections": ["pending"]}


def test_json_default_serializes_uuid_and_datetime() -> None:
    value = uuid.uuid4()
    moment = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
    assert json.loads(json.dumps({"id": value}, default=_json_default)) == {
        "id": str(value)
    }
    assert _json_default(moment) == "2026-09-19T12:00:00+00:00"


def test_build_summary_projects_each_finding() -> None:
    baseline = {"schema_in_sync": True}
    roles = {key: {"total": index} for index, key in enumerate(_MEMBERSHIP_KEYS)}
    assignments = {key: {"total": 100 + i} for i, key in enumerate(_ASSIGNMENT_KEYS)}
    invitations = {
        "status_counts": {"pending": 7},
        "pending_deleted_project_target": {"total": 2},
        "pending_project_role_to_backfill": {"total": 3},
    }
    evidence = {"unknown": {"total": 11}, "complete": {"total": 4}}

    summary = build_summary(
        baseline=baseline,
        roles=roles,
        assignments=assignments,
        invitations=invitations,
        evidence=evidence,
    )

    assert summary["schema_in_sync"] is True
    assert summary["unknown_platform_roles"] == 0
    assert summary["inactive_administrative_owners"] == 6
    assert summary["annotator_missing_membership"] == 100
    assert summary["inactive_accounts_with_unfinished_work"] == 105
    assert summary["pending_invitations"] == 7
    assert summary["pending_deleted_project_target"] == 2
    assert summary["pending_project_role_to_backfill"] == 3
    assert summary["review_evidence_unknown"] == 11
    assert summary["review_evidence_complete"] == 4
    json.dumps(summary)
