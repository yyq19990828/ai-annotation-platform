from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0148_enable_raster_mask_native_editing.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0148", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_enables_existing_projects_and_changes_default():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    args, kwargs = migration.op.alter_column.call_args
    assert args == ("projects", "raster_mask_native_editing_enabled")
    assert str(kwargs["server_default"]) == "true"
    statement = str(migration.op.execute.call_args.args[0])
    assert "SET raster_mask_native_editing_enabled = true" in statement
    assert "WHERE raster_mask_native_editing_enabled = false" in statement


def test_downgrade_restores_default_without_rewriting_project_choices():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    args, kwargs = migration.op.alter_column.call_args
    assert args == ("projects", "raster_mask_native_editing_enabled")
    assert str(kwargs["server_default"]) == "false"
    migration.op.execute.assert_not_called()
