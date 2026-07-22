from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0143_mask_annotation_revisions.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0143", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sql_calls(op: MagicMock) -> str:
    return "\n".join(str(call.args[0]) for call in op.execute.call_args_list)


def test_migration_creates_frozen_revision_contract_and_authoritative_trigger():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    table_call = migration.op.create_table.call_args_list[0]
    assert table_call.args[0] == "mask_annotation_revisions"
    columns = {item.name for item in table_call.args[1:] if hasattr(item, "name")}
    assert columns >= {
        "id",
        "project_id",
        "task_id",
        "annotation_id",
        "annotation_version",
        "geometry",
        "geometry_digest",
        "source_kind",
        "operation_id",
        "actor_id",
        "created_at",
        "expires_at",
    }
    migration.op.create_index.assert_any_call(
        "ix_mask_annotation_revisions_expires_at",
        "mask_annotation_revisions",
        ["expires_at"],
    )

    sql = _sql_calls(migration.op)
    assert "BEFORE INSERT OR UPDATE OR DELETE ON annotations" in sql
    assert "NEW.version := OLD.version + 1" in sql
    assert "OLD.geometry" in sql
    assert "'raster_mask', 'video_track_mask'" in sql
    assert "ON CONFLICT (annotation_id, annotation_version) DO NOTHING" in sql
    assert "ranked.position > 20" in sql
    assert "interval '30 days'" in sql
    assert "source_kind, expires_at" in sql
    assert "annotation.source" in sql
    assert "revision snapshots are immutable" in sql


def test_migration_downgrade_removes_trigger_functions_before_table():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    sql = _sql_calls(migration.op)
    assert "trg_capture_mask_annotation_revision" in sql
    assert "capture_mask_annotation_revision()" in sql
    assert "record_mask_annotation_revision" in sql
    migration.op.drop_table.assert_called_once_with("mask_annotation_revisions")
