"""v0.6.0: 用户内嵌式 Bug 反馈系统

bug_reports 表：结构化反馈数据，支持 AI 消费（Markdown 端点）。
bug_comments 表：反馈讨论线程。

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bug_reports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("display_id", sa.String(20), nullable=False, unique=True),
        sa.Column("reporter_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("route", sa.String(256), nullable=False),
        sa.Column("user_role", sa.String(32), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("severity", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(16), nullable=False, server_default="new", index=True),
        sa.Column("duplicate_of_id", UUID(as_uuid=True), sa.ForeignKey("bug_reports.id"), nullable=True),
        sa.Column("browser_ua", sa.Text, nullable=True),
        sa.Column("viewport", sa.String(20), nullable=True),
        sa.Column("recent_api_calls", JSONB, nullable=True),
        sa.Column("recent_console_errors", JSONB, nullable=True),
        sa.Column("screenshot_url", sa.String(512), nullable=True),
        sa.Column("resolution", sa.Text, nullable=True),
        sa.Column("fixed_in_version", sa.String(20), nullable=True),
        sa.Column("assigned_to_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        sa.Column("triaged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fixed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "bug_comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("bug_report_id", UUID(as_uuid=True), sa.ForeignKey("bug_reports.id"), nullable=False, index=True),
        sa.Column("author_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("bug_comments")
    op.drop_table("bug_reports")
