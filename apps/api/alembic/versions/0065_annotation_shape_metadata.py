"""Annotation shape metadata: z_order / is_locked / is_hidden / is_occluded.

Revision ID: 0065
Revises: 0064
Create Date: 2026-05-15

v0.10.5 M4-β (ROADMAP I15) · 把 CVAT 风格的 shape 状态位作为一等态持久化:
- z_order: 渲染层级 (高在上); [/] 快捷键调整
- is_locked: 锁定后禁拖动 / 编辑; L 快捷键
- is_hidden: 隐藏; 不渲染也不计入 hit-test; H 快捷键
- is_occluded: 被遮挡但存在; 视觉上虚线 + 50% opacity; O 快捷键
"""

from alembic import op
import sqlalchemy as sa


revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("z_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "annotations",
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "annotations",
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "annotations",
        sa.Column("is_occluded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("annotations", "is_occluded")
    op.drop_column("annotations", "is_hidden")
    op.drop_column("annotations", "is_locked")
    op.drop_column("annotations", "z_order")
