from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0152_repair_invitation_user_groups.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0152", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_repairs_only_name_only_group_memberships() -> None:
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    statements = [str(call.args[0]) for call in migration.op.execute.call_args_list]
    assert len(statements) == 4
    assert "UPDATE user_invitations" in statements[0]
    assert "expires_at = now()" in statements[0]
    assert "AND NOT EXISTS" in statements[0]
    assert "inviter.role = 'super_admin'" in statements[0]
    assert "inviter.is_active IS TRUE" in statements[0]
    assert "invitation.role IN ('super_admin', 'project_admin')" in statements[0]
    assert "SET group_name = NULL" in statements[1]
    assert "WHERE group_id IS NULL" in statements[1]
    assert "[[:space:]]" in statements[1]
    assert "INSERT INTO groups" in statements[2]
    assert "ON CONFLICT (name) DO NOTHING" in statements[2]
    assert "SET group_id = g.id" in statements[3]
    assert "u.group_id IS NULL" in statements[3]
    assert "g.name = REGEXP_REPLACE" in statements[3]


def test_downgrade_keeps_repaired_memberships() -> None:
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    migration.op.execute.assert_not_called()
