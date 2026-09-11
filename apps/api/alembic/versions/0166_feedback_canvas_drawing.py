"""Store drawings on native task feedback comments.

Revision ID: 0166
Revises: 0165
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0166"
down_revision: str | Sequence[str] | None = "0165"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "annotation_feedbacks",
        sa.Column("canvas_drawing", postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("annotation_feedbacks", "canvas_drawing")
