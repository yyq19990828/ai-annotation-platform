"""Extend the operation CHECK for Mask slices using the existing revision ledger.

Revision ID: 0162
Revises: 0161
"""

from alembic import op
import sqlalchemy as sa

revision = "0162"
down_revision = "0161"
branch_labels = None
depends_on = None

KINDS = "'split_components', 'copy_component', 'copy_keyframe', 'join_masks', 'overlap', 'convert_annotations', 'delete_small_islands', 'fill_small_holes', 'resolve_same_class_overlap', 'mask_repair_rollback', 'slice_polygon', 'restore_slice'"


def _check(kinds: str) -> None:
    op.drop_constraint(
        "ck_annotation_operations_kind", "annotation_operations", type_="check"
    )
    op.create_check_constraint(
        "ck_annotation_operations_kind", "annotation_operations", f"kind IN ({kinds})"
    )


def upgrade() -> None:
    _check(KINDS + ", 'slice_mask'")


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text("LOCK TABLE annotation_operations IN ACCESS EXCLUSIVE MODE")
    )
    if connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM annotation_operations WHERE kind = 'slice_mask')"
        )
    ):
        raise RuntimeError(
            "Mask slice audit data exists: disable the entry point and retain the compatible schema"
        )
    _check(KINDS)
