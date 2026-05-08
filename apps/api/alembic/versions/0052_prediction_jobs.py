"""v0.9.8 · prediction_jobs 表

完整 prediction job 历史。与 task_batches.status='pre_annotated' 当前快照
(/admin/preannotate-queue) 拆开：本表追前不追后，每次 batch_predict 跑都新增一行，
覆盖 running/completed/failed 三状态。/admin/preannotate-jobs 端点按此表列表，
/ai-pre/jobs 子页面渲染完整 job timeline（含已重置批次 / 失败 job）。

字段语义：
- celery_task_id: 用于 _BatchPredictTask.on_failure 回查 job 行写 error_message
- total_cost: v0.9.8 暂留 NULL（worker 未聚合 PredictionMeta.total_cost；下版接通）
- prompt: TEXT NOT NULL — 即便老 image-only batch（无文本 prompt）也存空串以便 ILIKE 搜索

Revision ID: 0052
Revises: 0051
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
            sa.ForeignKey("ml_backends.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "output_mode",
            sa.String(30),
            nullable=False,
            server_default="mask",
        ),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="running",
        ),
        sa.Column(
            "total_tasks", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "success_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "failed_count", sa.Integer(), nullable=False, server_default="0"
        ),
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


def downgrade() -> None:
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
