"""v0.10.25 · predictions 改为按月 RANGE 分区表（ADR-0006 Stage 2）

设计 / 触发阈值见 ADR-0006（单月 INSERT > 100k 或总行数 > 1M）。本迁移提前布局，
dev 应用验证；生产侧仍按阈值触发执行（届时迁移已 battle-tested）。

迁移策略（参考 0037 audit_logs）：
  1. DROP 引用 predictions 的两个 FK（prediction_metas / annotations）
  2. prediction_metas 加 prediction_created_at 冗余列并从 predictions 回填
  3. predictions → predictions_legacy + 重命名其 schema 级索引避免冲突
  4. 建 RANGE(created_at) 分区父表（PK 改为 (id, created_at)，分区键必须进 PK）
     + 重建索引 + 重建出站 FK（task/project/ml_backend）
  5. 预建 [min(created_at) 所在月, 当前月+3] 子分区
  6. INSERT INTO predictions SELECT * FROM predictions_legacy
  7. DROP predictions_legacy
  8. 复合 FK 收口：prediction_metas (prediction_id, prediction_created_at) → predictions(id, created_at)

annotations.parent_prediction_id 决策：**降级为软引用，不重建 FK**。该列在 100w+ 行大表上，
且业务侧已手动管理（删 prediction 前先 NULL，见 batch.py / projects.py / admin_preannotate.py），
重建复合 FK 需在大表加列 + 回填 + 校验，锁表代价高且收益低，故 Stage 2 仅 DROP 其 FK。

Revision ID: 0080
Revises: 0079
Create Date: 2026-05-20
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import sqlalchemy as sa
from alembic import op


revision = "0080"
down_revision = "0079"
branch_labels = None
depends_on = None


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _next_month(d: date) -> date:
    if d.month == 12:
        return d.replace(year=d.year + 1, month=1, day=1)
    return d.replace(month=d.month + 1, day=1)


def _partition_name(d: date) -> str:
    return f"predictions_y{d.year}m{d.month:02d}"


def _create_partition_sql(d: date) -> str:
    start = d.isoformat()
    end = _next_month(d).isoformat()
    return (
        f"CREATE TABLE IF NOT EXISTS {_partition_name(d)} PARTITION OF predictions "
        f"FOR VALUES FROM ('{start}') TO ('{end}')"
    )


def upgrade() -> None:
    bind = op.get_bind()

    # 1. DROP 引用 predictions 的入站 FK（之后 predictions 主键将变为复合，单列 FK 无法引用）
    op.execute(
        "ALTER TABLE prediction_metas DROP CONSTRAINT IF EXISTS "
        "prediction_metas_prediction_id_fkey"
    )
    op.execute(
        "ALTER TABLE annotations DROP CONSTRAINT IF EXISTS "
        "annotations_parent_prediction_id_fkey"
    )

    # 2. prediction_metas 加冗余分区键列 + 回填（必须在 rename 前 join 原 predictions）
    op.execute("ALTER TABLE prediction_metas ADD COLUMN prediction_created_at TIMESTAMPTZ")
    op.execute(
        "UPDATE prediction_metas pm SET prediction_created_at = p.created_at "
        "FROM predictions p WHERE pm.prediction_id = p.id"
    )

    # 3. 重命名旧表 + 重命名 schema 级索引（PG 不会自动重命名 index）
    op.execute("ALTER TABLE predictions RENAME TO predictions_legacy")
    for old, new in [
        ("predictions_pkey", "predictions_legacy_pkey"),
        ("ix_predictions_created_at", "ix_predictions_legacy_created_at"),
        ("ix_predictions_source", "ix_predictions_legacy_source"),
        ("ix_predictions_task_id", "ix_predictions_legacy_task_id"),
        ("ix_predictions_project_id", "ix_predictions_legacy_project_id"),
    ]:
        op.execute(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}")

    # 4. 建分区父表（PARTITION BY RANGE (created_at)，PK = (id, created_at)）
    op.execute(
        """
        CREATE TABLE predictions (
            id UUID NOT NULL,
            task_id UUID NOT NULL,
            project_id UUID NOT NULL,
            ml_backend_id UUID,
            model_version VARCHAR(100),
            score DOUBLE PRECISION,
            tool_unit_id VARCHAR(30) NOT NULL DEFAULT 'bbox',
            result JSONB NOT NULL,
            cluster INTEGER,
            mislabeling DOUBLE PRECISION,
            source VARCHAR(20) NOT NULL DEFAULT 'ml_backend',
            rejected_shape_indexes JSONB NOT NULL DEFAULT '[]',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (id, created_at),
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (ml_backend_id) REFERENCES ml_backends(id) ON DELETE SET NULL
        ) PARTITION BY RANGE (created_at)
        """
    )
    # 索引自动级联到所有子分区
    op.execute("CREATE INDEX ix_predictions_created_at ON predictions (created_at)")
    op.execute("CREATE INDEX ix_predictions_source ON predictions (source)")
    op.execute("CREATE INDEX ix_predictions_task_id ON predictions (task_id)")
    op.execute("CREATE INDEX ix_predictions_project_id ON predictions (project_id)")

    # 5. 预建子分区：从 legacy 最早月份（含）到当前月 + 3
    res = bind.execute(sa.text("SELECT MIN(created_at) FROM predictions_legacy"))
    row = res.first()
    min_created_at = row[0] if row and row[0] else datetime.now(timezone.utc)
    today = datetime.now(timezone.utc).date()
    cur = _month_floor(min_created_at.date())
    end = _next_month(_next_month(_next_month(_month_floor(today))))  # current + 3
    while cur < end:
        op.execute(_create_partition_sql(cur))
        cur = _next_month(cur)

    # 5b. DEFAULT 分区兜底：predictions 不同于 audit_logs（纯 append now()），会有回填 /
    # predictions_import 历史时间戳 / 测试 backdate 等超出预建月份范围的行，全部落 default，
    # 避免 "no partition found for row"。月度 cron 仅补未来分区，default 不影响其正确性。
    op.execute("CREATE TABLE predictions_default PARTITION OF predictions DEFAULT")

    # 6. 数据迁移
    op.execute(
        """
        INSERT INTO predictions (
            id, task_id, project_id, ml_backend_id, model_version, score,
            tool_unit_id, result, cluster, mislabeling, source,
            rejected_shape_indexes, created_at
        )
        SELECT
            id, task_id, project_id, ml_backend_id, model_version, score,
            tool_unit_id, result, cluster, mislabeling, source,
            rejected_shape_indexes, created_at
        FROM predictions_legacy
        """
    )

    # 7. 删除 legacy（CASCADE 清掉 legacy 索引；入站 FK 已在步骤 1 DROP）
    op.execute("DROP TABLE predictions_legacy CASCADE")

    # 8. 复合 FK 收口（仅 prediction_metas；annotations 降级软引用不重建）
    op.execute(
        "ALTER TABLE prediction_metas ADD CONSTRAINT prediction_metas_prediction_fkey "
        "FOREIGN KEY (prediction_id, prediction_created_at) "
        "REFERENCES predictions(id, created_at)"
    )


def downgrade() -> None:
    """回滚：分区表回展平为普通表。**生产慎用** —— 大表数据迁移会锁表。"""
    op.execute(
        "ALTER TABLE prediction_metas DROP CONSTRAINT IF EXISTS "
        "prediction_metas_prediction_fkey"
    )

    op.execute("ALTER TABLE predictions RENAME TO predictions_partitioned_tmp")
    for old, new in [
        ("predictions_pkey", "predictions_partitioned_pkey"),
        ("ix_predictions_created_at", "ix_predictions_partitioned_created_at"),
        ("ix_predictions_source", "ix_predictions_partitioned_source"),
        ("ix_predictions_task_id", "ix_predictions_partitioned_task_id"),
        ("ix_predictions_project_id", "ix_predictions_partitioned_project_id"),
    ]:
        op.execute(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}")

    op.execute(
        """
        CREATE TABLE predictions (
            id UUID NOT NULL PRIMARY KEY,
            task_id UUID NOT NULL,
            project_id UUID NOT NULL,
            ml_backend_id UUID,
            model_version VARCHAR(100),
            score DOUBLE PRECISION,
            tool_unit_id VARCHAR(30) NOT NULL DEFAULT 'bbox',
            result JSONB NOT NULL,
            cluster INTEGER,
            mislabeling DOUBLE PRECISION,
            source VARCHAR(20) NOT NULL DEFAULT 'ml_backend',
            rejected_shape_indexes JSONB NOT NULL DEFAULT '[]',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (ml_backend_id) REFERENCES ml_backends(id) ON DELETE SET NULL
        )
        """
    )
    op.execute("CREATE INDEX ix_predictions_created_at ON predictions (created_at)")
    op.execute("CREATE INDEX ix_predictions_source ON predictions (source)")
    op.execute("CREATE INDEX ix_predictions_task_id ON predictions (task_id)")
    op.execute("CREATE INDEX ix_predictions_project_id ON predictions (project_id)")
    op.execute(
        """
        INSERT INTO predictions (
            id, task_id, project_id, ml_backend_id, model_version, score,
            tool_unit_id, result, cluster, mislabeling, source,
            rejected_shape_indexes, created_at
        )
        SELECT
            id, task_id, project_id, ml_backend_id, model_version, score,
            tool_unit_id, result, cluster, mislabeling, source,
            rejected_shape_indexes, created_at
        FROM predictions_partitioned_tmp
        """
    )
    op.execute("DROP TABLE predictions_partitioned_tmp CASCADE")

    # 还原单列 FK
    op.execute(
        "ALTER TABLE prediction_metas DROP COLUMN IF EXISTS prediction_created_at"
    )
    op.execute(
        "ALTER TABLE prediction_metas ADD CONSTRAINT prediction_metas_prediction_id_fkey "
        "FOREIGN KEY (prediction_id) REFERENCES predictions(id)"
    )
    op.execute(
        "ALTER TABLE annotations ADD CONSTRAINT annotations_parent_prediction_id_fkey "
        "FOREIGN KEY (parent_prediction_id) REFERENCES predictions(id)"
    )
