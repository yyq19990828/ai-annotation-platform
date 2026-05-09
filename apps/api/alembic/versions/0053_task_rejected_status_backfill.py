"""M1 · task.rejected 状态 backfill

将现有 status='in_progress' AND reject_reason IS NOT NULL 的 task 迁到 status='rejected'。
无 schema 改动（status 字段已是 String(30)，无枚举约束）。

Revision ID: 0053
Revises: 0052
Create Date: 2026-05-09
"""

from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tasks
        SET status = 'rejected'
        WHERE status = 'in_progress'
          AND reject_reason IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE tasks
        SET status = 'in_progress'
        WHERE status = 'rejected'
        """
    )
