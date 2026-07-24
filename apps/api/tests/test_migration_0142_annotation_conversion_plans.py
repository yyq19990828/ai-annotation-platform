from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, call


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0142_annotation_conversion_plans.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0142", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_adds_plan_table_and_conversion_constraints():
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
    assert "convert_annotations" in operation_sql
    assert "converted" in lineage_sql
    assert migration.op.create_table.call_args.args[0] == "annotation_conversion_plans"


def test_downgrade_drops_plan_table_and_restores_previous_constraints():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    migration.op.drop_table.assert_called_once_with("annotation_conversion_plans")
    assert migration.op.execute.call_count == 2
    lineage_sql = migration.op.create_check_constraint.call_args_list[0].args[2]
    operation_sql = migration.op.create_check_constraint.call_args_list[1].args[2]
    assert "converted" not in lineage_sql
    assert "convert_annotations" not in operation_sql
