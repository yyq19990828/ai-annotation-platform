"""v0.8.4 · tasks 表新增 assigned_at（分派时间戳，效率看板基础字段）

- 字段：tasks.assigned_at TIMESTAMPTZ NULL
- 索引：(assignee_id, assigned_at DESC) 用于个人 dashboard / admin/people 查询
- 老数据保持 NULL；个人指标计算端 WHERE assigned_at IS NOT NULL 过滤后取中位/p95
- 写入点：services/batch.py 中所有 cascade 写 assignee_id 处 + tasks.py:548
  （提交者即 assignee 兜底）+ users.py:587 注销改派路径

Revision ID: 0039
Revises: 0038
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op


revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # idempotent：迁移应用过半失败的 DB 直接 retry 也安全
    op.execute(
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tasks_assignee_assigned_at "
        "ON tasks (assignee_id, assigned_at DESC) "
        "WHERE assigned_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tasks_assignee_assigned_at")
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS assigned_at")
