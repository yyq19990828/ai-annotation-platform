"""v0.11.27 · 移除 annotations.is_occluded 状态位

遮挡能力收敛进属性 schema（boolean 字段 + style_occluded 标记），
旧的图片侧 is_occluded 状态位（M4-β I15）已无消费方，删除该列。
注：视频侧遮挡走 keyframe.occluded，与此列无关，不受影响。

Revision ID: 0088
Revises: 0087
Create Date: 2026-05-30
"""

import sqlalchemy as sa
from alembic import op


revision = "0088"
down_revision = "0087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("annotations", "is_occluded")


def downgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column(
            "is_occluded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
