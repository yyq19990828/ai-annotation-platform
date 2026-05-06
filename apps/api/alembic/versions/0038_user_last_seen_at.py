"""v0.8.3 · users 表新增 last_seen_at（在线状态心跳机制）

last_seen_at: 用户最近一次活跃时间（登录 / 心跳 / 关键操作）。

前端 30s 周期 POST /me/heartbeat 刷新；Celery beat `mark_inactive_offline`
扫描 status='online' AND last_seen_at < now - OFFLINE_THRESHOLD_MINUTES 的
用户置 'offline'，避免「关浏览器永远在线」的状态偏差。

UsersPage「本周活跃」改为 `last_seen_at >= now - 7d` 聚合，比旧 status==online
更准确（旧逻辑只反映瞬时在线）。

Revision ID: 0038
Revises: 0037
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op


revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_users_last_seen_at",
        "users",
        ["last_seen_at"],
        postgresql_where=sa.text("last_seen_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_users_last_seen_at", table_name="users")
    op.drop_column("users", "last_seen_at")
