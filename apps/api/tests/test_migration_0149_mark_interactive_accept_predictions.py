from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0149_mark_interactive_accept_predictions.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0149", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_marks_only_mask_accept_lineage_as_interactive_accept():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    statement = str(migration.op.execute.call_args.args[0])
    assert "SET source = 'interactive_accept'" in statement
    assert "pm.extra ? 'mask_ai_accept'" in statement
    assert "p.source = 'ml_backend'" in statement


def test_downgrade_restores_interactive_accept_source():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    statement = str(migration.op.execute.call_args.args[0])
    assert "SET source = 'ml_backend'" in statement
    assert "WHERE source = 'interactive_accept'" in statement
