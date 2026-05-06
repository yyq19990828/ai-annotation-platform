"""v0.8.4 · 物化视图 mv_user_perf_daily（效率看板核心数据源）

每小时第 5 分钟由 Celery beat `refresh_user_perf_mv` REFRESH CONCURRENTLY。
端点优先读视图；当日热数据用「视图 ∪ 直查 task_events 当日」联合，避免视图 lag
（≤ 1 小时）影响实时性。

Revision ID: 0041
Revises: 0040
Create Date: 2026-05-06
"""

from alembic import op


revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE MATERIALIZED VIEW mv_user_perf_daily AS
        SELECT
            user_id,
            project_id,
            kind,
            (date_trunc('day', started_at AT TIME ZONE 'UTC'))::date AS day,
            COUNT(*) AS event_count,
            SUM(annotation_count) AS throughput,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::int AS median_duration_ms,
            (percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_duration_ms,
            SUM(CASE WHEN was_rejected THEN 1 ELSE 0 END) AS rejected_n,
            (SUM(duration_ms)::bigint / 60000)::int AS active_minutes
        FROM task_events
        GROUP BY user_id, project_id, kind, day
        WITH NO DATA
        """
    )
    # CONCURRENTLY 要求唯一索引；一并建普通索引服务于过滤
    op.execute(
        "CREATE UNIQUE INDEX ix_mv_user_perf_daily_pk ON mv_user_perf_daily "
        "(user_id, project_id, kind, day)"
    )
    op.execute(
        "CREATE INDEX ix_mv_user_perf_daily_user_day ON mv_user_perf_daily "
        "(user_id, day DESC)"
    )
    op.execute(
        "CREATE INDEX ix_mv_user_perf_daily_project_day ON mv_user_perf_daily "
        "(project_id, day DESC)"
    )
    # 首次填充（task_events 此刻应为空表）
    op.execute("REFRESH MATERIALIZED VIEW mv_user_perf_daily")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_user_perf_daily")
