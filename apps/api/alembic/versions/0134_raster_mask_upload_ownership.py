"""Track per-task ownership of anonymous raster-mask uploads.

Revision ID: 0134
Revises: 0133
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0134"
down_revision = "0133"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "raster_mask_uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("object_key", sa.String(length=255), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id", "object_key", name="uq_raster_mask_upload_task_key"
        ),
    )
    op.create_index(
        "ix_raster_mask_upload_task_unlinked",
        "raster_mask_uploads",
        ["task_id", "linked_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_raster_mask_upload_task_unlinked", table_name="raster_mask_uploads"
    )
    op.drop_table("raster_mask_uploads")
