"""Add a first-class point-cloud feedback anchor.

Revision ID: 0158
Revises: 0157
"""

from collections.abc import Sequence

from alembic import op


revision = "0158"
down_revision = "0157"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ORIGINAL_CHECK = """
    (anchor_type = 'project' AND task_id IS NULL AND annotation_id IS NULL AND anchor_position IS NULL)
    OR (anchor_type = 'task' AND task_id IS NOT NULL AND annotation_id IS NULL AND anchor_position IS NULL)
    OR (anchor_type = 'annotation' AND task_id IS NOT NULL AND annotation_id IS NOT NULL AND anchor_position IS NULL)
    OR (anchor_type = 'pixel' AND task_id IS NOT NULL AND anchor_position IS NOT NULL)
"""

_POINT_CLOUD_CHECK = f"""
    {_ORIGINAL_CHECK}
    OR (anchor_type = 'point_cloud' AND task_id IS NOT NULL AND anchor_position IS NOT NULL)
"""


def upgrade() -> None:
    op.drop_constraint(
        "ck_feedback_anchor_consistency", "annotation_feedbacks", type_="check"
    )
    op.create_check_constraint(
        "ck_feedback_anchor_consistency",
        "annotation_feedbacks",
        _POINT_CLOUD_CHECK,
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_feedback_anchor_consistency", "annotation_feedbacks", type_="check"
    )
    op.create_check_constraint(
        "ck_feedback_anchor_consistency",
        "annotation_feedbacks",
        _ORIGINAL_CHECK,
    )
