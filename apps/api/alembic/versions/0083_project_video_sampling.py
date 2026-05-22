"""v0.10.29 · 项目级视频帧逻辑采样配置 video_sampling JSONB

projects 加 video_sampling (JSONB, server_default '{}')。
{} = 不采样 (step=1); 或 {"mode":"fps","target_fps":10} / {"mode":"step","frame_step":5}。
frame_index 永远存源视频帧号 (决策 D2), 采样只是导航/打点视图层。

Revision ID: 0083
Revises: 0082
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0083"
down_revision = "0082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "video_sampling",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "video_sampling")
