from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, call


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0146_mask_repair_batches.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0146", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_creates_repair_receipt_execution_and_rollback_ledger():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    assert migration.op.drop_constraint.call_args_list == [
        call(
            "ck_annotation_operations_kind",
            "annotation_operations",
            type_="check",
        ),
        call(
            "ck_annotation_lineage_relation",
            "annotation_lineage_edges",
            type_="check",
        ),
    ]
    operation_sql = migration.op.create_check_constraint.call_args_list[0].args[2]
    lineage_sql = migration.op.create_check_constraint.call_args_list[1].args[2]
    assert "delete_small_islands" in operation_sql
    assert "mask_repair_rollback" in operation_sql
    assert "mask_repaired" in lineage_sql
    assert "mask_repair_rolled_back" in lineage_sql
    table_call = migration.op.create_table.call_args
    assert table_call.args[0] == "mask_repair_batches"
    columns = {item.name for item in table_call.args[1:] if hasattr(item, "name")}
    assert columns >= {
        "id",
        "project_id",
        "requested_by_id",
        "async_job_id",
        "rollback_async_job_id",
        "token_hash",
        "status",
        "plan_digest",
        "request_json",
        "plan_json",
        "result_json",
        "receipt_expires_at",
        "rollback_expires_at",
        "completed_at",
        "rolled_back_at",
    }
    migration.op.create_index.assert_any_call(
        "ix_mask_repair_batches_token_hash",
        "mask_repair_batches",
        ["token_hash"],
        unique=True,
    )


def test_migration_downgrade_removes_repair_ledger():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    migration.op.drop_table.assert_called_once_with("mask_repair_batches")
    assert migration.op.execute.call_count == 2
    lineage_sql = migration.op.create_check_constraint.call_args_list[0].args[2]
    operation_sql = migration.op.create_check_constraint.call_args_list[1].args[2]
    assert "mask_repaired" not in lineage_sql
    assert "delete_small_islands" not in operation_sql
