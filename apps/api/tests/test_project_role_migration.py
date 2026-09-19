"""Verify the 0174 role-conversion migration and its rollback gate.

Runs on the disposable worktree test database: seeds legacy global roles and
pending/historical invitations, re-runs 0174, and asserts the deterministic
conversion.  The ungated downgrade must be rejected because the cutover is not
losslessly reversible.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.models.user import User
from app.db.models.user_invitation import UserInvitation

_GATE_ENV = "AAP_ALLOW_ROLE_MIGRATION_DOWNGRADE"


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


def test_0174_converts_and_preserves_history(test_db_url, apply_migrations):
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", test_db_url)
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
                    db.add_all([pending, accepted, account_only])
                    await db.flush()
                    saved.update(
                        pending=pending.id,
                        accepted=accepted.id,
                        account_only=account_only.id,
                    )
                    await db.commit()
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
                        for key in ("pending", "accepted", "account_only")
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

    # An ungated downgrade must be rejected before it runs.
    os.environ.pop(_GATE_ENV, None)
    with pytest.raises(RuntimeError):
        command.downgrade(config, "0173")

    try:
        asyncio.run(step("seed"))
        os.environ[_GATE_ENV] = "1"
        command.downgrade(config, "0173")
        command.upgrade(config, "head")
        asyncio.run(step("verify"))
    finally:
        os.environ.pop(_GATE_ENV, None)
        command.upgrade(config, "head")
        asyncio.run(step("cleanup"))
