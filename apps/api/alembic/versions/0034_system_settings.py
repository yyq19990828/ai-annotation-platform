"""v0.8.1 · 系统设置 DB 化

新增 system_settings 表，作为运行时可热更新配置的来源。
启动时 env 优先；运行时 SystemSettingsService.get(key) 读 DB override，降级到 env 默认值。

Revision ID: 0034
Revises: 0033
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value_type", sa.String(20), nullable=False),
        sa.Column("value_json", JSONB, nullable=True),
        sa.Column(
            "updated_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("system_settings")
