"""v0.10.49 · drop prediction_jobs（async_jobs 单一真值收敛 Phase 1）

prediction_jobs 专表自 v0.10.16 起与 async_jobs 双写双轨。v0.10.49 把 batch_predict
收敛为 async_jobs 单一真值：domain 字段（batch_id / ml_backend_id / prompt / 统计）
进 payload/result JSONB，worker 直接以 async_jobs 为工作状态。本迁移删除专表。

downgrade 重建表结构（与 0052 一致），但不回填已收敛进 async_jobs 的历史数据。

Revision ID: 0085
Revises: 0084
Create Date: 2026-05-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0085"
down_revision = "0084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "ix_prediction_jobs_celery_task_id", table_name="prediction_jobs"
    )
    op.drop_index(
        "ix_prediction_jobs_status_started", table_name="prediction_jobs"
    )
    op.drop_index(
        "ix_prediction_jobs_project_status_started",
        table_name="prediction_jobs",
    )
    op.drop_table("prediction_jobs")


def downgrade() -> None:
    op.create_table(
        "prediction_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "batch_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("task_batches.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "ml_backend_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ml_backends.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "output_mode", sa.String(30), nullable=False, server_default="mask"
        ),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="running"
        ),
        sa.Column("total_tasks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("total_cost", sa.Numeric(10, 4), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("celery_task_id", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name="ck_prediction_jobs_status",
        ),
    )
    op.create_index(
        "ix_prediction_jobs_project_status_started",
        "prediction_jobs",
        ["project_id", "status", sa.text("started_at DESC")],
    )
    op.create_index(
        "ix_prediction_jobs_status_started",
        "prediction_jobs",
        ["status", sa.text("started_at DESC")],
    )
    op.create_index(
        "ix_prediction_jobs_celery_task_id",
        "prediction_jobs",
        ["celery_task_id"],
    )
