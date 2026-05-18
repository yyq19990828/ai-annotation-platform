"""Project annotation_guide + guide_assets (E1 · v0.10.13)

Revision ID: 0067
Revises: 0066
Create Date: 2026-05-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("annotation_guide", sa.Text(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column(
            "guide_assets",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "guide_assets")
    op.drop_column("projects", "annotation_guide")
