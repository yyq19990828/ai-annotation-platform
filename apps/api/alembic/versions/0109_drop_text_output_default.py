"""v0.19.0 · 退役 text_output_default 项目级选项

「SAM 文本预标默认输出」项目级默认已被 v0.18.x 交互工具栏 + 用户级 localStorage 偏好
架空(工作台首次激活 exemplar 后即被用户偏好永久覆盖, 批量预标按模型 supported_text_outputs
派生不读此字段)。移除该选项 UI + 字段; 工作台初始值回落 type_key 智能默认。

从 projects 与 project_templates 两表删列。downgrade 重建为可空列(不还原历史值)。

Revision ID: 0109
Revises: 0108
Create Date: 2026-06-29
"""

import sqlalchemy as sa
from alembic import op

revision = "0109"
down_revision = "0108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("projects", "text_output_default")
    op.drop_column("project_templates", "text_output_default")


def downgrade() -> None:
    op.add_column(
        "project_templates",
        sa.Column("text_output_default", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("text_output_default", sa.String(length=10), nullable=True),
    )
