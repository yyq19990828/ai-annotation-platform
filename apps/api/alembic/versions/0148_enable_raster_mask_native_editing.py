"""Enable native raster-mask editing for existing and future projects.

Revision ID: 0148
Revises: 0147

The backfill intentionally enables every project created before this release. The
project column remains writable so administrators can opt individual projects out
after the migration. Downgrade only restores the old default because migrated rows
cannot be distinguished safely from projects explicitly enabled by an administrator.
"""

import sqlalchemy as sa
from alembic import op


revision = "0148"
down_revision = "0147"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "projects",
        "raster_mask_native_editing_enabled",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("true"),
    )
    op.execute(
        sa.text(
            "UPDATE projects "
            "SET raster_mask_native_editing_enabled = true "
            "WHERE raster_mask_native_editing_enabled = false"
        )
    )


def downgrade() -> None:
    op.alter_column(
        "projects",
        "raster_mask_native_editing_enabled",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("false"),
    )
