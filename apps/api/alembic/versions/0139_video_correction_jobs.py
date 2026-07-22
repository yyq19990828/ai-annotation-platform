"""Add durable video Mask correction jobs and a per-track active lease.

Revision ID: 0139
Revises: 0138
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision = "0139"
down_revision = "0138"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ACTIVE_CORRECTION = (
    "job_kind = 'correction' AND status IN "
    "('queued', 'running', 'pending_review', 'partially_reviewed')"
)


def upgrade() -> None:
    op.add_column(
        "video_tracker_jobs",
        sa.Column(
            "job_kind",
            sa.String(length=20),
            server_default="tracking",
            nullable=False,
        ),
    )
    op.add_column(
        "video_tracker_jobs",
        sa.Column("track_id_snapshot", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "video_tracker_jobs",
        sa.Column("correction_frame", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_video_tracker_jobs_kind",
        "video_tracker_jobs",
        "job_kind IN ('tracking', 'correction')",
    )
    op.create_check_constraint(
        "ck_video_tracker_jobs_correction_shape",
        "video_tracker_jobs",
        "(job_kind = 'tracking' AND correction_frame IS NULL) OR "
        "(job_kind = 'correction' AND annotation_id IS NOT NULL "
        "AND track_id_snapshot IS NOT NULL AND correction_frame IS NOT NULL "
        "AND correction_frame >= from_frame AND correction_frame <= to_frame)",
    )
    op.create_index(
        "uq_video_tracker_jobs_active_correction_track",
        "video_tracker_jobs",
        ["task_id", "track_id_snapshot"],
        unique=True,
        postgresql_where=sa.text(_ACTIVE_CORRECTION),
    )


def downgrade() -> None:
    op.execute(
        "UPDATE video_tracker_jobs SET status = 'cancelled', staged_result = NULL "
        "WHERE job_kind = 'correction' AND status IN "
        "('queued', 'running', 'pending_review', 'partially_reviewed')"
    )
    op.drop_index(
        "uq_video_tracker_jobs_active_correction_track",
        table_name="video_tracker_jobs",
    )
    op.drop_constraint(
        "ck_video_tracker_jobs_correction_shape",
        "video_tracker_jobs",
        type_="check",
    )
    op.drop_constraint(
        "ck_video_tracker_jobs_kind",
        "video_tracker_jobs",
        type_="check",
    )
    op.drop_column("video_tracker_jobs", "correction_frame")
    op.drop_column("video_tracker_jobs", "track_id_snapshot")
    op.drop_column("video_tracker_jobs", "job_kind")
