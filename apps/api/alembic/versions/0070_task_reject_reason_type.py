"""tasks.reject_reason_type 结构化枚举 (v0.10.16)

加 tasks.reject_reason_type 字段，把自由文本 reject_reason 升级为
"类型枚举 + 自由文本补充" 的两段式。旧数据不回填，新 reject 强制选类型。

枚举 (4 类，收紧版): 'missing' | 'extra' | 'wrong_label' | 'wrong_geometry'

Revision ID: 0070
Revises: 0069
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("reject_reason_type", sa.String(20), nullable=True),
    )
    op.create_index("ix_tasks_reject_reason_type", "tasks", ["reject_reason_type"])


def downgrade() -> None:
    op.drop_index("ix_tasks_reject_reason_type", table_name="tasks")
    op.drop_column("tasks", "reject_reason_type")
