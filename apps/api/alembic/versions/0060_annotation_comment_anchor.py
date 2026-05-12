"""Annotation comment anchors

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
        "annotation_comments",
        sa.Column("anchor", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("annotation_comments", "anchor")
