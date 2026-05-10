"""Batch admin-lock (ADR-0008 soft hold)

Revision ID: 0055
Revises: 0054
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_batches",
        sa.Column(
            "admin_locked",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "task_batches",
        sa.Column("admin_lock_reason", sa.String(500), nullable=True),
    )
    op.add_column(
        "task_batches",
        sa.Column("admin_locked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "task_batches",
        sa.Column(
            "admin_locked_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_task_batches_admin_locked",
        "task_batches",
        ["admin_locked"],
        postgresql_where=sa.text("admin_locked = true"),
    )


def downgrade() -> None:
    op.drop_index("ix_task_batches_admin_locked", table_name="task_batches")
    op.drop_column("task_batches", "admin_locked_by")
    op.drop_column("task_batches", "admin_locked_at")
    op.drop_column("task_batches", "admin_lock_reason")
    op.drop_column("task_batches", "admin_locked")
