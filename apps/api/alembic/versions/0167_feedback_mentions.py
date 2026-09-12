"""Store member mentions on native task feedback comments.

Revision ID: 0167
Revises: 0166
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0167"
down_revision: str | Sequence[str] | None = "0166"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "annotation_feedbacks",
        sa.Column(
            "mentions",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("annotation_feedbacks", "mentions")
