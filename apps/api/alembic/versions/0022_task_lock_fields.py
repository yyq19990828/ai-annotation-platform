"""v0.6.5 · 任务锁定状态机字段

为 tasks 表新增 7 列以支撑「提交质检后锁定 / 标注员撤回 / 审核员认领 /
审核结束 / 标注员重开」状态机：

- submitted_at: 最近一次 submit 时间
- reviewer_id: 第一个 claim 的审核员（approve/reject 后保持）
- reviewer_claimed_at: 撤回门控字段（NULL 时标注员可撤回）
- reviewed_at: approve/reject 落定时间
- reject_reason: reject 时的原因（之前接收 body 但未持久化）
- reopened_count: 标注员单方面重开次数
- last_reopened_at: 最近一次 reopen 时间

不回填存量。reviewer_id 用 SET NULL on delete 与 audit_logs 一致。

Revision ID: 0022
Revises: 0021
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0022"
down_revision = "0021"


def upgrade() -> None:
    op.add_column("tasks", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("reviewer_id", UUID(as_uuid=True), nullable=True))
    op.add_column("tasks", sa.Column("reviewer_claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("reject_reason", sa.String(2000), nullable=True))
    op.add_column(
        "tasks",
        sa.Column("reopened_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("tasks", sa.Column("last_reopened_at", sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        "fk_tasks_reviewer_id_users",
        "tasks",
        "users",
        ["reviewer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_tasks_reviewer_id", "tasks", ["reviewer_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_reviewer_id", table_name="tasks")
    op.drop_constraint("fk_tasks_reviewer_id_users", "tasks", type_="foreignkey")
    op.drop_column("tasks", "last_reopened_at")
    op.drop_column("tasks", "reopened_count")
    op.drop_column("tasks", "reject_reason")
    op.drop_column("tasks", "reviewed_at")
    op.drop_column("tasks", "reviewer_claimed_at")
    op.drop_column("tasks", "reviewer_id")
    op.drop_column("tasks", "submitted_at")
