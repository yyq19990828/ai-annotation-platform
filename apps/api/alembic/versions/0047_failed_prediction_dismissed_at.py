"""v0.8.8 · failed_predictions.dismissed_at

admin 在 /admin/failed-predictions 列表上"永久放弃"无救的失败预测，
不再让该行参与重试列表。soft-delete 而非物理删除：保留审计 + 可恢复。

- dismissed_at TIMESTAMPTZ NULL
- ix_failed_predictions_dismissed_at（部分索引：仅 dismissed_at IS NOT NULL）
  支持「显示已放弃」筛选时快速过滤。

Revision ID: 0047
Revises: 0046
Create Date: 2026-05-07
"""

from alembic import op


revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE failed_predictions ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_failed_predictions_dismissed_at "
        "ON failed_predictions (dismissed_at) "
        "WHERE dismissed_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_failed_predictions_dismissed_at")
    op.execute("ALTER TABLE failed_predictions DROP COLUMN IF EXISTS dismissed_at")
