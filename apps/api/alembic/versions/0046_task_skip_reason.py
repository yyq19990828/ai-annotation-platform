"""v0.8.7 F7 · tasks.skip_reason / skipped_at

标注员跳过任务时记录原因，自动转 reviewer 复核。
- skip_reason VARCHAR(50)：枚举 image_corrupt / no_target / unclear / other
- skipped_at TIMESTAMPTZ

Revision ID: 0046
Revises: 0045
Create Date: 2026-05-07
"""

from alembic import op


revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS skip_reason VARCHAR(50)"
    )
    op.execute(
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS skipped_at")
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS skip_reason")
