"""v0.14.15 · drop project ai_model display hint

Revision ID: 0101
Revises: 0100
Create Date: 2026-06-08
"""

from alembic import op
import sqlalchemy as sa


revision = "0101"
down_revision = "0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("projects", "ai_model")
    op.drop_column("project_templates", "ai_model")


def downgrade() -> None:
    # 仅复列 ai_model (纯展示 hint, nullable), 不恢复数据: 绑定真值由 ml_backend_id 承载,
    # 历史 ai_model 字符串在 upgrade 时已主动丢弃、无从回填; downgrade 只保证 schema 形状可逆。
    op.add_column("project_templates", sa.Column("ai_model", sa.String(), nullable=True))
    op.add_column("projects", sa.Column("ai_model", sa.String(), nullable=True))
