"""v0.7.0 · 通知偏好（基础静音）

每用户、每 type 一行。channels.in_app=false 时 fan-out 时跳过插入。
channels.email 字段保留但 v0.7.0 不消费（等 LLM 聚类去重 + SMTP 落地）。

Revision ID: 0029
Revises: 0028
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_preferences",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("type", sa.String(60), primary_key=True),
        sa.Column(
            "channels",
            JSONB,
            nullable=False,
            server_default=sa.text('\'{"in_app": true, "email": false}\'::jsonb'),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("notification_preferences")
