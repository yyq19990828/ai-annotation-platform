"""Add project video collaboration config and segment-owned annotations.

Revision ID: 0153
Revises: 0152
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0153"
down_revision = "0152"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "video_collaboration",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "annotations",
        sa.Column("video_segment_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_annotations_video_segment_id_video_segments",
        "annotations",
        "video_segments",
        ["video_segment_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_annotations_task_segment_track_active",
        "annotations",
        ["task_id", "video_segment_id", "track_id"],
        unique=False,
        postgresql_where=sa.text(
            "is_active = true AND was_cancelled = false "
            "AND video_segment_id IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_annotations_task_segment_track_active", table_name="annotations")
    op.drop_constraint(
        "fk_annotations_video_segment_id_video_segments",
        "annotations",
        type_="foreignkey",
    )
    op.drop_column("annotations", "video_segment_id")
    op.drop_column("projects", "video_collaboration")
