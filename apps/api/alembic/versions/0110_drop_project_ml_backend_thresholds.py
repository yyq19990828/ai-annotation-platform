"""v0.19.0 · 退役 project_ml_backend 的 box/text 阈值覆盖

per-backend 项目级阈值覆盖(box_threshold/text_threshold)是 ADR-0044 大爆炸重构时
顺手加的字段, 但从未被推理路径消费(批量预标读项目级单值 project.box_threshold), 且属于
错误抽象 —— backend 的可调参数本就由协议 /setup.params 自描述、运行时通用渲染, 不应在
项目启用关联里硬编两个 GroundingDINO 专属字段。移除该覆盖(UI + schema + 这两列)。

保留 enabled(核心启用开关)与 default_variants(变体覆盖, 留作未来落点)。
downgrade 重建为可空列(不还原历史值; 重构未发布, 实际无历史值)。

Revision ID: 0110
Revises: 0109
Create Date: 2026-06-29
"""

import sqlalchemy as sa
from alembic import op

revision = "0110"
down_revision = "0109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("project_ml_backend", "box_threshold")
    op.drop_column("project_ml_backend", "text_threshold")


def downgrade() -> None:
    op.add_column(
        "project_ml_backend",
        sa.Column("box_threshold", sa.Float(), nullable=True),
    )
    op.add_column(
        "project_ml_backend",
        sa.Column("text_threshold", sa.Float(), nullable=True),
    )
