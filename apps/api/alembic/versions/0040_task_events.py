"""v0.8.4 · task_events 表（标注/审核耗时事件）

工作台 useSessionStats 在 task 切换 / submit 时本地缓冲，每 N 条 flush 到
POST /me/task-events:batch；该端点经 Celery 异步路径写入此表。

设计参考 ADR-0009：本期不分区，触发条件（行数 > 1M 或单月 INSERT > 100k）
满足后执行 Stage 2 月分区迁移（参考 ADR-0006 predictions 月分区方案）。

Revision ID: 0040
Revises: 0039
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=False),
        sa.Column("annotation_count", sa.Integer, server_default="0", nullable=False),
        sa.Column(
            "was_rejected",
            sa.Boolean,
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('annotate', 'review')", name="ck_task_events_kind"
        ),
        sa.CheckConstraint("duration_ms >= 0", name="ck_task_events_duration_nonneg"),
    )
    op.create_index(
        "ix_task_events_user_started",
        "task_events",
        ["user_id", sa.text("started_at DESC")],
    )
    op.create_index(
        "ix_task_events_project_started",
        "task_events",
        ["project_id", sa.text("started_at DESC")],
    )
    op.create_index(
        "ix_task_events_kind_started",
        "task_events",
        ["kind", sa.text("started_at DESC")],
    )
    op.create_index("ix_task_events_task", "task_events", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_events_task", table_name="task_events")
    op.drop_index("ix_task_events_kind_started", table_name="task_events")
    op.drop_index("ix_task_events_project_started", table_name="task_events")
    op.drop_index("ix_task_events_user_started", table_name="task_events")
    op.drop_table("task_events")
