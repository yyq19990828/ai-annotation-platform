"""add thumbnail_path and blurhash to tasks

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("thumbnail_path", sa.String(512), nullable=True))
    op.add_column("tasks", sa.Column("blurhash", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "thumbnail_path")
    op.drop_column("tasks", "blurhash")
