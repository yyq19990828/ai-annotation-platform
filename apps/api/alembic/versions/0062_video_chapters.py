"""Video chapters

Revision ID: 0062
Revises: 0061
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_chapters",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("start_frame", sa.Integer(), nullable=False),
        sa.Column("end_frame", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("color", sa.String(length=40), nullable=True),
        sa.Column(
            "metadata",
            JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
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
            ["dataset_item_id"],
            ["dataset_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "end_frame >= start_frame",
            name="ck_video_chapters_frame_order",
        ),
        sa.UniqueConstraint(
            "dataset_item_id",
            "start_frame",
            "end_frame",
            name="uq_video_chapters_item_range",
        ),
    )
    op.create_index(
        op.f("ix_video_chapters_dataset_item_id"),
        "video_chapters",
        ["dataset_item_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_video_chapters_created_by"),
        "video_chapters",
        ["created_by"],
        unique=False,
    )
    op.create_index(
        "ix_video_chapters_item_range",
        "video_chapters",
        ["dataset_item_id", "start_frame", "end_frame"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_video_chapters_item_range", table_name="video_chapters")
    op.drop_index(
        op.f("ix_video_chapters_created_by"), table_name="video_chapters"
    )
    op.drop_index(
        op.f("ix_video_chapters_dataset_item_id"), table_name="video_chapters"
    )
    op.drop_table("video_chapters")
