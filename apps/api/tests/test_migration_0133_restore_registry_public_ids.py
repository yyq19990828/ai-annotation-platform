"""Corrective migration 0133 keeps public JSON contracts on registry IDs."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0133_restore_registry_public_ids.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0133", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _sql(module) -> str:
    return "\n".join(call.args[0] for call in module.op.execute.call_args_list)


def test_upgrade_restores_every_registry_id_public_contract() -> None:
    migration = _load_migration()
    migration.op = MagicMock()
    migration.upgrade()

    sql = _sql(migration)
    assert "ml_backend_pool_id" in sql and "ml_backend_id" in sql
    assert "projects p SET default_variants" in sql
    assert "params_by_backend" in sql
    assert "model_by_backend" in sql
    assert "interactive_backend_by_project" in sql
    assert "secondary_by_model" in sql
    assert "m.registry_id" in sql


def test_upgrade_does_not_rewrite_pool_local_defaults_or_lineage() -> None:
    migration = _load_migration()
    migration.op = MagicMock()
    migration.upgrade()

    sql = _sql(migration)
    assert "project_ml_backend_pool pmb SET default_variants" not in sql
    assert "async_jobs" not in sql
    assert "predictions" not in sql


def test_secondary_model_key_preserves_suffix_after_first_colon() -> None:
    migration = _load_migration()
    migration.op = MagicMock()
    migration.upgrade()

    sql = _sql(migration)
    assert "substring(kv.key FROM strpos(kv.key, ':'))" in sql
    assert "split_part(kv.key, ':', 2)" not in sql


def test_partial_repair_prefers_existing_registry_key_on_collision() -> None:
    migration = _load_migration()
    migration.op = MagicMock()
    migration.upgrade()

    sql = _sql(migration)
    assert "(m.pool_id IS NULL) DESC" in sql
