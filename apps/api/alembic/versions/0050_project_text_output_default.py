"""v0.9.5 · projects.text_output_default

把 v0.9.4 phase 2 的 sessionStorage 兜底（`wb:sam:textOutput:{projectId}`）转持久化。

- text_output_default VARCHAR(10) NULLABLE：null = 走智能默认（按 type_key），
  否则覆盖工作台 SamTextPanel 的初始 outputMode。
- CHECK in ('box', 'mask', 'both', NULL)

Revision ID: 0050
Revises: 0049
Create Date: 2026-05-08
"""

from alembic import op


revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE projects "
        "ADD COLUMN IF NOT EXISTS text_output_default VARCHAR(10) NULL"
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'ck_projects_text_output_default_value'
          ) THEN
            ALTER TABLE projects
            ADD CONSTRAINT ck_projects_text_output_default_value
            CHECK (text_output_default IS NULL OR text_output_default IN ('box', 'mask', 'both'));
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_text_output_default_value"
    )
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS text_output_default")
