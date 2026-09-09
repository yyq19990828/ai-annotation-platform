"""Exercise reviewed plans against actual task rows and intervening changes."""

from datetime import datetime, timezone
import uuid

import pytest
from sqlalchemy import select
from app.db.models.project_member import ProjectMember
from app.db.models.task_batch import TaskBatch
from app.db.models.user_invitation import UserInvitation
from tests.factory import create_project, create_user, create_task

pytestmark = pytest.mark.asyncio


async def test_distribution_counts_real_tasks_and_applies_identical_tied_order(
    httpx_client, super_admin, db_session
):
    admin, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    project = await create_project(db_session, owner_id=admin.id)
    users = [
        await create_user(db_session, "annotator", f"load-{i}@e.test", f"Worker {i}")
        for i in range(2)
    ]
    for user in users:
        db_session.add(
            ProjectMember(
                project_id=project.id,
                user_id=user.id,
                role="annotator",
                assigned_by=admin.id,
            )
        )
    timestamp = datetime.now(timezone.utc)
    batches = []
    # Insert opposite to UUID order; priority and timestamps intentionally tie.
    for index in (2, 1):
        batch = TaskBatch(
            id=uuid.UUID(int=index),
            project_id=project.id,
            display_id=f"B-LOAD-{index}",
            name=f"Batch {index}",
            status="draft",
            created_at=timestamp,
            total_tasks=900,
        )
        db_session.add(batch)
        await db_session.flush()
        for status in ("pending", "in_progress", "approved"):
            task = await create_task(db_session, project_id=project.id, status=status)
            task.batch_id = batch.id
        batches.append(batch)
    backlog = await create_task(db_session, project_id=project.id, status="rejected")
    backlog.assignee_id = users[0].id
    await db_session.flush()
    body = {"annotator_ids": [str(u.id) for u in users], "only_unassigned": True}
    url = f"/api/v1/projects/{project.id}/batches"
    preview = await httpx_client.post(
        f"{url}/distribution-preview", json=body, headers=headers
    )
    assert preview.status_code == 200, preview.text
    plan = preview.json()
    assert [row["batch_id"] for row in plan["items"]] == [
        str(uuid.UUID(int=i)) for i in (1, 2)
    ]
    assert all(row["task_count"] == 3 for row in plan["items"])
    assert [
        (r["new_task_count"], r["existing_backlog_count"])
        for r in plan["recipient_summary"]
    ] == [(2, 1), (2, 0)]
    applied = await httpx_client.post(
        f"{url}/distribution-apply",
        json={**body, "preview_version": plan["preview_version"]},
        headers=headers,
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["annotator_per_batch"] == {
        row["batch_id"]: row["after_annotator_id"] for row in plan["items"]
    }


async def test_distribution_rejects_stale_preview_without_changing_assignment(
    httpx_client, super_admin, db_session
):
    admin, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    project = await create_project(db_session, owner_id=admin.id)
    user = await create_user(db_session, "annotator", "stale-plan@e.test", "Worker")
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=user.id,
            role="annotator",
            assigned_by=admin.id,
        )
    )
    batch = TaskBatch(
        project_id=project.id, display_id="B-STALE-PLAN", name="Plan", status="draft"
    )
    db_session.add(batch)
    await db_session.flush()
    body = {"annotator_ids": [str(user.id)]}
    url = f"/api/v1/projects/{project.id}/batches"
    preview = await httpx_client.post(
        f"{url}/distribution-preview", json=body, headers=headers
    )
    assert preview.status_code == 200, preview.text
    task = await create_task(db_session, project_id=project.id)
    task.batch_id = batch.id
    await db_session.flush()
    failed = await httpx_client.post(
        f"{url}/distribution-apply",
        json={**body, "preview_version": preview.json()["preview_version"]},
        headers=headers,
    )
    assert failed.status_code == 409, failed.text
    await db_session.refresh(batch)
    assert batch.annotator_id is None
    fresh = await httpx_client.post(
        f"{url}/distribution-preview", json=body, headers=headers
    )
    assert fresh.json()["preview_version"] != preview.json()["preview_version"]


async def test_bulk_invite_failed_middle_item_does_not_break_following_or_leave_preview_rows(
    httpx_client, super_admin, db_session
):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    existing = await create_user(
        db_session, "annotator", "bulk-exists@e.test", "Existing"
    )
    body = {
        "items": [
            {"email": email, "role": "annotator"}
            for email in ("bulk-first@e.test", existing.email, "bulk-last@e.test")
        ]
    }
    for preview in (True, False):
        result = await httpx_client.post(
            "/api/v1/users/bulk-invite" + ("/preview" if preview else ""),
            json=body,
            headers=headers,
        )
        assert result.status_code == 200, result.text
        assert [item["ok"] for item in result.json()["items"]] == [True, False, True], (
            result.text
        )
        rows = (
            (
                await db_session.execute(
                    select(UserInvitation).where(
                        UserInvitation.email.in_(
                            ["bulk-first@e.test", "bulk-last@e.test"]
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == (0 if preview else 2)


async def test_management_previews_do_not_reveal_out_of_scope_users(
    httpx_client, project_admin, db_session
):
    _, token = project_admin
    headers = {"Authorization": f"Bearer {token}"}
    outside = await create_user(
        db_session, "annotator", "secret-member@e.test", "Hidden Person"
    )
    group = await httpx_client.post(
        "/api/v1/users/groups/bulk/preview",
        json={"user_ids": [str(outside.id)], "group_id": None},
        headers=headers,
    )
    assert group.status_code == 200, group.text
    item = group.json()["items"][0]
    assert item["ok"] is False
    assert item["email"] is None and item["name"] is None
    impact = await httpx_client.get(
        f"/api/v1/users/{outside.id}/role/preview?role=reviewer", headers=headers
    )
    assert impact.status_code == 404, impact.text
    assert outside.email not in impact.text and outside.name not in impact.text


async def test_role_preview_warns_about_other_projects_without_disclosing_names(
    httpx_client, project_admin, super_admin, db_session
):
    manager, token = project_admin
    admin, _ = super_admin
    user = await create_user(db_session, "annotator", "shared-role@e.test", "Shared")
    for owner, name in ((manager, "Visible"), (admin, "Private project name")):
        project = await create_project(db_session, owner_id=owner.id, name=name)
        db_session.add(
            ProjectMember(
                project_id=project.id,
                user_id=user.id,
                role="annotator",
                assigned_by=owner.id,
            )
        )
    await db_session.flush()
    result = await httpx_client.get(
        f"/api/v1/users/{user.id}/role/preview?role=reviewer",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["other_project_count"] == 1
    assert result.json()["warnings"]
    assert "Private project name" not in result.text


async def test_management_csv_treats_user_and_invitation_fields_as_literal_text(
    httpx_client, super_admin, db_session
):
    import csv
    from datetime import timedelta

    admin, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    await create_user(db_session, "annotator", "csv-injection@e.test", "=1+1")
    db_session.add(
        UserInvitation(
            email="csv-invite@e.test",
            role="annotator",
            group_name="@SUM(1,2)",
            token="csv-test-token",
            invited_by=admin.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
    )
    await db_session.flush()
    for endpoint, field, expected in (
        ("users", "name", "'=1+1"),
        ("invitations", "group_name", "'@SUM(1,2)"),
    ):
        result = await httpx_client.get(
            f"/api/v1/{endpoint}/export?format=csv&search=csv-", headers=headers
        )
        assert result.status_code == 200, result.text
        lines = [
            line
            for line in result.text.lstrip("\ufeff").splitlines()
            if not line.startswith("#")
        ]
        rows = list(csv.DictReader(lines))
        assert len(rows) == 1
        assert rows[0][field] == expected


async def test_bulk_invite_validation_reports_invalid_email_per_item(
    httpx_client, super_admin
):
    _, token = super_admin
    result = await httpx_client.post(
        "/api/v1/users/bulk-invite/preview",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "items": [
                {"email": "valid-bulk@e.test", "role": "annotator"},
                {"email": "invalid", "role": "annotator"},
                {"email": " VALID-BULK@e.test ", "role": "annotator"},
            ]
        },
    )
    assert result.status_code == 200, result.text
    assert [row["ok"] for row in result.json()["items"]] == [True, False, False]
    assert "邮箱格式不正确" in result.json()["items"][1]["error"]
    assert "重复" in result.json()["items"][2]["error"]
