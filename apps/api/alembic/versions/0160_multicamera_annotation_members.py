"""Add persistent multicamera annotation members and calibration revisions.

Revision ID: 0160
Revises: 0159
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0160"
down_revision = "0159"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sensor_calibration_revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("calibration", postgresql.JSONB(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["dataset_item_id"], ["dataset_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "revision >= 1",
            name="ck_sensor_calibration_revisions_revision",
        ),
        sa.CheckConstraint(
            "char_length(digest) = 64",
            name="ck_sensor_calibration_revisions_digest",
        ),
        sa.UniqueConstraint(
            "dataset_item_id",
            "revision",
            name="uq_sensor_calibration_revisions_item_revision",
        ),
    )
    op.create_index(
        "ix_sensor_calibration_revisions_item_revision",
        "sensor_calibration_revisions",
        ["dataset_item_id", "revision"],
    )

    op.add_column(
        "annotations",
        sa.Column("sensor_dataset_item_id", postgresql.UUID(as_uuid=True)),
    )
    op.add_column("annotations", sa.Column("sensor_role", sa.String(50)))
    op.add_column("annotations", sa.Column("sensor_visibility", sa.String(16)))
    op.add_column("annotations", sa.Column("calibration_revision", sa.Integer()))
    op.add_column("annotations", sa.Column("calibration_digest", sa.String(64)))
    op.create_foreign_key(
        "fk_annotations_sensor_dataset_item",
        "annotations",
        "dataset_items",
        ["sensor_dataset_item_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_annotations_sensor_dataset_item_id",
        "annotations",
        ["sensor_dataset_item_id"],
    )
    op.create_check_constraint(
        "ck_annotations_sensor_context_complete",
        "annotations",
        "(sensor_role IS NULL AND sensor_dataset_item_id IS NULL "
        "AND sensor_visibility IS NULL AND calibration_revision IS NULL "
        "AND calibration_digest IS NULL) OR "
        "(sensor_role IS NOT NULL AND sensor_dataset_item_id IS NOT NULL "
        "AND sensor_visibility IS NOT NULL AND calibration_revision IS NOT NULL "
        "AND calibration_digest IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_annotations_sensor_visibility",
        "annotations",
        "sensor_visibility IS NULL OR sensor_visibility IN "
        "('visible','occluded','truncated','unknown')",
    )
    op.create_check_constraint(
        "ck_annotations_sensor_role",
        "annotations",
        "sensor_role IS NULL OR sensor_role LIKE 'camera_%'",
    )
    op.create_check_constraint(
        "ck_annotations_calibration_revision",
        "annotations",
        "calibration_revision IS NULL OR calibration_revision >= 1",
    )
    op.create_check_constraint(
        "ck_annotations_calibration_digest",
        "annotations",
        "calibration_digest IS NULL OR char_length(calibration_digest) = 64",
    )
    op.create_check_constraint(
        "ck_annotations_camera_member_shape",
        "annotations",
        "sensor_role IS NULL OR (annotation_type = 'bbox' "
        "AND geometry->>'type' = 'bbox' AND scene_track_id IS NOT NULL "
        "AND track_id IS NOT NULL)",
    )
    op.create_index(
        "uq_annotations_camera_member_active",
        "annotations",
        ["task_id", "scene_track_id", "sensor_role"],
        unique=True,
        postgresql_where=sa.text(
            "is_active = true AND was_cancelled = false "
            "AND scene_track_id IS NOT NULL AND sensor_role IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_annotations_camera_member_active", table_name="annotations")
    op.drop_constraint(
        "ck_annotations_camera_member_shape", "annotations", type_="check"
    )
    op.drop_constraint(
        "ck_annotations_calibration_digest", "annotations", type_="check"
    )
    op.drop_constraint(
        "ck_annotations_calibration_revision", "annotations", type_="check"
    )
    op.drop_constraint("ck_annotations_sensor_role", "annotations", type_="check")
    op.drop_constraint("ck_annotations_sensor_visibility", "annotations", type_="check")
    op.drop_constraint(
        "ck_annotations_sensor_context_complete", "annotations", type_="check"
    )
    op.drop_index("ix_annotations_sensor_dataset_item_id", table_name="annotations")
    op.drop_constraint(
        "fk_annotations_sensor_dataset_item", "annotations", type_="foreignkey"
    )
    op.drop_column("annotations", "calibration_digest")
    op.drop_column("annotations", "calibration_revision")
    op.drop_column("annotations", "sensor_visibility")
    op.drop_column("annotations", "sensor_role")
    op.drop_column("annotations", "sensor_dataset_item_id")
    op.drop_table("sensor_calibration_revisions")
