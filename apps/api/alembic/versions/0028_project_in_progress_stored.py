"""v0.7.0 · Project.in_progress_tasks 改持久化列

v0.6.7-hotfix 用即时 COUNT 实现 in_progress 计数，列项目时每行多一次 SQL。
本迁移加列 + 一次性回填，counter 由 batch._sync_project_counters 在状态机变迁时维护。

Revision ID: 0028
Revises: 0027
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "in_progress_tasks",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    # 一次性回填
    op.execute(
        """
        UPDATE projects p
        SET in_progress_tasks = COALESCE((
            SELECT COUNT(*)
            FROM tasks t
            WHERE t.project_id = p.id
              AND t.status = 'in_progress'
        ), 0)
        """
    )


def downgrade() -> None:
    op.drop_column("projects", "in_progress_tasks")
