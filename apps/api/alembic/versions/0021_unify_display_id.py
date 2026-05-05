"""v0.6.4 · 统一 display_id 风格

把所有 entity 的 display_id 改造为「字母前缀 + 顺序号」：
- bug_reports: 已是 B-N（保持）
- tasks: T-{uuid[:6]} → T-N
- datasets: DS-{uuid[:6]} → D-N
- projects: P-{uuid[:4]} → P-N
- task_batches: B-{uuid[:6]} → BT-N（与 bug 区分）

策略:
1. 建 5 个 Postgres SEQUENCE（display_seq_<entity>）
2. 用 ROW_NUMBER OVER (ORDER BY created_at, id) 回填存量；保留 task_batches 的
   'B-DEFAULT' 哨兵不动
3. setval 同步序列至 MAX(N)+1
4. 给 projects/tasks/task_batches 补 UNIQUE 约束（之前不 unique）
5. 完整性自检：count = count distinct，否则 RAISE

downgrade:
- 删 sequence + unique 约束
- display_id 值不回滚（破坏性数据迁移，不可逆）

Revision ID: 0021
Revises: 0020
Create Date: 2026-05-01
"""

from alembic import op


revision = "0021"
down_revision = "0020"


_ENTITIES = ("bug_reports", "tasks", "datasets", "projects", "batches")

# (table, prefix, entity_for_seq, where_clause)
_BACKFILL_PLAN = [
    ("projects", "P", "projects", ""),
    ("datasets", "D", "datasets", ""),
    ("task_batches", "BT", "batches", "WHERE display_id != 'B-DEFAULT'"),
    ("tasks", "T", "tasks", ""),
]


def upgrade() -> None:
    # 1. 建序列
    for e in _ENTITIES:
        op.execute(f"CREATE SEQUENCE IF NOT EXISTS display_seq_{e}")

    # 2. 回填存量
    for table, prefix, _entity, where in _BACKFILL_PLAN:
        op.execute(f"""
            WITH numbered AS (
              SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n
              FROM {table} {where}
            )
            UPDATE {table} t SET display_id = '{prefix}-' || numbered.n
            FROM numbered WHERE t.id = numbered.id
        """)

    # 3. setval 同步序列
    #    bug_reports 单独算（已是 B-N，不在 _BACKFILL_PLAN）
    #    空表时用 setval(seq, 1, false) → 下次 nextval=1；
    #    有数据时用 setval(seq, MAX, true) → 下次 nextval=MAX+1。
    op.execute("""
        SELECT setval(
            'display_seq_bug_reports',
            COALESCE((SELECT MAX(CAST(SUBSTRING(display_id FROM 3) AS BIGINT))
                      FROM bug_reports), 1),
            EXISTS (SELECT 1 FROM bug_reports)
        )
    """)
    for table, prefix, entity, _where in _BACKFILL_PLAN:
        op.execute(f"""
            SELECT setval(
                'display_seq_{entity}',
                COALESCE((SELECT MAX(CAST(SPLIT_PART(display_id, '-', 2) AS BIGINT))
                          FROM {table}
                          WHERE display_id LIKE '{prefix}-%'
                            AND display_id != 'B-DEFAULT'), 1),
                EXISTS (SELECT 1 FROM {table}
                         WHERE display_id LIKE '{prefix}-%'
                           AND display_id != 'B-DEFAULT')
            )
        """)

    # 4. UNIQUE 约束
    #    - tasks / projects: 全局 unique
    #    - task_batches: (project_id, display_id) 复合 unique（每个 project 都有自己的
    #      'B-DEFAULT'，所以不能全局 unique）
    op.create_unique_constraint("uq_tasks_display_id", "tasks", ["display_id"])
    op.create_unique_constraint("uq_projects_display_id", "projects", ["display_id"])
    op.create_unique_constraint(
        "uq_task_batches_project_display",
        "task_batches",
        ["project_id", "display_id"],
    )

    # 5. 完整性自检
    for t in ("projects", "datasets", "tasks"):
        op.execute(f"""
            DO $$ BEGIN
              IF (SELECT COUNT(*) FROM {t}) <> (SELECT COUNT(DISTINCT display_id) FROM {t})
              THEN RAISE EXCEPTION 'display_id collision in {t} after backfill';
              END IF;
            END $$;
        """)
    # task_batches: 每 project 内 unique
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM (
              SELECT project_id, display_id, COUNT(*) c
              FROM task_batches GROUP BY project_id, display_id
            ) x WHERE c > 1
          )
          THEN RAISE EXCEPTION 'display_id collision in task_batches (project_id, display_id) after backfill';
          END IF;
        END $$;
    """)


def downgrade() -> None:
    op.drop_constraint("uq_projects_display_id", "projects", type_="unique")
    op.drop_constraint(
        "uq_task_batches_project_display", "task_batches", type_="unique"
    )
    op.drop_constraint("uq_tasks_display_id", "tasks", type_="unique")
    for e in _ENTITIES:
        op.execute(f"DROP SEQUENCE IF EXISTS display_seq_{e}")
    # NOTE: display_id 列值不回滚 —— 不可逆数据迁移
