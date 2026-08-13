"""Add video track boundary quality runs and issues.

Revision ID: 0154
Revises: 0153
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0154"
down_revision = "0153"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "video_track_quality_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("left_segment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("right_segment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("async_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status", sa.String(length=24), server_default="pending", nullable=False
        ),
        sa.Column("progress_pct", sa.Integer(), server_default="0", nullable=False),
        sa.Column("input_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("input_digest", sa.String(length=64), nullable=False),
        sa.Column("sampling_digest", sa.String(length=64), nullable=False),
        sa.Column(
            "metrics",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "pairs",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("accepted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stale_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint(
            "status IN ('pending','running','completed','empty_overlap','accepted','failed','stale')",
            name="ck_video_track_quality_runs_status",
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["left_segment_id"], ["video_segments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["right_segment_id"], ["video_segments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["async_job_id"], ["async_jobs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["accepted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_video_track_quality_runs_task_created",
        "video_track_quality_runs",
        ["task_id", "created_at"],
    )
    op.create_index(
        "ix_video_track_quality_runs_boundary",
        "video_track_quality_runs",
        ["left_segment_id", "right_segment_id", "created_at"],
    )
    op.create_index(
        "ix_video_track_quality_runs_async_job",
        "video_track_quality_runs",
        ["async_job_id"],
        unique=True,
    )
    op.create_table(
        "video_track_quality_issues",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("left_annotation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("right_annotation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("frame_start", sa.Integer(), nullable=False),
        sa.Column("frame_end", sa.Integer(), nullable=False),
        sa.Column(
            "metric",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "code IN ('false_positive','false_negative','id_switch','fragmentation','geometry_mismatch','unsupported_geometry')",
            name="ck_video_track_quality_issues_code",
        ),
        sa.CheckConstraint(
            "frame_start >= 0 AND frame_end >= frame_start",
            name="ck_video_track_quality_issues_frames",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["video_track_quality_runs.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["left_annotation_id"], ["annotations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["right_annotation_id"], ["annotations.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_video_track_quality_issues_run_frames",
        "video_track_quality_issues",
        ["run_id", "frame_start", "frame_end"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_video_track_quality_issues_run_frames",
        table_name="video_track_quality_issues",
    )
    op.drop_table("video_track_quality_issues")
    op.drop_index(
        "ix_video_track_quality_runs_async_job", table_name="video_track_quality_runs"
    )
    op.drop_index(
        "ix_video_track_quality_runs_boundary", table_name="video_track_quality_runs"
    )
    op.drop_index(
        "ix_video_track_quality_runs_task_created",
        table_name="video_track_quality_runs",
    )
    op.drop_table("video_track_quality_runs")
