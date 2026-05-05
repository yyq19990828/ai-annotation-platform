"""v0.6.6 · audit_logs.request_id 字段持久化

之前同一 HTTP 请求的 metadata 行（AuditMiddleware 写）+ N 条业务 detail 行
（AuditService.log / log_many 写）通过 detail_json["request_id"] 注入；本次
改为顶层独立字段以支撑前端「按 request_id 折叠为单行 + ▸ 展开」UI，并加
B-tree 索引便于按 request_id 检索。

不回填存量行（旧行 request_id 仍 NULL，前端将每行单独成组）。

Revision ID: 0023
Revises: 0022
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "0023"
down_revision = "0022"


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("request_id", sa.String(36), nullable=True),
    )
    op.create_index("ix_audit_logs_request_id", "audit_logs", ["request_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_request_id", table_name="audit_logs")
    op.drop_column("audit_logs", "request_id")
