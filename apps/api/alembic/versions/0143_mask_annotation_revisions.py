"""Add the authoritative Raster Mask annotation revision ledger.

Revision ID: 0143
Revises: 0142
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0143"
down_revision = "0142"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.create_table(
        "mask_annotation_revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("annotation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("annotation_version", sa.Integer(), nullable=False),
        sa.Column("geometry", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("geometry_digest", sa.String(length=64), nullable=False),
        sa.Column("source_kind", sa.String(length=20), nullable=False),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("'infinity'::timestamptz"),
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "annotation_version >= 1",
            name="ck_mask_annotation_revisions_version",
        ),
        sa.CheckConstraint(
            "geometry_digest ~ '^[0-9a-f]{64}$'",
            name="ck_mask_annotation_revisions_geometry_digest",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "annotation_id",
            "annotation_version",
            name="uq_mask_annotation_revisions_annotation_version",
        ),
    )
    op.create_index(
        "ix_mask_annotation_revisions_project_expires",
        "mask_annotation_revisions",
        ["project_id", "expires_at"],
    )
    op.create_index(
        "ix_mask_annotation_revisions_task_created",
        "mask_annotation_revisions",
        ["task_id", "created_at"],
    )
    op.create_index(
        "ix_mask_annotation_revisions_expires_at",
        "mask_annotation_revisions",
        ["expires_at"],
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION record_mask_annotation_revision(
            p_project_id uuid,
            p_task_id uuid,
            p_annotation_id uuid,
            p_annotation_version integer,
            p_geometry jsonb,
            p_source_kind text
        ) RETURNS void AS $$
        BEGIN
            INSERT INTO mask_annotation_revisions (
                id, project_id, task_id, annotation_id, annotation_version,
                geometry, geometry_digest, source_kind, expires_at
            ) VALUES (
                gen_random_uuid(),
                COALESCE(
                    p_project_id,
                    (SELECT project_id FROM tasks WHERE id = p_task_id)
                ),
                p_task_id,
                p_annotation_id,
                p_annotation_version,
                p_geometry,
                encode(digest(convert_to(p_geometry::text, 'UTF8'), 'sha256'), 'hex'),
                p_source_kind,
                'infinity'::timestamptz
            )
            ON CONFLICT (annotation_id, annotation_version) DO NOTHING;

            -- The newest 20 snapshots remain live regardless of age. Once a
            -- snapshot falls out of that window it expires no earlier than 30
            -- days after capture.
            WITH ranked AS (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY annotation_id
                           ORDER BY annotation_version DESC, created_at DESC, id DESC
                       ) AS position
                FROM mask_annotation_revisions
                WHERE annotation_id = p_annotation_id
            )
            UPDATE mask_annotation_revisions AS revision
            SET expires_at = GREATEST(
                revision.created_at + interval '30 days',
                transaction_timestamp()
            )
            FROM ranked
            WHERE revision.id = ranked.id
              AND ranked.position > 20
              AND revision.expires_at = 'infinity'::timestamptz;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION capture_mask_annotation_revision()
        RETURNS trigger AS $$
        DECLARE
            old_is_mask boolean;
            new_is_mask boolean;
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF COALESCE(NEW.geometry->>'type', '') IN (
                    'raster_mask', 'video_track_mask'
                ) AND (NEW.version IS NULL OR NEW.version < 1) THEN
                    NEW.version := 1;
                END IF;
                RETURN NEW;
            END IF;

            old_is_mask := COALESCE(OLD.geometry->>'type', '') IN (
                'raster_mask', 'video_track_mask'
            );

            IF TG_OP = 'DELETE' THEN
                IF old_is_mask THEN
                    PERFORM record_mask_annotation_revision(
                        OLD.project_id,
                        OLD.task_id,
                        OLD.id,
                        OLD.version,
                        OLD.geometry,
                        OLD.source
                    );
                END IF;
                RETURN OLD;
            END IF;

            new_is_mask := COALESCE(NEW.geometry->>'type', '') IN (
                'raster_mask', 'video_track_mask'
            );
            IF old_is_mask OR new_is_mask THEN
                -- Application services increment explicitly. This database
                -- guard closes ORM/Core/bulk paths that omit or regress it.
                IF NEW.version IS NULL OR NEW.version <= OLD.version THEN
                    NEW.version := OLD.version + 1;
                ELSIF NEW.version > OLD.version + 1 THEN
                    RAISE EXCEPTION
                        'mask annotation version must advance exactly once: % -> %',
                        OLD.version,
                        NEW.version;
                END IF;

                IF old_is_mask THEN
                    PERFORM record_mask_annotation_revision(
                        OLD.project_id,
                        OLD.task_id,
                        OLD.id,
                        OLD.version,
                        OLD.geometry,
                        OLD.source
                    );
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_capture_mask_annotation_revision
        BEFORE INSERT OR UPDATE OR DELETE ON annotations
        FOR EACH ROW EXECUTE FUNCTION capture_mask_annotation_revision()
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION protect_mask_annotation_revision_snapshot()
        RETURNS trigger AS $$
        BEGIN
            IF ROW(
                NEW.id, NEW.project_id, NEW.task_id, NEW.annotation_id,
                NEW.annotation_version, NEW.geometry, NEW.geometry_digest,
                NEW.source_kind, NEW.operation_id, NEW.actor_id, NEW.created_at
            ) IS DISTINCT FROM ROW(
                OLD.id, OLD.project_id, OLD.task_id, OLD.annotation_id,
                OLD.annotation_version, OLD.geometry, OLD.geometry_digest,
                OLD.source_kind, OLD.operation_id, OLD.actor_id, OLD.created_at
            ) THEN
                RAISE EXCEPTION 'mask annotation revision snapshots are immutable';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_protect_mask_annotation_revision_snapshot
        BEFORE UPDATE ON mask_annotation_revisions
        FOR EACH ROW EXECUTE FUNCTION protect_mask_annotation_revision_snapshot()
        """
    )

    # Existing current Mask truth is seeded once so the first post-upgrade
    # mutation has an immutable predecessor even if it came from a legacy path.
    op.execute(
        """
        INSERT INTO mask_annotation_revisions (
            id, project_id, task_id, annotation_id, annotation_version,
            geometry, geometry_digest, source_kind, expires_at
        )
        SELECT
            gen_random_uuid(),
            COALESCE(annotation.project_id, task.project_id),
            annotation.task_id,
            annotation.id,
            annotation.version,
            annotation.geometry,
            encode(
                digest(convert_to(annotation.geometry::text, 'UTF8'), 'sha256'),
                'hex'
            ),
            annotation.source,
            'infinity'::timestamptz
        FROM annotations AS annotation
        JOIN tasks AS task ON task.id = annotation.task_id
        WHERE COALESCE(annotation.geometry->>'type', '') IN (
            'raster_mask', 'video_track_mask'
        )
        ON CONFLICT (annotation_id, annotation_version) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_capture_mask_annotation_revision ON annotations"
    )
    op.execute("DROP FUNCTION IF EXISTS capture_mask_annotation_revision()")
    op.execute(
        "DROP FUNCTION IF EXISTS record_mask_annotation_revision(uuid, uuid, uuid, integer, jsonb, text)"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_protect_mask_annotation_revision_snapshot "
        "ON mask_annotation_revisions"
    )
    op.execute("DROP FUNCTION IF EXISTS protect_mask_annotation_revision_snapshot()")
    op.drop_index(
        "ix_mask_annotation_revisions_expires_at",
        table_name="mask_annotation_revisions",
    )
    op.drop_index(
        "ix_mask_annotation_revisions_task_created",
        table_name="mask_annotation_revisions",
    )
    op.drop_index(
        "ix_mask_annotation_revisions_project_expires",
        table_name="mask_annotation_revisions",
    )
    op.drop_table("mask_annotation_revisions")
