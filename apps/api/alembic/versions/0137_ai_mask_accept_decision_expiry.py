"""Bound native Mask accept replay and GC lifetime.

Revision ID: 0137
Revises: 0136
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision = "0137"
down_revision = "0136"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_mask_accept_decisions",
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now() + interval '24 hours'"),
            nullable=False,
        ),
    )
    op.create_index(
        op.f("ix_ai_mask_accept_decisions_expires_at"),
        "ai_mask_accept_decisions",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_ai_mask_accept_decisions_expires_at"),
        table_name="ai_mask_accept_decisions",
    )
    op.drop_column("ai_mask_accept_decisions", "expires_at")
