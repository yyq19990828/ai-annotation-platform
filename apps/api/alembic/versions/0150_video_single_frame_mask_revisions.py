"""Include single-frame video masks in the Mask revision ledger.

Revision ID: 0150
Revises: 0149
"""

from collections.abc import Sequence

from alembic import op

revision = "0150"
down_revision = "0149"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _replace_capture_function(*, include_video_mask: bool) -> None:
    mask_types = (
        "'raster_mask', 'video_mask', 'video_track_mask'"
        if include_video_mask
        else "'raster_mask', 'video_track_mask'"
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION capture_mask_annotation_revision()
        RETURNS trigger AS $$
        DECLARE
            old_is_mask boolean;
            new_is_mask boolean;
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF COALESCE(NEW.geometry->>'type', '') IN (
                    {mask_types}
                ) AND (NEW.version IS NULL OR NEW.version < 1) THEN
                    NEW.version := 1;
                END IF;
                RETURN NEW;
            END IF;

            old_is_mask := COALESCE(OLD.geometry->>'type', '') IN (
                {mask_types}
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
                {mask_types}
            );
            IF old_is_mask OR new_is_mask THEN
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


def upgrade() -> None:
    _replace_capture_function(include_video_mask=True)


def downgrade() -> None:
    _replace_capture_function(include_video_mask=False)
