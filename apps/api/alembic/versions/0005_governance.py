"""Governance: audit_logs + user_invitations

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "actor_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_email", sa.String(255), nullable=True),
        sa.Column("actor_role", sa.String(32), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=True),
        sa.Column("target_id", sa.String(64), nullable=True),
        sa.Column("method", sa.String(8), nullable=True),
        sa.Column("path", sa.String(256), nullable=True),
        sa.Column("status_code", sa.SmallInteger(), nullable=True),
        sa.Column("ip", INET(), nullable=True),
        sa.Column("detail_json", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_audit_logs_actor_created",
        "audit_logs",
        ["actor_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_audit_logs_target",
        "audit_logs",
        ["target_type", "target_id"],
    )
    op.create_index(
        "ix_audit_logs_action_created",
        "audit_logs",
        ["action", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_audit_logs_created",
        "audit_logs",
        [sa.text("created_at DESC")],
    )

    op.create_table(
        "user_invitations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("group_name", sa.String(128), nullable=True),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "invited_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "accepted_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_user_invitations_email", "user_invitations", ["email"])
    op.create_index(
        "ix_user_invitations_invited_by", "user_invitations", ["invited_by"]
    )
    op.create_index(
        "ix_user_invitations_token",
        "user_invitations",
        ["token"],
        unique=True,
    )
    op.create_index(
        "ix_user_invitations_email_pending",
        "user_invitations",
        ["email"],
        postgresql_where=sa.text("accepted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_user_invitations_email_pending", table_name="user_invitations")
    op.drop_index("ix_user_invitations_token", table_name="user_invitations")
    op.drop_index("ix_user_invitations_invited_by", table_name="user_invitations")
    op.drop_index("ix_user_invitations_email", table_name="user_invitations")
    op.drop_table("user_invitations")

    op.drop_index("ix_audit_logs_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_action_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_target", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_created", table_name="audit_logs")
    op.drop_table("audit_logs")
