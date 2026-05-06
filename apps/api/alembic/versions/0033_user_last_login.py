"""v0.7.8 · users 表新增 last_login_at 字段

追踪用户最后登录时间，用于合规审计和休眠账号检测。

Revision ID: 0033
Revises: 0032
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op


revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "last_login_at")
