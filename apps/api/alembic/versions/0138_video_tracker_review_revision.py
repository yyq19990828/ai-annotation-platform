"""Add optimistic revision for local tracker candidate review.

Revision ID: 0138
Revises: 0137
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision = "0138"
down_revision = "0137"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "video_tracker_jobs",
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
    )
    op.create_check_constraint(
        "ck_video_tracker_jobs_revision_positive",
        "video_tracker_jobs",
        "revision > 0",
    )


def downgrade() -> None:
    op.execute(
        "UPDATE video_tracker_jobs SET status = 'pending_review' "
        "WHERE status = 'partially_reviewed' AND staged_result IS NOT NULL"
    )
    op.execute(
        "ALTER TABLE video_tracker_jobs "
        "DROP CONSTRAINT IF EXISTS ck_video_tracker_jobs_revision_positive"
    )
    op.drop_column("video_tracker_jobs", "revision")
