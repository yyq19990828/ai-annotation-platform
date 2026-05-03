"""v0.7.0 · 批次状态机重设计：批次审核反馈三字段

reject_batch 软重置语义需要在批次上记录 reviewer 留言：
  - review_feedback：reviewer 驳回原因（500 字内）
  - reviewed_at：审核时间戳
  - reviewed_by：审核人 user_id

Revision ID: 0027
Revises: 0026
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_batches",
        sa.Column("review_feedback", sa.Text(), nullable=True),
    )
    op.add_column(
        "task_batches",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "task_batches",
        sa.Column(
            "reviewed_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("task_batches", "reviewed_by")
    op.drop_column("task_batches", "reviewed_at")
    op.drop_column("task_batches", "review_feedback")
