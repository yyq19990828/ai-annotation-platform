"""v0.15.11 · api_keys 加 expires_at(可选过期时间)

NULL = 永不过期；非 NULL 且 < now() 视为过期，resolve_token 拒绝认证。

Revision ID: 0104
Revises: 0103
Create Date: 2026-06-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0104"
down_revision = "0103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("api_keys", "expires_at")
