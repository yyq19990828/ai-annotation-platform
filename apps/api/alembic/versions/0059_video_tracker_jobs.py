"""Video tracker jobs

Revision ID: 0059
Revises: 0058
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_tracker_jobs",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("annotation_id", UUID(as_uuid=True), nullable=False),
        sa.Column("segment_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="queued",
            nullable=False,
        ),
        sa.Column("model_key", sa.String(length=80), nullable=False),
        sa.Column("direction", sa.String(length=20), nullable=False),
        sa.Column("from_frame", sa.Integer(), nullable=False),
        sa.Column("to_frame", sa.Integer(), nullable=False),
        sa.Column(
            "prompt",
            JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("event_channel", sa.String(length=160), nullable=False),
        sa.Column("celery_task_id", sa.String(length=64), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
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
            ["annotation_id"],
            ["annotations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_item_id"],
            ["dataset_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["segment_id"],
            ["video_segments.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_video_tracker_jobs_annotation_id"),
        "video_tracker_jobs",
        ["annotation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_video_tracker_jobs_created_by"),
        "video_tracker_jobs",
        ["created_by"],
        unique=False,
    )
    op.create_index(
        op.f("ix_video_tracker_jobs_dataset_item_id"),
        "video_tracker_jobs",
        ["dataset_item_id"],
        unique=False,
    )
    op.create_index(
        "ix_video_tracker_jobs_dataset_frames",
        "video_tracker_jobs",
        ["dataset_item_id", "from_frame", "to_frame"],
        unique=False,
    )
    op.create_index(
        op.f("ix_video_tracker_jobs_segment_id"),
        "video_tracker_jobs",
        ["segment_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_video_tracker_jobs_task_id"),
        "video_tracker_jobs",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        "ix_video_tracker_jobs_task_status",
        "video_tracker_jobs",
        ["task_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_video_tracker_jobs_task_status", table_name="video_tracker_jobs")
    op.drop_index(
        op.f("ix_video_tracker_jobs_task_id"),
        table_name="video_tracker_jobs",
    )
    op.drop_index(
        op.f("ix_video_tracker_jobs_segment_id"),
        table_name="video_tracker_jobs",
    )
    op.drop_index(
        "ix_video_tracker_jobs_dataset_frames",
        table_name="video_tracker_jobs",
    )
    op.drop_index(
        op.f("ix_video_tracker_jobs_dataset_item_id"),
        table_name="video_tracker_jobs",
    )
    op.drop_index(
        op.f("ix_video_tracker_jobs_created_by"),
        table_name="video_tracker_jobs",
    )
    op.drop_index(
        op.f("ix_video_tracker_jobs_annotation_id"),
        table_name="video_tracker_jobs",
    )
    op.drop_table("video_tracker_jobs")
