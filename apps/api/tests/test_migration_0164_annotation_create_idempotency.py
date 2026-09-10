from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0164_annotation_create_idempotency.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0164", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_adds_create_annotation_kind():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    migration.op.drop_constraint.assert_called_once_with(
        "ck_annotation_operations_kind", "annotation_operations", type_="check"
    )
    check_sql = migration.op.create_check_constraint.call_args.args[2]
    assert "create_annotation" in check_sql


def test_downgrade_refuses_to_drop_used_create_receipts():
    migration = _load_migration()
    migration.op = MagicMock()
    connection = migration.op.get_bind.return_value
    connection.scalar.return_value = True

    try:
        migration.downgrade()
    except RuntimeError as exc:
        assert "idempotency receipts exist" in str(exc)
    else:
        raise AssertionError("downgrade should preserve used create receipts")

    connection.execute.assert_called_once()
    assert migration.op.drop_constraint.call_count == 0
