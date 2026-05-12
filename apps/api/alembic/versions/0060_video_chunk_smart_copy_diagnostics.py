"""Video chunk smart-copy diagnostics

Revision ID: 0060
Revises: 0059
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "video_chunks",
        sa.Column("generation_mode", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "video_chunks",
        sa.Column(
            "diagnostics",
            JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("video_chunks", "diagnostics")
    op.drop_column("video_chunks", "generation_mode")
