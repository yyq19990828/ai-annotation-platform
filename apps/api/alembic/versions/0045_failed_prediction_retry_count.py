"""v0.8.6 F6 · failed_predictions 重试相关字段

- retry_count INT NOT NULL DEFAULT 0
- last_retry_at TIMESTAMPTZ NULL
- extra JSONB NOT NULL DEFAULT '{}'

软上限 max=3，由 service 层判断；超过 3 返回 409。

Revision ID: 0045
Revises: 0044
Create Date: 2026-05-07
"""

from alembic import op


revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE failed_predictions "
        "ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE failed_predictions "
        "ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE failed_predictions "
        "ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE failed_predictions DROP COLUMN IF EXISTS extra")
    op.execute("ALTER TABLE failed_predictions DROP COLUMN IF EXISTS last_retry_at")
    op.execute("ALTER TABLE failed_predictions DROP COLUMN IF EXISTS retry_count")
