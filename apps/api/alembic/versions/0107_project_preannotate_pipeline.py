"""项目级「已保存的编排」: projects.preannotate_pipeline JSONB nullable（方案 A）

一项目一条 pipeline_stages 形状的编排, 供 popover「运行当前题（按项目编排）」读取。
NULL = 未配编排。纯加列, 无数据迁移。

Revision ID: 0107
Revises: 0106
Create Date: 2026-06-26
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0107"
down_revision = "0106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "preannotate_pipeline",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "preannotate_pipeline")
