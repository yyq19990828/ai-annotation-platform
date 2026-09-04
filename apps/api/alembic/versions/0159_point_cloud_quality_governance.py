"""Add point-cloud quality evaluation and governance.

Revision ID: 0159
Revises: 0158
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0159"
down_revision = "0158"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "point_cloud_quality_issues",
        sa.Column("class_name", sa.String(100), nullable=True),
    )
    op.add_column(
        "point_cloud_quality_issues",
        sa.Column("review_verdict", sa.String(24), nullable=True),
    )
    op.add_column(
        "point_cloud_quality_issues",
        sa.Column("review_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "point_cloud_quality_issues",
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "point_cloud_quality_issues",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_point_cloud_quality_issues_reviewed_by",
        "point_cloud_quality_issues",
        "users",
        ["reviewed_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "ck_point_cloud_quality_issues_review_verdict",
        "point_cloud_quality_issues",
        "review_verdict IS NULL OR review_verdict IN "
        "('confirmed','false_positive','accepted_exception','uncertain')",
    )
    op.create_index(
        "ix_point_cloud_quality_issues_project_review",
        "point_cloud_quality_issues",
        ["project_id", "review_verdict", "reviewed_at"],
    )

    op.create_table(
        "point_cloud_quality_evaluations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("baseline_config_revision", sa.Integer(), nullable=False),
        sa.Column("baseline_config_digest", sa.String(64), nullable=False),
        sa.Column("baseline_config_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("candidate_config_digest", sa.String(64), nullable=False),
        sa.Column("candidate_config_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("cutoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("sample_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("summary", postgresql.JSONB(), nullable=False),
        sa.Column("gate_status", sa.String(24), nullable=False),
        sa.Column("gate_reasons", postgresql.JSONB(), nullable=False),
        sa.Column("promoted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("promoted_config_revision", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "gate_status IN ('insufficient_data','hold','promote')",
            name="ck_point_cloud_quality_evaluations_gate_status",
        ),
        sa.CheckConstraint(
            "sample_count >= 0",
            name="ck_point_cloud_quality_evaluations_sample_count",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["promoted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_point_cloud_quality_evaluations_project_created",
        "point_cloud_quality_evaluations",
        ["project_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("point_cloud_quality_evaluations")
    op.drop_index(
        "ix_point_cloud_quality_issues_project_review",
        table_name="point_cloud_quality_issues",
    )
    op.drop_constraint(
        "ck_point_cloud_quality_issues_review_verdict",
        "point_cloud_quality_issues",
        type_="check",
    )
    op.drop_constraint(
        "fk_point_cloud_quality_issues_reviewed_by",
        "point_cloud_quality_issues",
        type_="foreignkey",
    )
    op.drop_column("point_cloud_quality_issues", "reviewed_at")
    op.drop_column("point_cloud_quality_issues", "reviewed_by_id")
    op.drop_column("point_cloud_quality_issues", "review_note")
    op.drop_column("point_cloud_quality_issues", "review_verdict")
    op.drop_column("point_cloud_quality_issues", "class_name")
