"""v0.10.25 · Project.batch_summary 改持久化物化列

list_projects / get_project 此前每次实时 GROUP BY task_batches 计算
{total, assigned, in_review}。本迁移加 JSONB 列 + 一次性回填，counter 由
batch._sync_project_counters 在 batch 状态机变迁时写时维护。

Revision ID: 0079
Revises: 0078
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0079"
down_revision = "0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "batch_summary",
            postgresql.JSONB(),
            nullable=False,
            server_default="{}",
        ),
    )
    # 一次性回填：复用原实时 GROUP BY 语义
    op.execute(
        """
        UPDATE projects p
        SET batch_summary = COALESCE((
            SELECT jsonb_build_object(
                'total', COUNT(*),
                'assigned', COUNT(*) FILTER (WHERE tb.annotator_id IS NOT NULL),
                'in_review', COUNT(*) FILTER (WHERE tb.status = 'reviewing')
            )
            FROM task_batches tb
            WHERE tb.project_id = p.id
        ), '{}'::jsonb)
        """
    )


def downgrade() -> None:
    op.drop_column("projects", "batch_summary")
