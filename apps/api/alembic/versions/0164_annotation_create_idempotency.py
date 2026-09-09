"""Allow annotation creation idempotency receipts.

Revision ID: 0164
Revises: 0163
"""

from alembic import op
import sqlalchemy as sa


revision = "0164"
down_revision = "0163"
branch_labels = None
depends_on = None

_BEFORE_CREATE_ANNOTATION = (
    "'split_components', 'copy_component', 'copy_keyframe', 'join_masks', "
    "'overlap', 'convert_annotations', 'delete_small_islands', "
    "'fill_small_holes', 'resolve_same_class_overlap', "
    "'mask_repair_rollback', 'slice_polygon', 'restore_slice', 'slice_mask'"
)


def _replace_kind_check(kinds: str) -> None:
    op.drop_constraint(
        "ck_annotation_operations_kind", "annotation_operations", type_="check"
    )
    op.create_check_constraint(
        "ck_annotation_operations_kind",
        "annotation_operations",
        f"kind IN ({kinds})",
    )


def upgrade() -> None:
    _replace_kind_check(_BEFORE_CREATE_ANNOTATION + ", 'create_annotation'")


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text("LOCK TABLE annotation_operations IN ACCESS EXCLUSIVE MODE")
    )
    if connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM annotation_operations "
            "WHERE kind = 'create_annotation')"
        )
    ):
        raise RuntimeError(
            "Annotation creation idempotency receipts exist; retain migration 0164"
        )
    _replace_kind_check(_BEFORE_CREATE_ANNOTATION)
