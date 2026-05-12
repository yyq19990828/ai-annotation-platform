"""Video frame service assets

Revision ID: 0057
Revises: 0056
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_chunks",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("chunk_id", sa.Integer(), nullable=False),
        sa.Column("start_frame", sa.Integer(), nullable=False),
        sa.Column("end_frame", sa.Integer(), nullable=False),
        sa.Column("start_pts_ms", sa.Integer(), nullable=True),
        sa.Column("end_pts_ms", sa.Integer(), nullable=True),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_item_id",
            "chunk_id",
            name="uq_video_chunks_item_chunk",
        ),
    )
    op.create_index(
        op.f("ix_video_chunks_dataset_item_id"),
        "video_chunks",
        ["dataset_item_id"],
        unique=False,
    )
    op.create_index(
        "ix_video_chunks_item_frames",
        "video_chunks",
        ["dataset_item_id", "start_frame", "end_frame"],
        unique=False,
    )

    op.create_table(
        "video_frame_cache",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("frame_index", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("format", sa.String(length=10), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_item_id",
            "frame_index",
            "width",
            "format",
            name="uq_video_frame_cache_item_frame_width_format",
        ),
    )
    op.create_index(
        op.f("ix_video_frame_cache_dataset_item_id"),
        "video_frame_cache",
        ["dataset_item_id"],
        unique=False,
    )
    op.create_index(
        "ix_video_frame_cache_item_frame",
        "video_frame_cache",
        ["dataset_item_id", "frame_index"],
        unique=False,
    )
    op.create_index(
        "ix_video_frame_cache_status_accessed",
        "video_frame_cache",
        ["status", "last_accessed_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_video_frame_cache_status_accessed", table_name="video_frame_cache")
    op.drop_index("ix_video_frame_cache_item_frame", table_name="video_frame_cache")
    op.drop_index(
        op.f("ix_video_frame_cache_dataset_item_id"),
        table_name="video_frame_cache",
    )
    op.drop_table("video_frame_cache")

    op.drop_index("ix_video_chunks_item_frames", table_name="video_chunks")
    op.drop_index(
        op.f("ix_video_chunks_dataset_item_id"),
        table_name="video_chunks",
    )
    op.drop_table("video_chunks")
