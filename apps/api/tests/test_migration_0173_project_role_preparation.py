"""Verify the 0173 additive preparation migration on a disposable database.

The migration must be additive and default-safe: legacy binaries keep reading
and writing the tables, existing rows survive a downgrade/upgrade round trip,
and historical unknowns stay NULL.  No role values are converted here.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.user_invitation import UserInvitation
from tests.factory import create_project, create_task, create_user

_PREPARATION_COLUMNS = {
    "project_members": {"version", "updated_at"},
    "user_invitations": {"project_role"},
    "tasks": {
        "annotation_contributor_ids",
        "review_contributor_ids",
        "review_submitter_id",
    },
}


def test_0173_is_additive_default_safe_and_round_trips(test_db_url, apply_migrations):
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", test_db_url)
    saved: dict = {}

    async def step(action: str) -> None:
        engine = create_async_engine(test_db_url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                if action == "seed":
                    owner = await create_user(
                        db,
                        "project_admin",
                        f"migration-owner-{uuid.uuid4()}@test.local",
                        "Owner",
                    )
                    saved["owner"] = owner.id
                    legacy_user = await create_user(
                        db,
                        "annotator",
                        f"migration-legacy-{uuid.uuid4()}@test.local",
                        "Legacy",
                    )
                    saved["legacy_user"] = legacy_user.id
                    project = await create_project(db, owner_id=owner.id)
                    saved["project"] = project.id
                    member = ProjectMember(
                        project_id=project.id,
                        user_id=owner.id,
                        role="viewer",
                        assigned_by=owner.id,
                    )
                    db.add(member)
                    await db.flush()
                    saved["member"] = member.id
                    task = await create_task(db, project_id=project.id, status="review")
                    task.review_round_id = uuid.uuid4()
                    await db.flush()
                    saved["task"] = task.id
                    invitation = UserInvitation(
                        email=f"migration-invite-{uuid.uuid4()}@test.local",
                        role="annotator",
                        project_id=project.id,
                        project_role=None,
                        token=uuid.uuid4().hex,
                        expires_at=datetime.now(timezone.utc) + timedelta(days=3),
                        invited_by=owner.id,
                    )
                    db.add(invitation)
                    await db.flush()
                    saved["invitation"] = invitation.id
                    await db.commit()
                elif action == "assert_downgraded":
                    for table, columns in _PREPARATION_COLUMNS.items():
                        rows = await db.execute(
                            text(
                                "SELECT column_name FROM information_schema.columns "
                                "WHERE table_name = :table AND column_name = ANY(:columns)"
                            ),
                            {"table": table, "columns": list(columns)},
                        )
                        assert rows.scalars().all() == [], (
                            f"{table} still has preparation columns after downgrade"
                        )
                    count = await db.scalar(
                        text("SELECT count(*) FROM project_members WHERE id = :id"),
                        {"id": saved["member"]},
                    )
                    assert count == 1
                elif action == "verify":
                    member = await db.scalar(
                        select(ProjectMember).where(ProjectMember.id == saved["member"])
                    )
                    assert member is not None
                    assert member.version == 1
                    assert member.updated_at is not None

                    task = await db.scalar(select(Task).where(Task.id == saved["task"]))
                    assert task is not None
                    assert task.review_round_id is not None
                    # Downgrade removed the evidence columns; re-upgrade must
                    # leave these historical rows unknown, not known-empty.
                    assert task.annotation_contributor_ids is None
                    assert task.review_contributor_ids is None
                    assert task.review_submitter_id is None
                    task_column_default = await db.scalar(
                        text(
                            "SELECT column_default FROM information_schema.columns "
                            "WHERE table_name = 'tasks' "
                            "AND column_name = 'annotation_contributor_ids'"
                        )
                    )
                    assert task_column_default is None

                    invitation = await db.scalar(
                        select(UserInvitation).where(
                            UserInvitation.id == saved["invitation"]
                        )
                    )
                    assert invitation is not None
                    assert invitation.project_id == saved["project"]
                    # Re-upgrading to head also runs the later 0174 conversion,
                    # which backfills the pending project invitation's project
                    # role and normalises its platform role to employee.
                    assert invitation.project_role == "annotator"
                    assert invitation.role == "employee"

                    # Legacy writer: an INSERT that omits the new columns must
                    # still succeed, with the server defaults applied.
                    legacy_member_id = uuid.uuid4()
                    await db.execute(
                        text(
                            "INSERT INTO project_members "
                            "(id, project_id, user_id, role, assigned_by) "
                            "VALUES (:id, :project_id, :user_id, 'annotator', :assigned_by)"
                        ),
                        {
                            "id": legacy_member_id,
                            "project_id": saved["project"],
                            "user_id": saved["legacy_user"],
                            "assigned_by": saved["owner"],
                        },
                    )
                    version, updated_at = (
                        await db.execute(
                            text(
                                "SELECT version, updated_at FROM project_members "
                                "WHERE id = :id"
                            ),
                            {"id": legacy_member_id},
                        )
                    ).one()
                    assert version == 1
                    assert updated_at is not None
                    saved["legacy_member"] = legacy_member_id

                    constraint = await db.scalar(
                        text(
                            "SELECT count(*) FROM pg_constraint "
                            "WHERE conname = 'fk_tasks_review_submitter_id_users'"
                        )
                    )
                    assert constraint == 1
                    await db.commit()
                else:
                    if "task" in saved:
                        await db.execute(
                            text("DELETE FROM tasks WHERE id = :id"),
                            {"id": saved["task"]},
                        )
                    if "invitation" in saved:
                        await db.execute(
                            text("DELETE FROM user_invitations WHERE id = :id"),
                            {"id": saved["invitation"]},
                        )
                    if "project" in saved:
                        await db.execute(
                            text("DELETE FROM project_members WHERE project_id = :id"),
                            {"id": saved["project"]},
                        )
                        await db.execute(
                            text("DELETE FROM projects WHERE id = :id"),
                            {"id": saved["project"]},
                        )
                    user_ids = [
                        saved[key] for key in ("owner", "legacy_user") if key in saved
                    ]
                    if user_ids:
                        await db.execute(
                            text("DELETE FROM users WHERE id = ANY(:ids)"),
                            {"ids": user_ids},
                        )
                    await db.commit()
        finally:
            await engine.dispose()

    # Downgrading below 0173 crosses the gated 0174 conversion; this isolated
    # test database is explicitly allowed to run the lossy reverse.
    gate_env = "AAP_ALLOW_ROLE_MIGRATION_DOWNGRADE"
    previous_gate = os.environ.get(gate_env)
    os.environ[gate_env] = "1"
    try:
        asyncio.run(step("seed"))
        command.downgrade(config, "0172")
        asyncio.run(step("assert_downgraded"))
        command.upgrade(config, "head")
        asyncio.run(step("verify"))
    finally:
        if previous_gate is None:
            os.environ.pop(gate_env, None)
        else:
            os.environ[gate_env] = previous_gate
        # Restore the current schema even if an assertion or upgrade failed.
        command.upgrade(config, "head")
        asyncio.run(step("cleanup"))
