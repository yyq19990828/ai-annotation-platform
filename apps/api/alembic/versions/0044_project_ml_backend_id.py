"""v0.8.6 F3 · projects.ml_backend_id 外键（项目 ↔ MLBackend 真实绑定）

ON DELETE SET NULL：删除 backend 时项目不删除，UI 显示「未绑定」。
当前所有项目 ml_backend_id=NULL；ai_model 字段保留为 display hint。

Revision ID: 0044
Revises: 0043
Create Date: 2026-05-07
"""

from alembic import op


revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS ml_backend_id UUID
        REFERENCES ml_backends(id) ON DELETE SET NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_projects_ml_backend_id "
        "ON projects (ml_backend_id) WHERE ml_backend_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_projects_ml_backend_id")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS ml_backend_id")
