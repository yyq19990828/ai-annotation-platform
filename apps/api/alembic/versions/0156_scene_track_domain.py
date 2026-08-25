"""Add the Scene Track lifecycle domain.

Revision ID: 0156
Revises: 0155
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0156"
down_revision = "0155"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "scene_tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scene_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("track_id", sa.String(length=64), nullable=False),
        sa.Column("class_name", sa.String(length=100), nullable=False),
        sa.Column(
            "presence_mode",
            sa.String(length=16),
            server_default="inferred",
            nullable=False,
        ),
        sa.Column(
            "attributes",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "attributes_meta",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("revision >= 1", name="ck_scene_tracks_revision"),
        sa.CheckConstraint(
            "presence_mode IN ('inferred','explicit')",
            name="ck_scene_tracks_presence_mode",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "scene_id",
            "track_id",
            name="uq_scene_tracks_project_scene_track",
        ),
    )
    op.create_index(
        "ix_scene_tracks_scene_class_track",
        "scene_tracks",
        ["scene_id", "class_name", "track_id"],
    )
    op.create_index(
        "ix_scene_tracks_project_scene",
        "scene_tracks",
        ["project_id", "scene_id"],
    )

    op.create_table(
        "scene_track_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scene_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_digest", sa.String(length=64), nullable=False),
        sa.Column("snapshot_token", sa.String(length=64), nullable=False),
        sa.Column("source_revisions", postgresql.JSONB(), nullable=False),
        sa.Column("result_revisions", postgresql.JSONB(), nullable=False),
        sa.Column("before_state", postgresql.JSONB(), nullable=False),
        sa.Column("after_state", postgresql.JSONB(), nullable=False),
        sa.Column("inverse_payload", postgresql.JSONB(), nullable=False),
        sa.Column("response_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "status", sa.String(length=20), server_default="committed", nullable=False
        ),
        sa.Column(
            "reverted_by_operation_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('split','merge','mark_absent','resume','terminate','revert')",
            name="ck_scene_track_operations_kind",
        ),
        sa.CheckConstraint(
            "status IN ('committed','reverted')",
            name="ck_scene_track_operations_status",
        ),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["reverted_by_operation_id"],
            ["scene_track_operations.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "scene_id",
            "actor_id",
            "idempotency_key",
            name="uq_scene_track_operations_scene_actor_key",
        ),
    )
    op.create_index(
        "ix_scene_track_operations_scene_created",
        "scene_track_operations",
        ["scene_id", "created_at"],
    )

    op.create_table(
        "scene_track_intervals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scene_track_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("start_frame", sa.Integer(), nullable=False),
        sa.Column("end_frame", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "start_frame >= 0 AND (end_frame IS NULL OR end_frame >= start_frame)",
            name="ck_scene_track_intervals_frames",
        ),
        sa.CheckConstraint("version >= 1", name="ck_scene_track_intervals_version"),
        sa.CheckConstraint(
            "source IN ('legacy_envelope','manual','imported','derived')",
            name="ck_scene_track_intervals_source",
        ),
        sa.ForeignKeyConstraint(
            ["scene_track_id"], ["scene_tracks.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["operation_id"], ["scene_track_operations.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        "ALTER TABLE scene_track_intervals ADD CONSTRAINT "
        "ex_scene_track_intervals_no_overlap EXCLUDE USING gist "
        "(scene_track_id WITH =, int4range(start_frame, end_frame, '[]') WITH &&)"
    )
    op.create_index(
        "ix_scene_track_intervals_track_frames",
        "scene_track_intervals",
        ["scene_track_id", "start_frame", "end_frame"],
    )

    op.add_column(
        "annotations",
        sa.Column(
            "temporal_role",
            sa.String(length=16),
            server_default="sample",
            nullable=True,
        ),
    )
    op.execute(
        "UPDATE annotations SET temporal_role = "
        "CASE WHEN source = 'interpolated' THEN 'derived' ELSE 'sample' END"
    )
    op.alter_column("annotations", "temporal_role", nullable=False)
    op.create_check_constraint(
        "ck_annotations_temporal_role",
        "annotations",
        "temporal_role IN ('keyframe','derived','sample')",
    )
    op.add_column(
        "annotations",
        sa.Column("scene_track_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_annotations_scene_track_id_scene_tracks",
        "annotations",
        "scene_tracks",
        ["scene_track_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_annotations_scene_track_id",
        "annotations",
        ["scene_track_id"],
    )
    op.create_index(
        "ix_annotations_scene_track_task_active",
        "annotations",
        ["scene_track_id", "task_id"],
        postgresql_where=sa.text(
            "is_active = true AND was_cancelled = false AND scene_track_id IS NOT NULL"
        ),
    )

    _backfill_legal_scene_tracks()


def _backfill_legal_scene_tracks() -> None:
    op.execute(
        """
        CREATE TEMP TABLE tmp_scene_track_members ON COMMIT DROP AS
        SELECT
            a.id AS annotation_id,
            a.project_id AS annotation_project_id,
            t.project_id AS task_project_id,
            a.track_id,
            a.class_name,
            CASE
                WHEN direct_item.scene_id IS NOT NULL THEN direct_item.scene_id
                ELSE linked_item.scene_id
            END AS scene_id,
            CASE
                WHEN direct_item.scene_id IS NOT NULL THEN direct_item.frame_index
                ELSE linked_item.frame_index
            END AS frame_index
        FROM annotations a
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN dataset_items direct_item ON direct_item.id = t.dataset_item_id
        LEFT JOIN LATERAL (
            SELECT di.scene_id, di.frame_index
            FROM task_dataset_item_links link
            JOIN dataset_items di ON di.id = link.dataset_item_id
            WHERE link.task_id = t.id AND link.role = 'primary_lidar'
            ORDER BY link.id
            LIMIT 1
        ) linked_item ON TRUE
        WHERE a.annotation_type = 'box_3d'
          AND a.track_id IS NOT NULL
          AND a.is_active = TRUE
          AND a.was_cancelled = FALSE
        """
    )
    op.execute(
        """
        CREATE TEMP TABLE tmp_legal_scene_tracks ON COMMIT DROP AS
        SELECT
            task_project_id AS project_id,
            track_id,
            (array_agg(scene_id ORDER BY scene_id))[1] AS scene_id,
            (array_agg(class_name ORDER BY class_name))[1] AS class_name,
            MIN(frame_index) AS start_frame,
            MAX(frame_index) AS end_frame
        FROM tmp_scene_track_members
        GROUP BY task_project_id, track_id
        HAVING COUNT(*) FILTER (
                   WHERE annotation_project_id IS NULL
                      OR annotation_project_id <> task_project_id
                      OR scene_id IS NULL
                      OR frame_index IS NULL
               ) = 0
           AND COUNT(DISTINCT scene_id) = 1
           AND COUNT(DISTINCT class_name) = 1
           AND COUNT(*) = COUNT(DISTINCT frame_index)
        """
    )
    op.execute(
        """
        INSERT INTO scene_tracks (
            id, project_id, scene_id, track_id, class_name,
            attributes, attributes_meta, revision
        )
        SELECT
            gen_random_uuid(), project_id, scene_id, track_id, class_name,
            '{}'::jsonb, '{}'::jsonb, 1
        FROM tmp_legal_scene_tracks
        """
    )
    op.execute(
        """
        INSERT INTO scene_track_intervals (
            id, scene_track_id, start_frame, end_frame, source, version
        )
        SELECT
            gen_random_uuid(), st.id, legal.start_frame, legal.end_frame,
            'legacy_envelope', 1
        FROM tmp_legal_scene_tracks legal
        JOIN scene_tracks st
          ON st.project_id = legal.project_id
         AND st.scene_id = legal.scene_id
         AND st.track_id = legal.track_id
        """
    )
    op.execute(
        """
        UPDATE annotations a
        SET scene_track_id = st.id
        FROM tmp_scene_track_members member
        JOIN tmp_legal_scene_tracks legal
          ON legal.project_id = member.task_project_id
         AND legal.scene_id = member.scene_id
         AND legal.track_id = member.track_id
        JOIN scene_tracks st
          ON st.project_id = legal.project_id
         AND st.scene_id = legal.scene_id
         AND st.track_id = legal.track_id
        WHERE a.id = member.annotation_id
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM scene_track_operations LIMIT 1) THEN
                RAISE EXCEPTION
                    'cannot downgrade Scene Track domain after commands were committed';
            END IF;
        END $$
        """
    )
    op.drop_index("ix_annotations_scene_track_task_active", table_name="annotations")
    op.drop_index("ix_annotations_scene_track_id", table_name="annotations")
    op.drop_constraint(
        "fk_annotations_scene_track_id_scene_tracks",
        "annotations",
        type_="foreignkey",
    )
    op.drop_column("annotations", "scene_track_id")
    op.drop_constraint("ck_annotations_temporal_role", "annotations", type_="check")
    op.drop_column("annotations", "temporal_role")

    op.drop_index(
        "ix_scene_track_intervals_track_frames",
        table_name="scene_track_intervals",
    )
    op.drop_table("scene_track_intervals")
    op.drop_index(
        "ix_scene_track_operations_scene_created",
        table_name="scene_track_operations",
    )
    op.drop_table("scene_track_operations")
    op.drop_index("ix_scene_tracks_project_scene", table_name="scene_tracks")
    op.drop_index("ix_scene_tracks_scene_class_track", table_name="scene_tracks")
    op.drop_table("scene_tracks")
