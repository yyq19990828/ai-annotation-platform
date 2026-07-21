"""Add project-level opt-in for native raster-mask editing.

Revision ID: 0135
Revises: 0134
"""

import sqlalchemy as sa
from alembic import op

revision = "0135"
down_revision = "0134"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "raster_mask_native_editing_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "raster_mask_native_editing_enabled")
