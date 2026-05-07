"""v0.8.6 F2 · ml_backends.last_checked_at（周期健康检查时间戳）

Revision ID: 0043
Revises: 0042
Create Date: 2026-05-07
"""

from alembic import op


revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE ml_backends "
        "ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE ml_backends DROP COLUMN IF EXISTS last_checked_at")
