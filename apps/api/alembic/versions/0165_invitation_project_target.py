"""Add optional project targets to user invitations.

Revision ID: 0165
Revises: 0164
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision = "0165"
down_revision = "0164"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Keep the UUID without a foreign key intentionally.  Project deletion is
    # allowed to proceed, while acceptance can distinguish a deleted target
    # from an invitation that was created without a project.
    op.add_column(
        "user_invitations",
        sa.Column("project_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_user_invitations_project_id", "user_invitations", ["project_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_user_invitations_project_id", table_name="user_invitations")
    op.drop_column("user_invitations", "project_id")
