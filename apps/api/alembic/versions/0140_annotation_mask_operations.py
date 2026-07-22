"""Add atomic annotation operation and lineage ledgers.

Revision ID: 0140
Revises: 0139
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0140"
down_revision = "0139"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "annotation_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_digest", sa.String(length=64), nullable=False),
        sa.Column("scope_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "source_versions", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "result_versions", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("report", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "status", sa.String(length=20), server_default="committed", nullable=False
        ),
        sa.Column(
            "response_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "kind IN ('split_components', 'copy_component', 'join_masks', 'overlap')",
            name="ck_annotation_operations_kind",
        ),
        sa.CheckConstraint(
            "status IN ('committed')",
            name="ck_annotation_operations_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id",
            "actor_id",
            "idempotency_key",
            name="uq_annotation_operations_task_actor_key",
        ),
    )
    op.create_index(
        "ix_annotation_operations_actor_id", "annotation_operations", ["actor_id"]
    )
    op.create_index(
        "ix_annotation_operations_task_created",
        "annotation_operations",
        ["task_id", "created_at"],
    )

    op.create_table(
        "annotation_lineage_edges",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_annotation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("result_annotation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("relation", sa.String(length=40), nullable=False),
        sa.Column("source_version", sa.Integer(), nullable=True),
        sa.Column("result_version", sa.Integer(), nullable=True),
        sa.Column("frame_index", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["operation_id"], ["annotation_operations.id"], ondelete="CASCADE"
        ),
        sa.CheckConstraint(
            "source_annotation_id IS NOT NULL OR result_annotation_id IS NOT NULL",
            name="ck_annotation_lineage_has_endpoint",
        ),
        sa.CheckConstraint(
            "source_version IS NULL OR source_version >= 1",
            name="ck_annotation_lineage_source_version",
        ),
        sa.CheckConstraint(
            "result_version IS NULL OR result_version >= 1",
            name="ck_annotation_lineage_result_version",
        ),
        sa.CheckConstraint(
            "frame_index IS NULL OR frame_index >= 0",
            name="ck_annotation_lineage_frame_index",
        ),
        sa.CheckConstraint(
            "relation IN ('split', 'copied', 'joined', 'overlap_erased')",
            name="ck_annotation_lineage_relation",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_annotation_lineage_edges_operation_id",
        "annotation_lineage_edges",
        ["operation_id"],
    )
    op.create_index(
        "ix_annotation_lineage_source",
        "annotation_lineage_edges",
        ["source_annotation_id"],
    )
    op.create_index(
        "ix_annotation_lineage_result",
        "annotation_lineage_edges",
        ["result_annotation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_annotation_lineage_result", table_name="annotation_lineage_edges")
    op.drop_index("ix_annotation_lineage_source", table_name="annotation_lineage_edges")
    op.drop_index(
        "ix_annotation_lineage_edges_operation_id",
        table_name="annotation_lineage_edges",
    )
    op.drop_table("annotation_lineage_edges")
    op.drop_index(
        "ix_annotation_operations_task_created", table_name="annotation_operations"
    )
    op.drop_index(
        "ix_annotation_operations_actor_id", table_name="annotation_operations"
    )
    op.drop_table("annotation_operations")
