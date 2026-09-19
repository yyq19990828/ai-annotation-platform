"""Behavioral audit tests for Increment A project-role preparation.

Run in an isolated disposable test database (``apply_migrations`` upgrades to
the real head).  Assertions are ID-scoped so they stay valid regardless of
pre-existing committed rows in the shared test schema.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from app.db.models.project_member import ProjectMember
from app.db.models.user_invitation import UserInvitation
from scripts.audit_project_roles import (
    AUDIT_REPORT_VERSION,
    _json_default,
    collect_report,
)
from tests.factory import create_project, create_task, create_user

_SENSITIVE_KEYS = {"password_hash", "token", "email", "invite_url", "signed_url"}


def _item_ids(section: dict) -> set[str]:
    return {
        str(
            item.get("id")
            or item.get("task_id")
            or item.get("project_id")
            or item.get("user_id")
        )
        for item in section["items"]
    }


async def _seed(db) -> dict:
    owner = await create_user(
        db, "project_admin", f"audit-owner-{uuid.uuid4()}@test.local", "Owner"
    )
    project = await create_project(db, owner_id=owner.id)
    other_project = await create_project(db, owner_id=owner.id)

    # Unknown platform and membership roles.
    unknown_user = await create_user(
        db, "mystery_role", f"audit-unknown-{uuid.uuid4()}@test.local", "Unknown"
    )
    unknown_member = ProjectMember(
        project_id=project.id,
        user_id=unknown_user.id,
        role="mystery_member",
        assigned_by=owner.id,
    )

    # Legitimate cross-project mixed role: employee annotator with a reviewer
    # membership.  Must not be reported as a genuine inconsistency.
    mixed_user = await create_user(
        db, "annotator", f"audit-mixed-{uuid.uuid4()}@test.local", "Mixed"
    )
    mixed_member = ProjectMember(
        project_id=project.id,
        user_id=mixed_user.id,
        role="reviewer",
        assigned_by=owner.id,
    )

    # Genuine inconsistency: platform viewer with a write membership.
    viewer = await create_user(
        db, "viewer", f"audit-viewer-{uuid.uuid4()}@test.local", "Viewer"
    )
    viewer_member = ProjectMember(
        project_id=project.id,
        user_id=viewer.id,
        role="annotator",
        assigned_by=owner.id,
    )

    # Administrator membership: project_admin holding an ordinary membership.
    admin_member = ProjectMember(
        project_id=project.id,
        user_id=owner.id,
        role="viewer",
        assigned_by=owner.id,
    )

    # Invalid and inactive administrative owners.
    bad_owner = await create_user(
        db, "annotator", f"audit-badowner-{uuid.uuid4()}@test.local", "BadOwner"
    )
    bad_project = await create_project(db, owner_id=bad_owner.id)
    inactive_owner = await create_user(
        db,
        "project_admin",
        f"audit-inactiveowner-{uuid.uuid4()}@test.local",
        "InactiveOwner",
    )
    inactive_owner.is_active = False
    inactive_project = await create_project(db, owner_id=inactive_owner.id)

    # Assignment gaps.
    assignee = await create_user(
        db, "annotator", f"audit-assignee-{uuid.uuid4()}@test.local", "Assignee"
    )
    task_missing = await create_task(db, project_id=project.id)
    task_missing.assignee_id = assignee.id

    reviewer = await create_user(
        db, "reviewer", f"audit-reviewer-{uuid.uuid4()}@test.local", "Reviewer"
    )
    task_missing_reviewer = await create_task(db, project_id=project.id)
    task_missing_reviewer.reviewer_id = reviewer.id

    # mixed_user has a reviewer membership but is assigned annotation work.
    task_wrong_role = await create_task(db, project_id=project.id)
    task_wrong_role.assignee_id = mixed_user.id

    inactive_assignee = await create_user(
        db, "annotator", f"audit-inactive-{uuid.uuid4()}@test.local", "InactiveAssignee"
    )
    inactive_assignee.is_active = False
    task_inactive = await create_task(db, project_id=project.id, status="in_progress")
    task_inactive.assignee_id = inactive_assignee.id
    db.add_all(
        [
            unknown_member,
            mixed_member,
            viewer_member,
            admin_member,
            task_missing,
            task_missing_reviewer,
            task_wrong_role,
            task_inactive,
        ]
    )

    # Invitations: pending project target with a deleted target, a legacy
    # project invitation without a project_role, and an account invitation that
    # wrongly carries a project_role.
    future = datetime.now(timezone.utc) + timedelta(days=3)
    deleted_invitation = UserInvitation(
        email=f"audit-deleted-{uuid.uuid4()}@test.local",
        role="reviewer",
        project_id=uuid.uuid4(),
        project_role="reviewer",
        token=uuid.uuid4().hex,
        expires_at=future,
        invited_by=owner.id,
    )
    legacy_project_invitation = UserInvitation(
        email=f"audit-legacy-{uuid.uuid4()}@test.local",
        role="annotator",
        project_id=project.id,
        project_role=None,
        token=uuid.uuid4().hex,
        expires_at=future,
        invited_by=owner.id,
    )
    account_invitation = UserInvitation(
        email=f"audit-account-{uuid.uuid4()}@test.local",
        role="viewer",
        project_id=None,
        project_role="annotator",
        token=uuid.uuid4().hex,
        expires_at=future,
        invited_by=owner.id,
    )
    db.add_all([deleted_invitation, legacy_project_invitation, account_invitation])

    # Review evidence: one complete round and one unknown legacy round.
    task_complete = await create_task(db, project_id=project.id, status="completed")
    task_complete.review_round_id = uuid.uuid4()
    task_complete.review_contributor_ids = [str(assignee.id)]
    task_unknown = await create_task(db, project_id=project.id, status="review")
    task_unknown.review_round_id = uuid.uuid4()
    task_unknown.review_contributor_ids = None
    db.add_all([task_complete, task_unknown])

    await db.flush()
    return {
        "owner": owner.id,
        "project": project.id,
        "other_project": other_project.id,
        "unknown_user": unknown_user.id,
        "unknown_member": unknown_member.id,
        "mixed_member": mixed_member.id,
        "viewer_member": viewer_member.id,
        "admin_member": admin_member.id,
        "bad_project": bad_project.id,
        "inactive_project": inactive_project.id,
        "task_missing": task_missing.id,
        "task_missing_reviewer": task_missing_reviewer.id,
        "task_wrong_role": task_wrong_role.id,
        "task_inactive": task_inactive.id,
        "inactive_assignee": inactive_assignee.id,
        "deleted_invitation": deleted_invitation.id,
        "legacy_project_invitation": legacy_project_invitation.id,
        "account_invitation": account_invitation.id,
        "task_complete": task_complete.id,
        "task_unknown": task_unknown.id,
    }


async def test_audit_flags_expected_discrepancies(db_session) -> None:
    ids = await _seed(db_session)
    report = await collect_report(
        db_session, run_id="contract-test", generated_at=datetime.now(timezone.utc)
    )

    assert report["report_version"] == AUDIT_REPORT_VERSION
    assert report["read_only"] is True
    assert report["baseline"]["schema_in_sync"] is True

    roles = report["findings"]["role_discrepancies"]
    assert str(ids["unknown_user"]) in _item_ids(roles["unknown_platform_roles"])
    assert str(ids["unknown_member"]) in _item_ids(roles["unknown_member_roles"])
    assert str(ids["mixed_member"]) in _item_ids(roles["cross_project_mixed_roles"])
    assert str(ids["viewer_member"]) in _item_ids(roles["viewer_membership_conflicts"])
    assert str(ids["admin_member"]) in _item_ids(roles["administrator_memberships"])
    assert str(ids["bad_project"]) in _item_ids(roles["invalid_administrative_owners"])
    assert str(ids["inactive_project"]) in _item_ids(
        roles["inactive_administrative_owners"]
    )

    gaps = report["findings"]["assignment_membership_gaps"]
    assert str(ids["task_missing"]) in _item_ids(gaps["annotator_missing_membership"])
    assert str(ids["task_missing_reviewer"]) in _item_ids(
        gaps["reviewer_missing_membership"]
    )
    assert str(ids["task_wrong_role"]) in _item_ids(
        gaps["annotator_wrong_membership_role"]
    )
    assert str(ids["task_inactive"]) in _item_ids(
        gaps["assignment_to_inactive_account"]
    )
    assert str(ids["inactive_assignee"]) in _item_ids(
        gaps["inactive_accounts_with_unfinished_work"]
    )

    invitations = report["findings"]["invitations"]
    assert str(ids["deleted_invitation"]) in _item_ids(
        invitations["pending_deleted_project_target"]
    )
    assert invitations["pending_project_role_to_backfill"]["total"] >= 1
    assert str(ids["account_invitation"]) in _item_ids(
        invitations["account_invitation_with_project_role"]
    )

    evidence = report["findings"]["review_evidence"]
    assert str(ids["task_unknown"]) in _item_ids(evidence["unknown"])
    assert str(ids["task_complete"]) in _item_ids(evidence["complete"])
    assert report["summary"]["review_evidence_unknown"] >= 1

    reconciliation = report["reconciliation"]
    assert reconciliation["projects"]["total"] >= 2
    assert reconciliation["memberships"]["total"] >= 4
    assert reconciliation["users"]["total"] >= 1
    assert reconciliation["tasks"]["total"] >= 6

    # Serialization and privacy: the report must render and never leak tokens,
    # password hashes, invitation emails or signed URLs.
    rendered = json.dumps(report, default=_json_default)
    assert "audit-" not in rendered
    _assert_no_sensitive_keys(report)


def _assert_no_sensitive_keys(value, path: str = "") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            assert key not in _SENSITIVE_KEYS, f"sensitive key {key} at {path}"
            _assert_no_sensitive_keys(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _assert_no_sensitive_keys(nested, f"{path}[{index}]")
