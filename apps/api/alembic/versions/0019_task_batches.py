"""v0.6.1: 大数据集分包 / 批次工作流

task_batches 表 + tasks.batch_id FK + 默认批次回填。

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0019"
down_revision = "0018"


def upgrade() -> None:
    op.create_table(
        "task_batches",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "dataset_id",
            UUID(as_uuid=True),
            sa.ForeignKey("datasets.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("display_id", sa.String(30), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("priority", sa.Integer, server_default="50"),
        sa.Column("deadline", sa.Date, nullable=True),
        sa.Column("assigned_user_ids", JSONB, server_default="[]"),
        sa.Column("total_tasks", sa.Integer, server_default="0"),
        sa.Column("completed_tasks", sa.Integer, server_default="0"),
        sa.Column("review_tasks", sa.Integer, server_default="0"),
        sa.Column("approved_tasks", sa.Integer, server_default="0"),
        sa.Column("rejected_tasks", sa.Integer, server_default="0"),
        sa.Column(
            "created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_task_batches_project_status", "task_batches", ["project_id", "status"]
    )

    op.add_column(
        "tasks",
        sa.Column(
            "batch_id",
            UUID(as_uuid=True),
            sa.ForeignKey("task_batches.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )

    # 回填：为每个现存 project 创建一个默认批次，并把该 project 下的 tasks 关联过去
    conn = op.get_bind()
    projects = conn.execute(
        sa.text(
            "SELECT id, owner_id, total_tasks, completed_tasks, review_tasks "
            "FROM projects"
        )
    ).fetchall()

    for proj in projects:
        pid, owner_id, total, completed, review = proj
        result = conn.execute(
            sa.text(
                "INSERT INTO task_batches "
                "(project_id, display_id, name, status, total_tasks, completed_tasks, review_tasks, created_by) "
                "VALUES (:pid, 'B-DEFAULT', '默认批次', 'active', :total, :completed, :review, :owner) "
                "RETURNING id"
            ),
            {
                "pid": pid,
                "total": total or 0,
                "completed": completed or 0,
                "review": review or 0,
                "owner": owner_id,
            },
        )
        batch_id = result.scalar()
        conn.execute(
            sa.text("UPDATE tasks SET batch_id = :bid WHERE project_id = :pid"),
            {"bid": batch_id, "pid": pid},
        )


def downgrade() -> None:
    op.drop_column("tasks", "batch_id")
    op.drop_index("ix_task_batches_project_status", table_name="task_batches")
    op.drop_table("task_batches")
