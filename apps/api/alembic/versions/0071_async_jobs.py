"""统一 async_jobs 表 (v0.10.16, ROADMAP §1.7 MVP)

汇总索引层：所有长任务 (batch_predict / video_tracker / audit_archive /
predictions_import) 在 enqueue/progress/finish 三时点写入此表。专表保留为
domain 真值（双写双轨）。前端任务铃铛只读此表。

Revision ID: 0071
Revises: 0070
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "async_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "progress_pct", sa.Integer, nullable=False, server_default="0"
        ),
        sa.Column(
            "payload",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "result",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("celery_task_id", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_async_jobs_user_status_created",
        "async_jobs",
        ["user_id", "status", "created_at"],
    )
    op.create_index(
        "ix_async_jobs_project_kind_status",
        "async_jobs",
        ["project_id", "kind", "status"],
    )
    op.create_index(
        "ix_async_jobs_celery_task", "async_jobs", ["celery_task_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_async_jobs_celery_task", table_name="async_jobs")
    op.drop_index("ix_async_jobs_project_kind_status", table_name="async_jobs")
    op.drop_index("ix_async_jobs_user_status_created", table_name="async_jobs")
    op.drop_table("async_jobs")
