from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, call


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0141_extend_mask_operation_kinds.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0141", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_extends_operation_and_lineage_constraints():
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
    assert "copy_keyframe" in operation_sql
    assert "keyframe_copied" in lineage_sql


def test_downgrade_restores_previous_constraints():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    assert migration.op.execute.call_count == 2
    lineage_sql = migration.op.create_check_constraint.call_args_list[0].args[2]
    operation_sql = migration.op.create_check_constraint.call_args_list[1].args[2]
    assert "keyframe_copied" not in lineage_sql
    assert "copy_keyframe" not in operation_sql
