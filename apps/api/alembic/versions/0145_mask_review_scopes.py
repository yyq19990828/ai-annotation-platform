"""Add regional Mask review scope ledger.

Revision ID: 0145
Revises: 0144
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0145"
down_revision = "0144"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mask_review_scopes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("annotation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("qc_issue_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_annotation_version", sa.Integer(), nullable=False),
        sa.Column("result_annotation_version", sa.Integer(), nullable=False),
        sa.Column("source_job_revision", sa.Integer(), nullable=False),
        sa.Column("frame_start", sa.Integer(), nullable=False),
        sa.Column("frame_end", sa.Integer(), nullable=False),
        sa.Column(
            "region_mask_ref", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("region_digest", sa.String(length=64), nullable=False),
        sa.Column("candidate_digest", sa.String(length=71), nullable=False),
        sa.Column("decision", sa.String(length=10), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "decision IN ('accept', 'reject')",
            name="ck_mask_review_scopes_decision",
        ),
        sa.CheckConstraint(
            "source_annotation_version >= 1 AND result_annotation_version >= 1",
            name="ck_mask_review_scopes_versions",
        ),
        sa.CheckConstraint(
            "frame_start >= 0 AND frame_end >= frame_start",
            name="ck_mask_review_scopes_frames",
        ),
        sa.CheckConstraint(
            "region_digest ~ '^[0-9a-f]{64}$' AND "
            "candidate_digest ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_mask_review_scopes_digests",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["qc_issue_id"], ["mask_qc_issues.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["source_job_id"], ["video_tracker_jobs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_mask_review_scopes_current_range",
        "mask_review_scopes",
        ["annotation_id", "result_annotation_version", "frame_start", "frame_end"],
    )
    op.create_index(
        "ix_mask_review_scopes_source_job",
        "mask_review_scopes",
        ["source_job_id"],
    )
    op.create_index(
        "ix_mask_review_scopes_issue", "mask_review_scopes", ["qc_issue_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_mask_review_scopes_issue", table_name="mask_review_scopes")
    op.drop_index("ix_mask_review_scopes_source_job", table_name="mask_review_scopes")
    op.drop_index(
        "ix_mask_review_scopes_current_range", table_name="mask_review_scopes"
    )
    op.drop_table("mask_review_scopes")
