"""v0.9.2 · projects.box_threshold / text_threshold

Grounded-SAM-2 的 GroundingDINO 阈值（box / text）以前由 backend env 全局控制；
不同业务图（车牌 / 商品 / 卫星）召回率差异大，需要项目级 override。

- box_threshold REAL NOT NULL DEFAULT 0.35
- text_threshold REAL NOT NULL DEFAULT 0.25
- CHECK 0 ≤ value ≤ 1

Revision ID: 0048
Revises: 0047
Create Date: 2026-05-07
"""

from alembic import op


revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE projects "
        "ADD COLUMN IF NOT EXISTS box_threshold REAL NOT NULL DEFAULT 0.35"
    )
    op.execute(
        "ALTER TABLE projects "
        "ADD COLUMN IF NOT EXISTS text_threshold REAL NOT NULL DEFAULT 0.25"
    )
    # Postgres 没有 ADD CONSTRAINT IF NOT EXISTS；用 DO 块做幂等
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'ck_projects_box_threshold_range'
          ) THEN
            ALTER TABLE projects
            ADD CONSTRAINT ck_projects_box_threshold_range
            CHECK (box_threshold >= 0 AND box_threshold <= 1);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'ck_projects_text_threshold_range'
          ) THEN
            ALTER TABLE projects
            ADD CONSTRAINT ck_projects_text_threshold_range
            CHECK (text_threshold >= 0 AND text_threshold <= 1);
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_box_threshold_range"
    )
    op.execute(
        "ALTER TABLE projects DROP CONSTRAINT IF EXISTS ck_projects_text_threshold_range"
    )
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS text_threshold")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS box_threshold")
