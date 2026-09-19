"""Verify the 0174 conversion migration and its non-reversible recovery policy.

The downgrade must always refuse: the employee cutover cannot be losslessly
mapped back to one global role.  The conversion itself is idempotent, so the
test seeds legacy rows at head and re-runs the migration's ``upgrade`` on a
real connection, then asserts deterministic conversion with preserved history.
"""

from __future__ import annotations

import asyncio
import importlib.util
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.models.user import User
from app.db.models.user_invitation import UserInvitation

_API_ROOT = Path(__file__).resolve().parents[1]
_MIGRATION_PATH = _API_ROOT / "alembic" / "versions" / "0174_project_role_conversion.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0174", _MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _user(email: str, role: str, *, active: bool) -> User:
    return User(
        email=email,
        name=email.split("@")[0],
        password_hash="x",
        role=role,
        is_active=active,
    )


def _invitation(
    *, email: str, role: str, invited_by, project_id=None, accepted_at=None
) -> UserInvitation:
    return UserInvitation(
        email=email,
        role=role,
        project_id=project_id,
        project_role=None,
        token=uuid.uuid4().hex,
        expires_at=datetime.now(timezone.utc) + timedelta(days=3),
        invited_by=invited_by,
        accepted_at=accepted_at,
    )


def test_0174_converts_and_downgrade_refuses(test_db_url, apply_migrations):
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", test_db_url)
    migration = _load_migration()
    saved: dict = {}

    async def step(action: str) -> None:
        engine = create_async_engine(test_db_url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                if action == "seed":
                    owner = _user(
                        f"0174-owner-{uuid.uuid4()}@test.local",
                        "project_admin",
                        active=True,
                    )
                    active_anno = _user(
                        f"0174-anno-{uuid.uuid4()}@test.local", "annotator", active=True
                    )
                    inactive_rev = _user(
                        f"0174-rev-{uuid.uuid4()}@test.local", "reviewer", active=False
                    )
                    db.add_all([owner, active_anno, inactive_rev])
                    await db.flush()
                    saved.update(
                        owner=owner.id, anno=active_anno.id, rev=inactive_rev.id
                    )

                    pending = _invitation(
                        email=f"0174-pending-{uuid.uuid4()}@test.local",
                        role="annotator",
                        invited_by=owner.id,
                        project_id=uuid.uuid4(),
                    )
                    # Already populated project_role must be preserved.
                    populated = _invitation(
                        email=f"0174-populated-{uuid.uuid4()}@test.local",
                        role="reviewer",
                        invited_by=owner.id,
                        project_id=uuid.uuid4(),
                    )
                    populated.project_role = "annotator"
                    accepted = _invitation(
                        email=f"0174-accepted-{uuid.uuid4()}@test.local",
                        role="annotator",
                        invited_by=owner.id,
                        project_id=uuid.uuid4(),
                        accepted_at=datetime.now(timezone.utc),
                    )
                    accepted.accepted_user_id = active_anno.id
                    account_only = _invitation(
                        email=f"0174-account-{uuid.uuid4()}@test.local",
                        role="reviewer",
                        invited_by=owner.id,
                    )
                    db.add_all([pending, populated, accepted, account_only])
                    await db.flush()
                    saved.update(
                        pending=pending.id,
                        populated=populated.id,
                        accepted=accepted.id,
                        account_only=account_only.id,
                    )
                    await db.commit()
                elif action == "convert":
                    # Re-run the migration's conversion on a fresh connection.
                    async with engine.begin() as conn:
                        await conn.run_sync(_apply_upgrade, migration)
                elif action == "verify":
                    for key in ("anno", "rev"):
                        user = await db.scalar(
                            select(User).where(User.id == saved[key])
                        )
                        assert user is not None
                        assert user.role == "employee", f"{key} was not converted"
                    inactive = await db.scalar(
                        select(User).where(User.id == saved["rev"])
                    )
                    assert inactive.is_active is False

                    pending = await db.scalar(
                        select(UserInvitation).where(
                            UserInvitation.id == saved["pending"]
                        )
                    )
                    assert pending.project_role == "annotator"
                    assert pending.role == "employee"

                    populated = await db.scalar(
                        select(UserInvitation).where(
                            UserInvitation.id == saved["populated"]
                        )
                    )
                    assert populated.project_role == "annotator"
                    assert populated.role == "employee"

                    # Accepted / historical invitations are not rewritten.
                    accepted = await db.scalar(
                        select(UserInvitation).where(
                            UserInvitation.id == saved["accepted"]
                        )
                    )
                    assert accepted.project_role is None
                    assert accepted.role == "annotator"

                    account_only = await db.scalar(
                        select(UserInvitation).where(
                            UserInvitation.id == saved["account_only"]
                        )
                    )
                    assert account_only.role == "employee"
                    assert account_only.project_role is None
                    await db.commit()
                else:
                    invitation_ids = [
                        saved[key]
                        for key in ("pending", "populated", "accepted", "account_only")
                        if key in saved
                    ]
                    if invitation_ids:
                        await db.execute(
                            text("DELETE FROM user_invitations WHERE id = ANY(:ids)"),
                            {"ids": invitation_ids},
                        )
                    user_ids = [
                        saved[key] for key in ("owner", "anno", "rev") if key in saved
                    ]
                    if user_ids:
                        await db.execute(
                            text("DELETE FROM users WHERE id = ANY(:ids)"),
                            {"ids": user_ids},
                        )
                    await db.commit()
        finally:
            await engine.dispose()

    # Post-opening recovery must refuse the destructive downgrade.
    with pytest.raises(RuntimeError):
        command.downgrade(config, "0173")

    try:
        asyncio.run(step("seed"))
        asyncio.run(step("convert"))
        asyncio.run(step("verify"))
    finally:
        command.upgrade(config, "head")
        asyncio.run(step("cleanup"))


def _apply_upgrade(sync_conn, migration) -> None:
    context = MigrationContext.configure(sync_conn)
    with Operations.context(context):
        migration.upgrade()
