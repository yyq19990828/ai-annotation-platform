from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0140_annotation_mask_operations.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0140", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_creates_operation_and_lineage_schema():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    assert [call.args[0] for call in migration.op.create_table.call_args_list] == [
        "annotation_operations",
        "annotation_lineage_edges",
    ]
    operation_names = {
        item.name
        for item in migration.op.create_table.call_args_list[0].args[1:]
        if getattr(item, "name", None)
    }
    lineage_names = {
        item.name
        for item in migration.op.create_table.call_args_list[1].args[1:]
        if getattr(item, "name", None)
    }
    assert "uq_annotation_operations_task_actor_key" in operation_names
    assert "ck_annotation_operations_kind" in operation_names
    assert "ck_annotation_lineage_has_endpoint" in lineage_names
    assert "ck_annotation_lineage_relation" in lineage_names


def test_downgrade_removes_lineage_before_operation_ledger():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    assert [call.args[0] for call in migration.op.drop_table.call_args_list] == [
        "annotation_lineage_edges",
        "annotation_operations",
    ]
