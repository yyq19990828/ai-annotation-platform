"""Extend annotation operation and lineage checks for atomic slices.

Revision ID: 0161
Revises: 0160
"""

from alembic import op
import sqlalchemy as sa

revision = "0161"
down_revision = "0160"
branch_labels = None
depends_on = None

KINDS = "'split_components', 'copy_component', 'copy_keyframe', 'join_masks', 'overlap', 'convert_annotations', 'delete_small_islands', 'fill_small_holes', 'resolve_same_class_overlap', 'mask_repair_rollback'"
RELATIONS = "'split', 'copied', 'keyframe_copied', 'joined', 'overlap_erased', 'converted', 'mask_repaired', 'mask_repair_rolled_back'"


def _checks(kinds: str, relations: str) -> None:
    op.drop_constraint(
        "ck_annotation_operations_kind", "annotation_operations", type_="check"
    )
    op.create_check_constraint(
        "ck_annotation_operations_kind", "annotation_operations", f"kind IN ({kinds})"
    )
    op.drop_constraint(
        "ck_annotation_lineage_relation", "annotation_lineage_edges", type_="check"
    )
    op.create_check_constraint(
        "ck_annotation_lineage_relation",
        "annotation_lineage_edges",
        f"relation IN ({relations})",
    )


def upgrade() -> None:
    _checks(
        KINDS + ", 'slice_polygon', 'restore_slice'", RELATIONS + ", 'slice_restored'"
    )


def downgrade() -> None:
    connection = op.get_bind()
    # Serialize against writers before deciding whether narrowing is safe.
    connection.execute(
        sa.text(
            "LOCK TABLE annotation_operations, annotation_lineage_edges IN ACCESS EXCLUSIVE MODE"
        )
    )
    if connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM annotation_operations WHERE kind IN ('slice_polygon', 'restore_slice')) OR EXISTS (SELECT 1 FROM annotation_lineage_edges WHERE relation = 'slice_restored')"
        )
    ):
        raise RuntimeError(
            "Slice audit data exists: disable slice entry points and retain the compatible schema; do not delete the ledger to downgrade"
        )
    _checks(KINDS, RELATIONS)
