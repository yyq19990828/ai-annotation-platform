"""Add immutable image-pyramid assets and generations.

Revision ID: 0151
Revises: 0150
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0151"
down_revision = "0150"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "image_pyramid_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("profile_version", sa.String(length=64), nullable=False),
        sa.Column("active_generation", sa.Integer(), nullable=True),
        sa.Column("building_generation", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(dataset_item_id IS NOT NULL) <> (task_id IS NOT NULL)",
            name="ck_image_pyramid_assets_owner_xor",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_item_id"], ["dataset_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_image_pyramid_assets_dataset_profile",
        "image_pyramid_assets",
        ["dataset_item_id", "profile_version"],
        unique=True,
        postgresql_where=sa.text("dataset_item_id IS NOT NULL"),
    )
    op.create_index(
        "uq_image_pyramid_assets_task_profile",
        "image_pyramid_assets",
        ["task_id", "profile_version"],
        unique=True,
        postgresql_where=sa.text("task_id IS NOT NULL"),
    )

    op.create_table(
        "image_pyramid_generations",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("source_identity", sa.String(length=255), nullable=False),
        sa.Column("source_fingerprint", sa.String(length=80), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("lease_token", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "width",
            sa.Integer(),
            nullable=True,
        ),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("tile_size", sa.Integer(), server_default="512", nullable=False),
        sa.Column("overlap", sa.Integer(), server_default="1", nullable=False),
        sa.Column("max_level", sa.Integer(), nullable=True),
        sa.Column("format", sa.String(length=16), nullable=True),
        sa.Column("normalization_version", sa.String(length=64), nullable=False),
        sa.Column("manifest_key", sa.Text(), nullable=True),
        sa.Column("manifest_digest", sa.String(length=80), nullable=True),
        sa.Column("overview_key", sa.Text(), nullable=True),
        sa.Column("overview_width", sa.Integer(), nullable=True),
        sa.Column("overview_height", sa.Integer(), nullable=True),
        sa.Column("overview_digest", sa.String(length=80), nullable=True),
        sa.Column("tile_count", sa.Integer(), nullable=True),
        sa.Column("retained_bytes", sa.BigInteger(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "generation > 0", name="ck_image_pyramid_generation_positive"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'building', 'ready', 'failed')",
            name="ck_image_pyramid_generation_status",
        ),
        sa.CheckConstraint("tile_size > 0", name="ck_image_pyramid_tile_size_positive"),
        sa.CheckConstraint("overlap >= 0", name="ck_image_pyramid_overlap_nonnegative"),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["image_pyramid_assets.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint(
            "asset_id",
            "generation",
            name="pk_image_pyramid_generations",
        ),
    )
    op.create_index(
        "uq_image_pyramid_generation_inflight",
        "image_pyramid_generations",
        ["asset_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'building')"),
    )
    op.create_index(
        "ix_image_pyramid_generations_status_updated",
        "image_pyramid_generations",
        ["status", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_image_pyramid_generations_status_updated",
        table_name="image_pyramid_generations",
    )
    op.drop_index(
        "uq_image_pyramid_generation_inflight",
        table_name="image_pyramid_generations",
        postgresql_where=sa.text("status IN ('pending', 'building')"),
    )
    op.drop_table("image_pyramid_generations")
    op.drop_index(
        "uq_image_pyramid_assets_task_profile",
        table_name="image_pyramid_assets",
        postgresql_where=sa.text("task_id IS NOT NULL"),
    )
    op.drop_index(
        "uq_image_pyramid_assets_dataset_profile",
        table_name="image_pyramid_assets",
        postgresql_where=sa.text("dataset_item_id IS NOT NULL"),
    )
    op.drop_table("image_pyramid_assets")
