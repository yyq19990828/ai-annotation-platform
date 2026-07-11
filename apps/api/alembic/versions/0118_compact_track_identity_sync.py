"""sync compact video track identity and add project track index

Revision ID: 0118
Revises: 0117
Create Date: 2026-07-11
"""

from __future__ import annotations

from alembic import op


revision = "0118"
down_revision = "0117"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Compact tracks historically stored identity in geometry while newer cross-frame
    # reads use annotations.track_id. Resolve both representations in one idempotent
    # pass; malformed/overlong legacy ids receive a platform id that fits varchar(64).
    op.execute(
        """
        WITH resolved AS MATERIALIZED (
            SELECT id,
                   CASE
                     WHEN track_id IS NOT NULL AND length(track_id) <= 64
                       THEN track_id
                     WHEN geometry->>'track_id' IS NOT NULL
                          AND length(geometry->>'track_id') <= 64
                       THEN geometry->>'track_id'
                     ELSE 'trk_' || replace(gen_random_uuid()::text, '-', '')
                   END AS resolved_track_id
            FROM annotations
            WHERE geometry->>'type' IN (
                'video_track_bbox',
                'video_track_polygon',
                'video_track_polyline'
            )
        )
        UPDATE annotations AS annotation
        SET track_id = resolved.resolved_track_id,
            geometry = jsonb_set(
                annotation.geometry,
                '{track_id}',
                to_jsonb(resolved.resolved_track_id),
                true
            )
        FROM resolved
        WHERE annotation.id = resolved.id
          AND (
              annotation.track_id IS DISTINCT FROM resolved.resolved_track_id
              OR annotation.geometry->>'track_id'
                 IS DISTINCT FROM resolved.resolved_track_id
          );
        """
    )
    op.execute(
        """
        CREATE INDEX ix_annotations_project_track_active
        ON annotations (project_id, track_id, task_id)
        WHERE is_active = true
          AND was_cancelled = false
          AND track_id IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_annotations_project_track_active", table_name="annotations")
