"""v0.8.1 · users 表新增 password_admin_reset_at 字段

管理员代用户重置密码时打时间戳；下次用户登录后强制跳「修改密码」页。
用户自助 change_password 成功后清空，恢复正常状态。

Revision ID: 0035
Revises: 0034
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op


revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "password_admin_reset_at", sa.DateTime(timezone=True), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "password_admin_reset_at")
