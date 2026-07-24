from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0150_video_single_frame_mask_revisions.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0150", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_adds_video_mask_to_revision_trigger():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.upgrade()

    sql = str(migration.op.execute.call_args.args[0])
    assert "'raster_mask', 'video_mask', 'video_track_mask'" in sql
    assert "CREATE OR REPLACE FUNCTION capture_mask_annotation_revision()" in sql


def test_downgrade_restores_previous_mask_types():
    migration = _load_migration()
    migration.op = MagicMock()

    migration.downgrade()

    sql = str(migration.op.execute.call_args.args[0])
    assert "'raster_mask', 'video_track_mask'" in sql
    assert "'video_mask'" not in sql
