"""v0.11.30 · 大表查询地基: tasks 复合 / 部分索引 (B3)

为万级 → 十万级 task 的两条热路径补索引 (经 10 万行 EXPLAIN ANALYZE 实测保留):
- ix_tasks_project_created_id : list_tasks 的 WHERE project_id ORDER BY created_at, id
                                (Index Scan, 100 行 0.09ms)
- ix_tasks_batch_unlabeled    : scheduler 的 batch_id 过滤分支 + 未归类池 batch_id IS NULL
                                (部分索引, 仅未标注; Bitmap Index Scan)

注: 候选过的 ix_tasks_project_unlabeled(project_id, sequence_order, created_at) WHERE
is_labeled=false 在实测中**任何路径都未被 planner 选中**——默认 scheduler 因 ORDER BY 以
join 表的 batch.priority 打头必须排序, 且 is_labeled=false 在新项目无选择性 → seq scan,
成熟项目则走已有的 ix_tasks_is_labeled。故不建该索引 (避免无用索引的写放大)。

本项目所有迁移都跑在事务内 (env.py `do_run_migrations` 带 advisory lock + begin_transaction),
而 Postgres `CREATE INDEX CONCURRENTLY` 不能在事务内执行, 故此处用**普通建索引** + IF NOT EXISTS
(可重入)。dev / 中等规模表无锁压力。

⚠️ 生产侧若 tasks 已是大表 (建索引会锁写): DBA 应在低峰期**先手动**预建, 再跑迁移 (IF NOT
EXISTS → no-op):

    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_project_created_id
        ON tasks (project_id, created_at, id);
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_batch_unlabeled
        ON tasks (batch_id) WHERE is_labeled = false;

Revision ID: 0090
Revises: 0089
Create Date: 2026-06-02
"""

import sqlalchemy as sa
from alembic import op


revision = "0090"
down_revision = "0089"
branch_labels = None
depends_on = None


# (index_name, columns, partial_where_or_None)
_INDEXES: list[tuple[str, list[str], str | None]] = [
    ("ix_tasks_project_created_id", ["project_id", "created_at", "id"], None),
    ("ix_tasks_batch_unlabeled", ["batch_id"], "is_labeled = false"),
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
