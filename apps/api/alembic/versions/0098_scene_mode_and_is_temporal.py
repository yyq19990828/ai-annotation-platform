"""v0.14.4 · project scene_mode + dataset is_temporal

Revision ID: 0098
Revises: 0097
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0098"
down_revision = "0097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "scene_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "datasets",
        sa.Column(
            "is_temporal",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("datasets", "is_temporal")
    op.drop_column("projects", "scene_mode")
