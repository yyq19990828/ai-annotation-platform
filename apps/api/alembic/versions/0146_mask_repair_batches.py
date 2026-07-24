"""Add audited Mask repair batches.

Revision ID: 0146
Revises: 0145
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0146"
down_revision = "0145"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_annotation_operations_kind",
        "annotation_operations",
        type_="check",
    )
    op.create_check_constraint(
        "ck_annotation_operations_kind",
        "annotation_operations",
        "kind IN ('split_components', 'copy_component', 'copy_keyframe', "
        "'join_masks', 'overlap', 'convert_annotations', "
        "'delete_small_islands', 'fill_small_holes', "
        "'resolve_same_class_overlap', 'mask_repair_rollback')",
    )
    op.drop_constraint(
        "ck_annotation_lineage_relation",
        "annotation_lineage_edges",
        type_="check",
    )
    op.create_check_constraint(
        "ck_annotation_lineage_relation",
        "annotation_lineage_edges",
        "relation IN ('split', 'copied', 'keyframe_copied', 'joined', "
        "'overlap_erased', 'converted', 'mask_repaired', "
        "'mask_repair_rolled_back')",
    )
    op.create_table(
        "mask_repair_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("async_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "rollback_async_job_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=24),
            server_default="planned",
            nullable=False,
        ),
        sa.Column("plan_digest", sa.String(length=64), nullable=False),
        sa.Column(
            "request_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("plan_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "result_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("receipt_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rollback_expires_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('planned', 'pending', 'running', 'completed', 'partial', "
            "'failed', 'cancelled', 'rolling_back', 'rolled_back', "
            "'rollback_failed')",
            name="ck_mask_repair_batches_status",
        ),
        sa.CheckConstraint(
            "plan_digest ~ '^[0-9a-f]{64}$'",
            name="ck_mask_repair_batches_plan_digest",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["async_job_id"], ["async_jobs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["rollback_async_job_id"], ["async_jobs.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_mask_repair_batches_project_created",
        "mask_repair_batches",
        ["project_id", "created_at"],
    )
    op.create_index(
        "ix_mask_repair_batches_receipt_expires",
        "mask_repair_batches",
        ["receipt_expires_at"],
    )
    op.create_index(
        "ix_mask_repair_batches_rollback_expires",
        "mask_repair_batches",
        ["rollback_expires_at"],
    )
    op.create_index(
        "ix_mask_repair_batches_async_job",
        "mask_repair_batches",
        ["async_job_id"],
        unique=True,
    )
    op.create_index(
        "ix_mask_repair_batches_rollback_async_job",
        "mask_repair_batches",
        ["rollback_async_job_id"],
        unique=True,
    )
    op.create_index(
        "ix_mask_repair_batches_token_hash",
        "mask_repair_batches",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_mask_repair_batches_token_hash", table_name="mask_repair_batches")
    op.drop_index(
        "ix_mask_repair_batches_rollback_async_job",
        table_name="mask_repair_batches",
    )
    op.drop_index("ix_mask_repair_batches_async_job", table_name="mask_repair_batches")
    op.drop_index(
        "ix_mask_repair_batches_rollback_expires",
        table_name="mask_repair_batches",
    )
    op.drop_index(
        "ix_mask_repair_batches_receipt_expires",
        table_name="mask_repair_batches",
    )
    op.drop_index(
        "ix_mask_repair_batches_project_created",
        table_name="mask_repair_batches",
    )
    op.drop_table("mask_repair_batches")
    op.execute(
        "UPDATE annotation_lineage_edges SET relation = 'overlap_erased' "
        "WHERE relation IN ('mask_repaired', 'mask_repair_rolled_back')"
    )
    op.execute(
        "UPDATE annotation_operations SET kind = 'overlap' "
        "WHERE kind IN ('delete_small_islands', 'fill_small_holes', "
        "'resolve_same_class_overlap', 'mask_repair_rollback')"
    )
    op.drop_constraint(
        "ck_annotation_lineage_relation",
        "annotation_lineage_edges",
        type_="check",
    )
    op.create_check_constraint(
        "ck_annotation_lineage_relation",
        "annotation_lineage_edges",
        "relation IN ('split', 'copied', 'keyframe_copied', 'joined', "
        "'overlap_erased', 'converted')",
    )
    op.drop_constraint(
        "ck_annotation_operations_kind",
        "annotation_operations",
        type_="check",
    )
    op.create_check_constraint(
        "ck_annotation_operations_kind",
        "annotation_operations",
        "kind IN ('split_components', 'copy_component', 'copy_keyframe', "
        "'join_masks', 'overlap', 'convert_annotations')",
    )
