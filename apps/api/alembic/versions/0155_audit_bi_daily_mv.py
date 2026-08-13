"""Add the daily audit BI materialized view.

Revision ID: 0155
Revises: 0154
"""

from collections.abc import Sequence

from alembic import op


revision = "0155"
down_revision = "0154"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE MATERIALIZED VIEW mv_audit_bi_daily AS
        SELECT
            (created_at AT TIME ZONE 'UTC')::date AS day,
            action,
            COALESCE(target_type, '') AS target_type,
            COALESCE(actor_role, '') AS actor_role,
            CASE
                WHEN status_code BETWEEN 200 AND 599 THEN (status_code / 100)::smallint
                ELSE 0::smallint
            END AS status_family,
            COUNT(*)::bigint AS event_count
        FROM audit_logs
        WHERE created_at < (
            date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        )
        GROUP BY day, action, target_type, actor_role, status_family
        WITH NO DATA
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX ix_mv_audit_bi_daily_pk ON mv_audit_bi_daily "
        "(day, action, target_type, actor_role, status_family)"
    )
    op.execute("CREATE INDEX ix_mv_audit_bi_daily_day ON mv_audit_bi_daily (day DESC)")
    op.execute("REFRESH MATERIALIZED VIEW mv_audit_bi_daily")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_audit_bi_daily")
