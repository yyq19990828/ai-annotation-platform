"""v0.5.5 phase 2: project.iou_dedup_threshold

把工作台 AI 框 IoU 视觉去重阈值（v0.5.2 起硬编码 0.7）提到 Project 级，
项目设置页可调。范围 0.30~0.95，默认 0.7。

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "iou_dedup_threshold",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0.7"),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "iou_dedup_threshold")
