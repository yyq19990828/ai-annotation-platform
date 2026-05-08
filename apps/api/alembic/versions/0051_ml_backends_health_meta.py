"""v0.9.6 · ml_backends.health_meta

把 backend `/health` 返回的 gpu_info / cache / model_version 等 v0.9.5 起就位的字段
缓存到 ml_backends 表 (jsonb 列), 让 admin overview 可一次性聚合渲染
GPU 显存 / cache hit rate / model_version 行内副信息.

- health_meta JSONB NULL: 由 services/ml_backend.check_health 写入;
  schema 示例: {gpu_info: {device_name, memory_used_mb, memory_total_mb, memory_free_mb},
               cache: {hit_rate, ...}, model_version: str}.

Revision ID: 0051
Revises: 0050
Create Date: 2026-05-08
"""

from alembic import op


revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE ml_backends "
        "ADD COLUMN IF NOT EXISTS health_meta JSONB NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE ml_backends DROP COLUMN IF EXISTS health_meta")
