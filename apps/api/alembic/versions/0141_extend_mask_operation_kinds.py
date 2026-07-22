"""Extend atomic Mask operation and lineage kinds.

Revision ID: 0141
Revises: 0140
"""

from collections.abc import Sequence

from alembic import op

revision = "0141"
down_revision = "0140"
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
        "'join_masks', 'overlap')",
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


def downgrade() -> None:
    op.execute(
        "UPDATE annotation_lineage_edges SET relation = 'copied' "
        "WHERE relation = 'keyframe_copied'"
    )
    op.execute(
        "UPDATE annotation_operations SET kind = 'copy_component' "
        "WHERE kind = 'copy_keyframe'"
    )
    op.drop_constraint(
        "ck_annotation_lineage_relation",
        "annotation_lineage_edges",
        type_="check",
    )
    op.create_check_constraint(
        "ck_annotation_lineage_relation",
        "annotation_lineage_edges",
        "relation IN ('split', 'copied', 'joined', 'overlap_erased')",
    )
    op.drop_constraint(
        "ck_annotation_operations_kind",
        "annotation_operations",
        type_="check",
    )
    op.create_check_constraint(
        "ck_annotation_operations_kind",
        "annotation_operations",
        "kind IN ('split_components', 'copy_component', 'join_masks', 'overlap')",
    )
