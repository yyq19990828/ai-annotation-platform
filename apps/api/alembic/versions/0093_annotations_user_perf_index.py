"""v0.12.7 · 绩效聚合: annotations(user_id, project_id, created_at) 部分索引

绩效页 /me/performance、/admin/people 详情、CSV 导出在每条聚合都有形如:

    WHERE annotations.user_id = ?
      AND annotations.project_id = ?      -- v0.12.6 A3 项目级范围
      AND annotations.is_active = true
      AND annotations.created_at >= ?

annotations 表此前只有 task_id / (task_id, created_at, id) 索引,**user_id 没有可用前缀**,
v0.12.6 之后 N×weekly/daily 串行子查询都会走表扫;补一条 partial 联合索引:

- ix_annotations_user_active_created : (user_id, project_id, created_at)
                                       WHERE is_active = true

为什么 partial:绩效查询恒带 is_active = true,partial 索引可缩小一半以上体积。
为什么 user_id 在前:`user_id == self` 是主谓词、选择度最高;project_id 中间承接 A3 项目级
过滤;created_at 末尾承接 BETWEEN 窗口扫描。

与项目约定一致:迁移在事务内跑,CONCURRENTLY 不可用;用 IF NOT EXISTS 可重入。

⚠️ 生产侧若 annotations 已是大表(建索引会锁写):DBA 在低峰期**先手动**预建:

    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_annotations_user_active_created
        ON annotations (user_id, project_id, created_at) WHERE is_active = true;

之后再跑本迁移(IF NOT EXISTS → no-op)。

Revision ID: 0093
Revises: 0092
Create Date: 2026-06-03
"""

import sqlalchemy as sa
from alembic import op


revision = "0093"
down_revision = "0092"
branch_labels = None
depends_on = None


_INDEX_NAME = "ix_annotations_user_active_created"
_TABLE = "annotations"
_COLUMNS = ["user_id", "project_id", "created_at"]
_WHERE = "is_active = true"


def upgrade() -> None:
    op.create_index(
        _INDEX_NAME,
        _TABLE,
        _COLUMNS,
        unique=False,
        if_not_exists=True,
        postgresql_where=sa.text(_WHERE),
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name=_TABLE, if_exists=True)
