from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import Mock, call


def _load_migration_0121():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0121_video_tracker_optional_source.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0121", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_downgrade_removes_jobs_that_old_schema_cannot_represent() -> None:
    migration = _load_migration_0121()
    migration.op = Mock()

    migration.downgrade()

    assert migration.op.method_calls[0] == call.execute(
        "DELETE FROM video_tracker_jobs WHERE annotation_id IS NULL"
    )
    migration.op.alter_column.assert_called_once()
    args, kwargs = migration.op.alter_column.call_args
    assert args == ("video_tracker_jobs", "annotation_id")
    assert isinstance(kwargs["existing_type"], migration.postgresql.UUID)
    assert kwargs["existing_type"].as_uuid is True
    assert kwargs["nullable"] is False
