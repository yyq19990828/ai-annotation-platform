"""Video frame timetable indices

Revision ID: 0056
Revises: 0055
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_frame_indices",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("frame_index", sa.Integer(), nullable=False),
        sa.Column("pts_ms", sa.Integer(), nullable=False),
        sa.Column(
            "is_keyframe",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("pict_type", sa.String(length=8), nullable=True),
        sa.Column("byte_offset", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["dataset_item_id"],
            ["dataset_items.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_item_id",
            "frame_index",
            name="uq_video_frame_indices_item_frame",
        ),
    )
    op.create_index(
        op.f("ix_video_frame_indices_dataset_item_id"),
        "video_frame_indices",
        ["dataset_item_id"],
        unique=False,
    )
    op.create_index(
        "ix_video_frame_indices_item_pts",
        "video_frame_indices",
        ["dataset_item_id", "pts_ms"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_video_frame_indices_item_pts", table_name="video_frame_indices")
    op.drop_index(
        op.f("ix_video_frame_indices_dataset_item_id"),
        table_name="video_frame_indices",
    )
    op.drop_table("video_frame_indices")
