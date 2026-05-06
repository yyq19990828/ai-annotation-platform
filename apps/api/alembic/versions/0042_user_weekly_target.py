"""v0.8.4 · 周目标可配置（替换 AnnotatorDashboard.tsx 硬编码 200）

- users.weekly_target_default INT NULL（用户级默认）
- project_members.weekly_target INT NULL（项目级覆盖）

读取顺序：ProjectMember.weekly_target → User.weekly_target_default → 200 fallback。

Revision ID: 0042
Revises: 0041
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op


revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_target_default INTEGER"
    )
    op.execute(
        "ALTER TABLE project_members ADD COLUMN IF NOT EXISTS weekly_target INTEGER"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE project_members DROP COLUMN IF EXISTS weekly_target")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS weekly_target_default")
