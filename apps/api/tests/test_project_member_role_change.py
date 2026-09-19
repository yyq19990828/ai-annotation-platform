"""Member add / role-change (preview + CAS + handoff) / removal over PostgreSQL."""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.user import User
from tests.factory import create_project, create_task, create_user

pytestmark = pytest.mark.asyncio


def _headers(user: User) -> dict[str, str]:
    token = create_access_token(subject=str(user.id), role=user.role)
    return {"Authorization": f"Bearer {token}"}


async def _add_member(
    db: AsyncSession, *, project_id, user: User, role: str, assigned_by
) -> ProjectMember:
    member = ProjectMember(
        project_id=project_id,
        user_id=user.id,
        role=role,
        assigned_by=assigned_by,
    )
    db.add(member)
    await db.flush()
    return member


async def _preview(
    client: httpx.AsyncClient,
    project_id,
    member_id,
    owner: User,
    target_role: str,
    **extra,
):
    body = {"project_role": target_role, **extra}
    return await client.post(
        f"/api/v1/projects/{project_id}/members/{member_id}/role/preview",
        json=body,
        headers=_headers(owner),
    )


async def test_role_change_happy_path_and_cas(
    httpx_client: httpx.AsyncClient, project_admin, db_session: AsyncSession
):
    owner, _ = project_admin
    project = await create_project(db_session, owner_id=owner.id, name="Role QA")
    employee = await create_user(
        db_session, "employee", f"rc-{uuid.uuid4()}@test.local", "Member"
    )
    member = await _add_member(
        db_session,
        project_id=project.id,
        user=employee,
        role="annotator",
        assigned_by=owner.id,
    )

    preview = await _preview(httpx_client, project.id, member.id, owner, "reviewer")
    assert preview.status_code == 200, preview.text
    payload = preview.json()
    assert payload["blockers"] == []
    assert payload["current_version"] == 1
    token = payload["preview_token"]

    changed = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/members/{member.id}/role",
        json={
            "project_role": "reviewer",
            "expected_version": 1,
            "preview_token": token,
            "reason": "rotation",
        },
        headers=_headers(owner),
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["role"] == "reviewer"
    assert changed.json()["version"] == 2

    # Same version cannot be applied twice.
    replay = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/members/{member.id}/role",
        json={
            "project_role": "reviewer",
            "expected_version": 1,
            "preview_token": token,
            "reason": "rotation",
        },
        headers=_headers(owner),
    )
    assert replay.status_code == 409, replay.text


async def test_stale_preview_token_conflicts(
    httpx_client: httpx.AsyncClient, project_admin, db_session: AsyncSession
):
    owner, _ = project_admin
    project = await create_project(db_session, owner_id=owner.id, name="Stale QA")
    employee = await create_user(
        db_session, "employee", f"stale-{uuid.uuid4()}@test.local", "Member"
    )
    member = await _add_member(
        db_session,
        project_id=project.id,
        user=employee,
        role="annotator",
        assigned_by=owner.id,
    )

    preview = await _preview(httpx_client, project.id, member.id, owner, "reviewer")
    assert preview.status_code == 200, preview.text
    token = preview.json()["preview_token"]

    # A new assignment invalidates the previewed resource snapshot.
    task = await create_task(db_session, project_id=project.id, status="in_progress")
    task.assignee_id = employee.id
    await db_session.flush()

    changed = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/members/{member.id}/role",
        json={
            "project_role": "reviewer",
            "expected_version": 1,
            "preview_token": token,
            "reason": "rotation",
        },
        headers=_headers(owner),
    )
    assert changed.status_code == 409, changed.text
    assert changed.json()["detail"]["reason"] == "stale_resource_snapshot"


async def test_unfinished_annotation_work_requires_and_applies_handoff(
    httpx_client: httpx.AsyncClient, project_admin, db_session: AsyncSession
):
    owner, _ = project_admin
    project = await create_project(db_session, owner_id=owner.id, name="Handoff QA")
    member_user = await create_user(
        db_session, "employee", f"hand-{uuid.uuid4()}@test.local", "Member"
    )
    receiver = await create_user(
        db_session, "employee", f"recv-{uuid.uuid4()}@test.local", "Receiver"
    )
    member = await _add_member(
        db_session,
        project_id=project.id,
        user=member_user,
        role="annotator",
        assigned_by=owner.id,
    )
    await _add_member(
        db_session,
        project_id=project.id,
        user=receiver,
        role="annotator",
        assigned_by=owner.id,
    )
    task = await create_task(db_session, project_id=project.id, status="in_progress")
    task.assignee_id = member_user.id
    await db_session.flush()

    blocked = await _preview(httpx_client, project.id, member.id, owner, "reviewer")
    assert blocked.status_code == 200, blocked.text
    assert "unfinished_annotation_work" in blocked.json()["blockers"]
    assert blocked.json()["requires_handoff"] is True

    no_handoff = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/members/{member.id}/role",
        json={
            "project_role": "reviewer",
            "expected_version": 1,
            "preview_token": blocked.json()["preview_token"],
            "reason": "rotation",
        },
        headers=_headers(owner),
    )
    assert no_handoff.status_code == 409, no_handoff.text

    handed = await _preview(
        httpx_client,
        project.id,
        member.id,
        owner,
        "reviewer",
        replacement_annotator_id=str(receiver.id),
    )
    assert handed.status_code == 200, handed.text
    assert handed.json()["blockers"] == []

    changed = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/members/{member.id}/role",
        json={
            "project_role": "reviewer",
            "expected_version": 1,
            "preview_token": handed.json()["preview_token"],
            "reason": "rotation",
            "replacement_annotator_id": str(receiver.id),
        },
        headers=_headers(owner),
    )
    assert changed.status_code == 200, changed.text

    refreshed = await db_session.scalar(select(Task).where(Task.id == task.id))
    assert refreshed is not None
    assert refreshed.assignee_id == receiver.id


async def test_add_member_platform_project_role_compatibility(
    httpx_client: httpx.AsyncClient, project_admin, db_session: AsyncSession
):
    owner, _ = project_admin
    project = await create_project(db_session, owner_id=owner.id, name="Add QA")
    viewer = await create_user(
        db_session, "viewer", f"add-view-{uuid.uuid4()}@test.local", "View"
    )
    employee = await create_user(
        db_session, "employee", f"add-emp-{uuid.uuid4()}@test.local", "Emp"
    )

    incompatible = await httpx_client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(viewer.id), "role": "annotator"},
        headers=_headers(owner),
    )
    assert incompatible.status_code == 400, incompatible.text

    viewer_ok = await httpx_client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(viewer.id), "role": "viewer"},
        headers=_headers(owner),
    )
    assert viewer_ok.status_code == 201, viewer_ok.text
    assert viewer_ok.json()["platform_role"] == "viewer"

    employee_ok = await httpx_client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(employee.id), "role": "reviewer"},
        headers=_headers(owner),
    )
    assert employee_ok.status_code == 201, employee_ok.text
    assert employee_ok.json()["role"] == "reviewer"
    assert employee_ok.json()["platform_role"] == "employee"

    duplicate = await httpx_client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(employee.id), "role": "reviewer"},
        headers=_headers(owner),
    )
    assert duplicate.status_code == 409, duplicate.text


async def test_remove_idle_member_and_block_member_with_work(
    httpx_client: httpx.AsyncClient, project_admin, db_session: AsyncSession
):
    owner, _ = project_admin
    project = await create_project(db_session, owner_id=owner.id, name="Remove QA")
    idle_user = await create_user(
        db_session, "employee", f"rm-idle-{uuid.uuid4()}@test.local", "Idle"
    )
    busy_user = await create_user(
        db_session, "employee", f"rm-busy-{uuid.uuid4()}@test.local", "Busy"
    )
    idle = await _add_member(
        db_session,
        project_id=project.id,
        user=idle_user,
        role="viewer",
        assigned_by=owner.id,
    )
    busy = await _add_member(
        db_session,
        project_id=project.id,
        user=busy_user,
        role="annotator",
        assigned_by=owner.id,
    )
    task = await create_task(db_session, project_id=project.id, status="in_progress")
    task.assignee_id = busy_user.id
    await db_session.flush()

    removed = await httpx_client.delete(
        f"/api/v1/projects/{project.id}/members/{idle.id}",
        headers=_headers(owner),
    )
    assert removed.status_code == 204, removed.text

    blocked = await httpx_client.delete(
        f"/api/v1/projects/{project.id}/members/{busy.id}",
        headers=_headers(owner),
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["reason"] == "member_removal_blocked"
