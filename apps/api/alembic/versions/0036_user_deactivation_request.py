"""v0.8.1 · users 表新增账号自助注销 3 字段

deactivation_requested_at: 用户提交申请时间
deactivation_reason: 用户填写的注销原因（可空，最长 500 字符）
deactivation_scheduled_at: 计划生效时间（申请时间 + 7d 冷静期）

冷静期内用户可 DELETE /me/deactivation-request 撤销。
Celery beat 任务 process_deactivation_requests 每日扫描 scheduled_at <= now()
的用户，复用既有 GDPR 软删路径。

Revision ID: 0036
Revises: 0035
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op


revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "deactivation_requested_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "users",
        sa.Column("deactivation_reason", sa.String(500), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "deactivation_scheduled_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.create_index(
        "ix_users_deactivation_scheduled_at",
        "users",
        ["deactivation_scheduled_at"],
        postgresql_where=sa.text("deactivation_scheduled_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_users_deactivation_scheduled_at", table_name="users")
    op.drop_column("users", "deactivation_scheduled_at")
    op.drop_column("users", "deactivation_reason")
    op.drop_column("users", "deactivation_requested_at")
