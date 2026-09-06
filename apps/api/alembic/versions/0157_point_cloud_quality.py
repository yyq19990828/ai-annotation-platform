"""Add the point-cloud quality workflow.

Revision ID: 0157
Revises: 0156
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0157"
down_revision = "0156"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "point_cloud_quality_config",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.create_table(
        "point_cloud_quality_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("async_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("progress_pct", sa.Integer(), server_default="0", nullable=False),
        sa.Column("scope_json", postgresql.JSONB(), nullable=False),
        sa.Column("config_revision", sa.Integer(), nullable=False),
        sa.Column("config_digest", sa.String(64), nullable=False),
        sa.Column("config_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("source_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("source_snapshot_digest", sa.String(64), nullable=False),
        sa.Column("singleflight_key", sa.String(64), nullable=False),
        sa.Column(
            "summary",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
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
            "status IN ('pending','running','completed','failed','cancelled','stale')",
            name="ck_point_cloud_quality_runs_status",
        ),
        sa.CheckConstraint(
            "progress_pct >= 0 AND progress_pct <= 100",
            name="ck_point_cloud_quality_runs_progress",
        ),
        sa.CheckConstraint(
            "config_revision >= 1", name="ck_point_cloud_quality_runs_config_revision"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["async_job_id"], ["async_jobs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_point_cloud_quality_runs_project_status_created",
        "point_cloud_quality_runs",
        ["project_id", "status", "created_at"],
    )
    op.create_index(
        "ix_point_cloud_quality_runs_async_job",
        "point_cloud_quality_runs",
        ["async_job_id"],
        unique=True,
    )
    op.create_index(
        "uq_point_cloud_quality_runs_active_singleflight",
        "point_cloud_quality_runs",
        ["project_id", "singleflight_key"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending','running')"),
    )

    op.create_table(
        "point_cloud_quality_issues",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_seen_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scene_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("annotation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("annotation_version", sa.Integer(), nullable=True),
        sa.Column("scene_track_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("track_revision", sa.Integer(), nullable=True),
        sa.Column(
            "related_annotation_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("source_versions", postgresql.JSONB(), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("rule_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("severity", sa.String(10), nullable=False),
        sa.Column("severity_rank", sa.SmallInteger(), nullable=False),
        sa.Column("status", sa.String(12), server_default="open", nullable=False),
        sa.Column("frame_start", sa.Integer(), nullable=True),
        sa.Column("frame_end", sa.Integer(), nullable=True),
        sa.Column(
            "metric",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "threshold",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "evidence",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("locator", postgresql.JSONB(), nullable=False),
        sa.Column("suggested_command", sa.Text(), nullable=True),
        sa.Column("dedupe_key", sa.String(64), nullable=False),
        sa.Column("resolution_reason", sa.Text(), nullable=True),
        sa.Column("resolved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
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
            "status IN ('open','resolved','wont_fix','stale')",
            name="ck_point_cloud_quality_issues_status",
        ),
        sa.CheckConstraint(
            "(severity = 'blocker' AND severity_rank = 0) OR (severity = 'warning' AND severity_rank = 1) OR (severity = 'info' AND severity_rank = 2)",
            name="ck_point_cloud_quality_issues_severity_rank",
        ),
        sa.CheckConstraint(
            "(frame_start IS NULL AND frame_end IS NULL) OR (frame_start >= 0 AND frame_end >= frame_start)",
            name="ck_point_cloud_quality_issues_frames",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["point_cloud_quality_runs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["last_seen_run_id"], ["point_cloud_quality_runs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["scene_track_id"], ["scene_tracks.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["resolved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "dedupe_key", name="uq_point_cloud_quality_issues_dedupe"
        ),
    )
    op.create_index(
        "ix_point_cloud_quality_issues_project_page",
        "point_cloud_quality_issues",
        ["project_id", "status", "severity_rank", "created_at", "id"],
    )
    op.create_index(
        "ix_point_cloud_quality_issues_scene_frame",
        "point_cloud_quality_issues",
        ["scene_id", "frame_start", "frame_end"],
    )
    op.create_index(
        "ix_point_cloud_quality_issues_task_page",
        "point_cloud_quality_issues",
        ["task_id", "status", "severity_rank"],
    )
    op.create_index(
        "ix_point_cloud_quality_issues_annotation_version",
        "point_cloud_quality_issues",
        ["annotation_id", "annotation_version"],
    )
    op.create_index(
        "ix_point_cloud_quality_issues_track_revision",
        "point_cloud_quality_issues",
        ["scene_track_id", "track_revision"],
    )
    op.create_index(
        "ix_point_cloud_quality_issues_last_seen",
        "point_cloud_quality_issues",
        ["last_seen_run_id"],
    )


def downgrade() -> None:
    op.drop_table("point_cloud_quality_issues")
    op.drop_table("point_cloud_quality_runs")
    op.drop_column("projects", "point_cloud_quality_config")
