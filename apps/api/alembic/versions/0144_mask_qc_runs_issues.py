"""Add Mask QC project configuration, runs, and issues.

Revision ID: 0144
Revises: 0143
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0144"
down_revision = "0143"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "mask_qc_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_table(
        "mask_qc_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("async_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status", sa.String(length=20), server_default="pending", nullable=False
        ),
        sa.Column("progress_pct", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "scope_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("config_revision", sa.Integer(), nullable=False),
        sa.Column("config_digest", sa.String(length=64), nullable=False),
        sa.Column(
            "config_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "source_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("source_snapshot_digest", sa.String(length=64), nullable=False),
        sa.Column(
            "task_snapshot_digests",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("singleflight_key", sa.String(length=64), nullable=False),
        sa.Column(
            "summary",
            postgresql.JSONB(astext_type=sa.Text()),
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
            "status IN ('pending', 'running', 'completed', 'failed', 'cancelled')",
            name="ck_mask_qc_runs_status",
        ),
        sa.CheckConstraint(
            "progress_pct >= 0 AND progress_pct <= 100", name="ck_mask_qc_runs_progress"
        ),
        sa.CheckConstraint(
            "config_revision >= 1", name="ck_mask_qc_runs_config_revision"
        ),
        sa.CheckConstraint(
            "config_digest ~ '^[0-9a-f]{64}$' AND "
            "source_snapshot_digest ~ '^[0-9a-f]{64}$' AND "
            "singleflight_key ~ '^[0-9a-f]{64}$'",
            name="ck_mask_qc_runs_digests",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["async_job_id"], ["async_jobs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_mask_qc_runs_project_status_created",
        "mask_qc_runs",
        ["project_id", "status", "created_at"],
    )
    op.create_index(
        "ix_mask_qc_runs_async_job", "mask_qc_runs", ["async_job_id"], unique=True
    )
    op.create_index(
        "uq_mask_qc_runs_active_singleflight",
        "mask_qc_runs",
        ["project_id", "singleflight_key"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )

    op.create_table(
        "mask_qc_issues",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_seen_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("annotation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("annotation_version", sa.Integer(), nullable=False),
        sa.Column(
            "related_annotation_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            server_default=sa.text("'{}'::uuid[]"),
            nullable=False,
        ),
        sa.Column(
            "source_versions", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=10), nullable=False),
        sa.Column("severity_rank", sa.SmallInteger(), nullable=False),
        sa.Column(
            "status", sa.String(length=12), server_default="open", nullable=False
        ),
        sa.Column("frame_start", sa.Integer(), nullable=True),
        sa.Column("frame_end", sa.Integer(), nullable=True),
        sa.Column(
            "metric",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "threshold",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "region_bbox", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "region_mask_ref", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("region_digest", sa.String(length=64), nullable=True),
        sa.Column("dedupe_key", sa.String(length=64), nullable=False),
        sa.Column(
            "source",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("suggestion", sa.Text(), nullable=True),
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
            "status IN ('open', 'resolved', 'wont_fix', 'stale')",
            name="ck_mask_qc_issues_status",
        ),
        sa.CheckConstraint(
            "(severity = 'blocker' AND severity_rank = 0) OR "
            "(severity = 'warning' AND severity_rank = 1) OR "
            "(severity = 'info' AND severity_rank = 2)",
            name="ck_mask_qc_issues_severity_rank",
        ),
        sa.CheckConstraint(
            "dedupe_key ~ '^[0-9a-f]{64}$' AND "
            "(region_digest IS NULL OR region_digest ~ '^[0-9a-f]{64}$')",
            name="ck_mask_qc_issues_digests",
        ),
        sa.CheckConstraint(
            "(frame_start IS NULL AND frame_end IS NULL) OR "
            "(frame_start >= 0 AND frame_end >= frame_start)",
            name="ck_mask_qc_issues_frames",
        ),
        sa.CheckConstraint(
            "annotation_version >= 1",
            name="ck_mask_qc_issues_annotation_version",
        ),
        sa.ForeignKeyConstraint(["run_id"], ["mask_qc_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["last_seen_run_id"], ["mask_qc_runs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resolved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "dedupe_key", name="uq_mask_qc_issues_dedupe"
        ),
    )
    op.create_index(
        "ix_mask_qc_issues_project_page",
        "mask_qc_issues",
        ["project_id", "status", "severity_rank", "created_at", "id"],
    )
    op.create_index(
        "ix_mask_qc_issues_project_order",
        "mask_qc_issues",
        ["project_id", "severity_rank", "created_at", "id"],
    )
    op.create_index(
        "ix_mask_qc_issues_task_page",
        "mask_qc_issues",
        ["task_id", "status", "severity_rank", "created_at", "id"],
    )
    op.create_index(
        "ix_mask_qc_issues_annotation_version",
        "mask_qc_issues",
        ["annotation_id", "annotation_version"],
    )
    op.create_index(
        "ix_mask_qc_issues_last_seen_run",
        "mask_qc_issues",
        ["last_seen_run_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_mask_qc_issues_last_seen_run", table_name="mask_qc_issues")
    op.drop_index("ix_mask_qc_issues_annotation_version", table_name="mask_qc_issues")
    op.drop_index("ix_mask_qc_issues_task_page", table_name="mask_qc_issues")
    op.drop_index("ix_mask_qc_issues_project_page", table_name="mask_qc_issues")
    op.drop_index("ix_mask_qc_issues_project_order", table_name="mask_qc_issues")
    op.drop_table("mask_qc_issues")
    op.drop_index("uq_mask_qc_runs_active_singleflight", table_name="mask_qc_runs")
    op.drop_index("ix_mask_qc_runs_async_job", table_name="mask_qc_runs")
    op.drop_index("ix_mask_qc_runs_project_status_created", table_name="mask_qc_runs")
    op.drop_table("mask_qc_runs")
    op.drop_column("projects", "mask_qc_config")
