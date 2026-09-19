"""Behavioral audit tests for Increment A project-role preparation.

These tests run against a real disposable PostgreSQL schema.  Seeded rows are
committed so the audit can run in the PostgreSQL-enforced ``REPEATABLE READ,
READ ONLY`` transaction used by the CLI; every test cleans up in ``finally``.
Assertions are ID-scoped so pre-existing committed rows do not matter.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models.project_member import ProjectMember
from app.db.models.task_batch import TaskBatch
from app.db.models.user_invitation import UserInvitation
from scripts.audit_project_roles import (
    AUDIT_REPORT_VERSION,
    _json_default,
    collect_report,
    read_only_audit_session,
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


def _item_user_ids(section: dict) -> set[str]:
    return {str(item["user_id"]) for item in section["items"]}


async def _readonly_report(engine, **kwargs) -> dict:
    async with read_only_audit_session(engine) as db:
        report = await collect_report(db, **kwargs)
        # Prove the transaction is genuinely read-only: a write must fail.
        raised = None
        try:
            await db.execute(
                text(
                    "INSERT INTO project_members "
                    "(id, project_id, user_id, role, assigned_by) "
                    "VALUES (:id, :project_id, :user_id, 'viewer', :assigned_by)"
                ),
                {
                    "id": uuid.uuid4(),
                    "project_id": uuid.uuid4(),
                    "user_id": uuid.uuid4(),
                    "assigned_by": uuid.uuid4(),
                },
            )
        except Exception as exc:  # noqa: BLE001 - prove READ ONLY enforcement
            raised = exc
        assert raised is not None, "write unexpectedly succeeded in read-only audit"
        assert "read-only" in str(raised).lower(), f"unexpected write error: {raised}"
        return report


async def _seed_full(engine) -> dict:
    users: list[uuid.UUID] = []
    projects: list[uuid.UUID] = []
    ids: dict = {}

    async with async_sessionmaker(engine, expire_on_commit=False)() as db:

        async def make_user(role: str, tag: str):
            user = await create_user(
                db, role, f"audit-{tag}-{uuid.uuid4()}@test.local", tag.title()
            )
            users.append(user.id)
            return user

        owner = await make_user("project_admin", "owner")
        project = await create_project(db, owner_id=owner.id)
        other_project = await create_project(db, owner_id=owner.id)
        projects.extend([project.id, other_project.id])

        unknown_user = await make_user("mystery_role", "unknown")
        unknown_member = ProjectMember(
            project_id=project.id,
            user_id=unknown_user.id,
            role="mystery_member",
            assigned_by=owner.id,
        )

        # Legacy mismatch: global annotator with a reviewer membership.
        legacy_user = await make_user("annotator", "legacy")
        legacy_member = ProjectMember(
            project_id=project.id,
            user_id=legacy_user.id,
            role="reviewer",
            assigned_by=owner.id,
        )

        # Post-conversion diversity: employee annotating in A and reviewing in B.
        employee_user = await make_user("employee", "employee")
        employee_member_a = ProjectMember(
            project_id=project.id,
            user_id=employee_user.id,
            role="annotator",
            assigned_by=owner.id,
        )
        employee_member_b = ProjectMember(
            project_id=other_project.id,
            user_id=employee_user.id,
            role="reviewer",
            assigned_by=owner.id,
        )

        viewer = await make_user("viewer", "viewer")
        viewer_member = ProjectMember(
            project_id=project.id,
            user_id=viewer.id,
            role="annotator",
            assigned_by=owner.id,
        )

        admin_member = ProjectMember(
            project_id=project.id,
            user_id=owner.id,
            role="viewer",
            assigned_by=owner.id,
        )

        bad_owner = await make_user("annotator", "badowner")
        bad_project = await create_project(db, owner_id=bad_owner.id)
        projects.append(bad_project.id)

        inactive_owner = await make_user("project_admin", "inactiveowner")
        inactive_owner.is_active = False
        inactive_project = await create_project(db, owner_id=inactive_owner.id)
        projects.append(inactive_project.id)

        # Assignment gaps: explicit, inherited batch and overridden batch.
        assignee = await make_user("annotator", "assignee")
        task_missing = await create_task(db, project_id=project.id)
        task_missing.assignee_id = assignee.id

        reviewer = await make_user("reviewer", "reviewer")
        task_missing_reviewer = await create_task(db, project_id=project.id)
        task_missing_reviewer.reviewer_id = reviewer.id

        # Inherited: no task assignee, the batch default is a non-member.
        batch_annotator = await make_user("annotator", "batchnonmember")
        batch_inherited = TaskBatch(
            project_id=project.id,
            display_id=f"B-AUDIT-{uuid.uuid4().hex[:8]}",
            name="Inherited",
            annotator_id=batch_annotator.id,
        )
        db.add(batch_inherited)
        await db.flush()
        task_inherited = await create_task(db, project_id=project.id)
        task_inherited.batch_id = batch_inherited.id

        # Override: the batch default is a valid annotator member, but the task
        # explicitly points at a non-member.  Effective assignment must be the
        # task value, so this is flagged.
        batch_override = TaskBatch(
            project_id=project.id,
            display_id=f"B-AUDIT-{uuid.uuid4().hex[:8]}",
            name="Override",
            annotator_id=employee_user.id,
        )
        db.add(batch_override)
        await db.flush()
        task_override = await create_task(db, project_id=project.id)
        task_override.batch_id = batch_override.id
        task_override.assignee_id = assignee.id

        task_wrong_role = await create_task(db, project_id=project.id)
        task_wrong_role.assignee_id = legacy_user.id

        inactive_assignee = await make_user("annotator", "inactive")
        inactive_assignee.is_active = False
        inactive_assignee.disabled_kind = "suspended"
        task_inactive = await create_task(
            db, project_id=project.id, status="in_progress"
        )
        task_inactive.assignee_id = inactive_assignee.id

        db.add_all(
            [
                unknown_member,
                legacy_member,
                employee_member_a,
                employee_member_b,
                viewer_member,
                admin_member,
                batch_inherited,
                batch_override,
                task_missing,
                task_missing_reviewer,
                task_inherited,
                task_override,
                task_wrong_role,
                task_inactive,
            ]
        )

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
            email=f"audit-legacyinv-{uuid.uuid4()}@test.local",
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

        # Review evidence cases.
        task_complete = await create_task(db, project_id=project.id, status="completed")
        task_complete.review_round_id = uuid.uuid4()
        task_complete.review_submitter_id = assignee.id
        task_complete.review_contributor_ids = [str(assignee.id)]
        task_complete.annotation_contributor_ids = [str(assignee.id)]

        task_missing_submitter = await create_task(
            db, project_id=project.id, status="review"
        )
        task_missing_submitter.review_round_id = uuid.uuid4()
        task_missing_submitter.review_submitter_id = None
        task_missing_submitter.review_contributor_ids = [str(assignee.id)]
        task_missing_submitter.annotation_contributor_ids = [str(assignee.id)]

        task_malformed = await create_task(db, project_id=project.id, status="review")
        task_malformed.review_round_id = uuid.uuid4()
        task_malformed.review_submitter_id = assignee.id
        task_malformed.review_contributor_ids = {"not": "an-array"}
        task_malformed.annotation_contributor_ids = [str(assignee.id)]

        task_unknown_accumulator = await create_task(
            db, project_id=project.id, status="review"
        )
        task_unknown_accumulator.review_round_id = uuid.uuid4()
        task_unknown_accumulator.review_submitter_id = assignee.id
        task_unknown_accumulator.review_contributor_ids = [str(assignee.id)]
        task_unknown_accumulator.annotation_contributor_ids = None

        task_missing_round = await create_task(
            db, project_id=project.id, status="review"
        )
        task_missing_round.review_round_id = None

        db.add_all(
            [
                task_complete,
                task_missing_submitter,
                task_malformed,
                task_unknown_accumulator,
                task_missing_round,
            ]
        )
        await db.flush()
        ids = {
            "project": project.id,
            "other_project": other_project.id,
            "unknown_user": unknown_user.id,
            "unknown_member": unknown_member.id,
            "legacy_user": legacy_user.id,
            "legacy_member": legacy_member.id,
            "employee_user": employee_user.id,
            "viewer_member": viewer_member.id,
            "admin_member": admin_member.id,
            "bad_project": bad_project.id,
            "inactive_project": inactive_project.id,
            "task_missing": task_missing.id,
            "task_missing_reviewer": task_missing_reviewer.id,
            "task_inherited": task_inherited.id,
            "task_override": task_override.id,
            "task_wrong_role": task_wrong_role.id,
            "task_inactive": task_inactive.id,
            "inactive_assignee": inactive_assignee.id,
            "deleted_invitation": deleted_invitation.id,
            "legacy_project_invitation": legacy_project_invitation.id,
            "account_invitation": account_invitation.id,
            "task_complete": task_complete.id,
            "task_missing_submitter": task_missing_submitter.id,
            "task_malformed": task_malformed.id,
            "task_unknown_accumulator": task_unknown_accumulator.id,
            "task_missing_round": task_missing_round.id,
        }
        await db.commit()

    return {"ids": ids, "users": users, "projects": projects}


async def _cleanup(engine, ctx: dict) -> None:
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        projects = ctx.get("projects") or []
        users = ctx.get("users") or []
        if projects:
            await db.execute(
                text("DELETE FROM tasks WHERE project_id = ANY(:p)"),
                {"p": projects},
            )
            await db.execute(
                text("DELETE FROM task_batches WHERE project_id = ANY(:p)"),
                {"p": projects},
            )
            await db.execute(
                text("DELETE FROM project_members WHERE project_id = ANY(:p)"),
                {"p": projects},
            )
            await db.execute(
                text("DELETE FROM projects WHERE id = ANY(:p)"), {"p": projects}
            )
        if users:
            await db.execute(
                text("DELETE FROM user_invitations WHERE invited_by = ANY(:u)"),
                {"u": users},
            )
            await db.execute(text("DELETE FROM users WHERE id = ANY(:u)"), {"u": users})
        await db.commit()


async def test_audit_flags_expected_discrepancies(
    test_engine, apply_migrations
) -> None:
    ctx = await _seed_full(test_engine)
    ids = ctx["ids"]
    try:
        report = await _readonly_report(
            test_engine, run_id="audit-test", generated_at=datetime.now(timezone.utc)
        )
    finally:
        await _cleanup(test_engine, ctx)

    assert report["report_version"] == AUDIT_REPORT_VERSION
    assert report["read_only"] is True
    assert report["baseline"]["schema_in_sync"] is True
    assert all(report["baseline"]["schema_capabilities"].values())

    roles = report["findings"]["role_discrepancies"]
    assert str(ids["unknown_user"]) in _item_ids(roles["unknown_platform_roles"])
    assert str(ids["unknown_member"]) in _item_ids(roles["unknown_member_roles"])
    assert str(ids["legacy_member"]) in _item_ids(
        roles["legacy_global_member_mismatches"]
    )
    # The employee with annotator/reviewer memberships is diversity, not a
    # legacy global/member mismatch.
    assert str(ids["employee_user"]) in _item_user_ids(
        roles["cross_project_role_diversity"]
    )
    assert str(ids["employee_user"]) not in _item_user_ids(
        roles["legacy_global_member_mismatches"]
    )
    assert str(ids["viewer_member"]) in _item_ids(roles["viewer_membership_conflicts"])
    assert str(ids["admin_member"]) in _item_ids(roles["administrator_memberships"])
    assert str(ids["bad_project"]) in _item_ids(roles["invalid_administrative_owners"])
    assert str(ids["inactive_project"]) in _item_ids(
        roles["inactive_administrative_owners"]
    )

    gaps = report["findings"]["assignment_membership_gaps"]
    assert str(ids["task_missing"]) in _item_ids(gaps["annotator_missing_membership"])
    # Inherited batch default and explicit task override both resolve through
    # the effective-assignment CTE.
    assert str(ids["task_inherited"]) in _item_ids(gaps["annotator_missing_membership"])
    assert str(ids["task_override"]) in _item_ids(gaps["annotator_missing_membership"])
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
    assert str(ids["legacy_project_invitation"]) in {
        str(item["id"])
        for item in invitations["pending"]["items"]
        if item["project_role"] is None
    }
    assert invitations["pending_project_role_to_backfill"]["total"] >= 1
    assert str(ids["account_invitation"]) in _item_ids(
        invitations["account_invitation_with_project_role"]
    )

    evidence = report["findings"]["review_evidence"]
    assert str(ids["task_complete"]) in _item_ids(evidence["complete"])
    assert str(ids["task_missing_submitter"]) in _item_ids(evidence["incomplete"])
    assert str(ids["task_malformed"]) in _item_ids(evidence["incomplete"])
    assert str(ids["task_unknown_accumulator"]) in _item_ids(evidence["incomplete"])
    assert str(ids["task_missing_round"]) in _item_ids(evidence["incomplete"])
    reasons = evidence["incomplete_reasons"]
    assert reasons["missing_submitter"]["total"] >= 1
    assert reasons["malformed_review_array"]["total"] >= 1
    assert reasons["unknown_accumulator"]["total"] >= 1
    assert reasons["missing_round"]["total"] >= 1

    reconciliation = report["reconciliation"]
    assert reconciliation["projects"]["total"] >= 2
    assert reconciliation["memberships"]["total"] >= 4
    assert reconciliation["tasks"]["total"] >= 6

    rendered = json.dumps(report, default=_json_default)
    assert "audit-" not in rendered
    _assert_no_sensitive_keys(report)


async def test_audit_runs_before_0173_migration(
    test_engine, test_db_url, apply_migrations
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", test_db_url)
    ctx = await _seed_minimal(test_engine)
    ids = ctx["ids"]
    try:
        command.downgrade(config, "0172")
        report = await _readonly_report(test_engine, run_id="pre-0173")
    finally:
        command.upgrade(config, "head")
        await _cleanup(test_engine, ctx)

    assert report["baseline"]["schema_in_sync"] is False
    assert not any(report["baseline"]["schema_capabilities"].values())
    assert report["findings"]["review_evidence"]["complete"]["total"] == 0
    assert report["findings"]["review_evidence"]["incomplete"]["total"] >= 1
    assert report["summary"]["review_evidence_incomplete"] >= 1
    assert (
        report["findings"]["invitations"]["pending_project_role_to_backfill"]["total"]
        >= 1
    )
    assert (
        report["findings"]["invitations"]["account_invitation_with_project_role"][
            "total"
        ]
        == 0
    )
    pending = {
        str(item["id"]): item
        for item in report["findings"]["invitations"]["pending"]["items"]
    }
    assert pending[str(ids["legacy_project_invitation"])]["project_role"] is None
    json.dumps(report, default=_json_default)
    _assert_no_sensitive_keys(report)


async def _seed_minimal(engine) -> dict:
    users: list[uuid.UUID] = []
    projects: list[uuid.UUID] = []
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        owner = await create_user(
            db, "project_admin", f"audit-pre-{uuid.uuid4()}@test.local", "PreOwner"
        )
        users.append(owner.id)
        project = await create_project(db, owner_id=owner.id)
        projects.append(project.id)
        db.add(
            ProjectMember(
                project_id=project.id,
                user_id=owner.id,
                role="viewer",
                assigned_by=owner.id,
            )
        )
        task = await create_task(db, project_id=project.id, status="review")
        task.review_round_id = uuid.uuid4()
        future = datetime.now(timezone.utc) + timedelta(days=3)
        legacy_invitation = UserInvitation(
            email=f"audit-pre-inv-{uuid.uuid4()}@test.local",
            role="annotator",
            project_id=project.id,
            project_role=None,
            token=uuid.uuid4().hex,
            expires_at=future,
            invited_by=owner.id,
        )
        account_invitation = UserInvitation(
            email=f"audit-pre-account-{uuid.uuid4()}@test.local",
            role="viewer",
            project_id=None,
            project_role="annotator",
            token=uuid.uuid4().hex,
            expires_at=future,
            invited_by=owner.id,
        )
        db.add_all([legacy_invitation, account_invitation])
        await db.flush()
        ids = {
            "legacy_project_invitation": legacy_invitation.id,
            "task": task.id,
        }
        await db.commit()
    return {"ids": ids, "users": users, "projects": projects}


def _assert_no_sensitive_keys(value, path: str = "") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            assert key not in _SENSITIVE_KEYS, f"sensitive key {key} at {path}"
            _assert_no_sensitive_keys(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _assert_no_sensitive_keys(nested, f"{path}[{index}]")
