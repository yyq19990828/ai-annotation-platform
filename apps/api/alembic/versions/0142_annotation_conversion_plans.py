"""Add frozen annotation conversion plans and conversion lineage.

Revision ID: 0142
Revises: 0141
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0142"
down_revision = "0141"
branch_labels = None
depends_on = None


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
        "'join_masks', 'overlap', 'convert_annotations')",
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

    op.create_table(
        "annotation_conversion_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_digest", sa.String(length=64), nullable=False),
        sa.Column("snapshot_digest", sa.String(length=64), nullable=False),
        sa.Column(
            "request_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("plan_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "executed_operation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("annotation_operations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("executed_idempotency_key", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_annotation_conversion_plans_token_hash",
        "annotation_conversion_plans",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_annotation_conversion_plans_task_created",
        "annotation_conversion_plans",
        ["task_id", "created_at"],
    )
    op.create_index(
        "ix_annotation_conversion_plans_actor_id",
        "annotation_conversion_plans",
        ["actor_id"],
    )
    op.create_index(
        "ix_annotation_conversion_plans_expires_at",
        "annotation_conversion_plans",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_annotation_conversion_plans_expires_at",
        table_name="annotation_conversion_plans",
    )
    op.drop_index(
        "ix_annotation_conversion_plans_actor_id",
        table_name="annotation_conversion_plans",
    )
    op.drop_index(
        "ix_annotation_conversion_plans_task_created",
        table_name="annotation_conversion_plans",
    )
    op.drop_index(
        "ix_annotation_conversion_plans_token_hash",
        table_name="annotation_conversion_plans",
    )
    op.drop_table("annotation_conversion_plans")

    op.execute(
        "UPDATE annotation_lineage_edges SET relation = 'copied' "
        "WHERE relation = 'converted'"
    )
    op.execute(
        "UPDATE annotation_operations SET kind = 'copy_component' "
        "WHERE kind = 'convert_annotations'"
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
        "'overlap_erased')",
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
        "'join_masks', 'overlap')",
    )
