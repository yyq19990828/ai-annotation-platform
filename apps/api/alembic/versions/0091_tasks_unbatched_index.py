"""v0.12.0 · 未归类池规模化: tasks 部分索引 (B5)

为「未归类任务池」(batch_id IS NULL) 的大表 cursor 分页补一条部分索引:
- ix_tasks_project_unbatched : list_tasks?unbatched=true 的
                               WHERE project_id=? AND batch_id IS NULL ORDER BY created_at, id
                               (部分索引, 仅未归类 task; 撑十万级未归类池浏览)

本项目所有迁移都跑在事务内 (env.py `do_run_migrations` 带 advisory lock + begin_transaction),
而 Postgres `CREATE INDEX CONCURRENTLY` 不能在事务内执行, 故此处用**普通建索引** + IF NOT EXISTS
(可重入)。dev / 中等规模表无锁压力。

⚠️ 生产侧若 tasks 已是大表 (建索引会锁写): DBA 应在低峰期**先手动**预建, 再跑迁移 (IF NOT
EXISTS → no-op):

    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_project_unbatched
        ON tasks (project_id, created_at, id) WHERE batch_id IS NULL;

Revision ID: 0091
Revises: 0090
Create Date: 2026-06-02
"""

import sqlalchemy as sa
from alembic import op


revision = "0091"
down_revision = "0090"
branch_labels = None
depends_on = None


# (index_name, columns, partial_where_or_None)
_INDEXES: list[tuple[str, list[str], str | None]] = [
    (
        "ix_tasks_project_unbatched",
        ["project_id", "created_at", "id"],
        "batch_id IS NULL",
    ),
]


def upgrade() -> None:
    for name, columns, where in _INDEXES:
        op.create_index(
            name,
            "tasks",
            columns,
            unique=False,
            if_not_exists=True,
            postgresql_where=sa.text(where) if where else None,
        )


def downgrade() -> None:
    for name, _columns, _where in reversed(_INDEXES):
        op.drop_index(name, table_name="tasks", if_exists=True)
