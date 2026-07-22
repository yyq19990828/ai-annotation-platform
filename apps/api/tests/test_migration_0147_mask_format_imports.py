from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0147_mask_format_imports.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0147", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_creates_staged_import_receipt_and_resume_ledger() -> None:
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    table_call = migration.op.create_table.call_args
    assert table_call.args[0] == "mask_format_imports"
    columns = {item.name for item in table_call.args[1:] if hasattr(item, "name")}
    assert columns >= {
        "id",
        "project_id",
        "requested_by_id",
        "async_job_id",
        "format_id",
        "adapter_version",
        "manifest_version",
        "staged_object_key",
        "staged_sha256",
        "mapping_digest",
        "options_digest",
        "plan_json",
        "plan_digest",
        "token_hash",
        "receipt_expires_at",
        "status",
        "result_json",
    }
    migration.op.create_index.assert_any_call(
        "ix_mask_format_imports_project_status",
        "mask_format_imports",
        ["project_id", "status"],
    )


def test_migration_downgrade_removes_staged_import_ledger() -> None:
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    migration.op.drop_table.assert_called_once_with("mask_format_imports")
