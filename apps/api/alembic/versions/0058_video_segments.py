"""Video segments

Revision ID: 0058
Revises: 0057
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_segments",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("segment_index", sa.Integer(), nullable=False),
        sa.Column("start_frame", sa.Integer(), nullable=False),
        sa.Column("end_frame", sa.Integer(), nullable=False),
        sa.Column("assignee_id", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="open",
            nullable=False,
        ),
        sa.Column("locked_by", UUID(as_uuid=True), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lock_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_item_id"],
            ["dataset_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["locked_by"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_item_id",
            "segment_index",
            name="uq_video_segments_item_segment",
        ),
    )
    op.create_index(
        op.f("ix_video_segments_assignee_id"),
        "video_segments",
        ["assignee_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_video_segments_dataset_item_id"),
        "video_segments",
        ["dataset_item_id"],
        unique=False,
    )
    op.create_index(
        "ix_video_segments_item_frames",
        "video_segments",
        ["dataset_item_id", "start_frame", "end_frame"],
        unique=False,
    )
    op.create_index(
        "ix_video_segments_lock_expiry",
        "video_segments",
        ["locked_by", "lock_expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_video_segments_locked_by"),
        "video_segments",
        ["locked_by"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_video_segments_locked_by"), table_name="video_segments")
    op.drop_index("ix_video_segments_lock_expiry", table_name="video_segments")
    op.drop_index("ix_video_segments_item_frames", table_name="video_segments")
    op.drop_index(
        op.f("ix_video_segments_dataset_item_id"),
        table_name="video_segments",
    )
    op.drop_index(op.f("ix_video_segments_assignee_id"), table_name="video_segments")
    op.drop_table("video_segments")
