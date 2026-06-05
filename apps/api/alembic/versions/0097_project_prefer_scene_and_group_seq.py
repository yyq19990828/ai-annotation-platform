"""v0.14.1 · projects.prefer_same_scene_continuation + cross_frame_group_seq

跨帧目标延续 UX 地基:
- projects 加 prefer_same_scene_continuation(bool, default false)+
  scene_continuation_window_min(int, default 30):scheduler scene 连续标注开关。
  默认 OFF,既有项目零回归。
- 全局序列 cross_frame_group_seq(START 1000000000):跨帧 propagate 复制目标共享
  的 group_id 从这里取,高位起始保证与 per-task tasks.next_group_seq(小整数)
  永不冲突,同 scene 跨帧 overlay 按 group_id 匹配不会误命中无关分组。

Revision ID: 0097
Revises: 0096
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0097"
down_revision = "0096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "prefer_same_scene_continuation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "scene_continuation_window_min",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("30"),
        ),
    )
    op.execute(
        "CREATE SEQUENCE IF NOT EXISTS cross_frame_group_seq START WITH 1000000000"
    )


def downgrade() -> None:
    op.execute("DROP SEQUENCE IF EXISTS cross_frame_group_seq")
    op.drop_column("projects", "scene_continuation_window_min")
    op.drop_column("projects", "prefer_same_scene_continuation")
