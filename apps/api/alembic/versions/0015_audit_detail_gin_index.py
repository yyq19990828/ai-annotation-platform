"""v0.5.5 phase 2: audit_logs.detail_json GIN 索引

为 detail_json 字段级 `@>` 过滤提速。
SQLite / 其它非 PG 走 noop（保持测试环境便携）。

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-30
"""

from alembic import op


revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.create_index(
        "ix_audit_logs_detail_json_gin",
        "audit_logs",
        ["detail_json"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.drop_index("ix_audit_logs_detail_json_gin", table_name="audit_logs")
