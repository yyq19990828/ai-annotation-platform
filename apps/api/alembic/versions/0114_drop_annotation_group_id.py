"""v0.21.3 · 删除标注编组遗留列 (group_id / next_group_seq / cross_frame_group_seq)

标注编组 (Object Group, Ctrl+G 平等分组) 已整体下线, 跨帧同一对象统一到
annotations.track_id (ADR-0045)。本迁移删除全部编组遗留数据结构:

- 索引 ix_annotations_task_group(task_id, group_id) — 0075 建。
- annotations.group_id (BigInteger) — 0075 建; 存量跨帧链 (>=1e9) 已由 0113 回填
  到 track_id, 图片编组 (<1e9) 随功能下线一并弃。
- tasks.next_group_seq (Integer) — 0075 建; 唯一写入方 POST /annotations/group 已删。
- 全局序列 cross_frame_group_seq — 0097 建; box_3d 跨帧 group_id 高位段的取号器,
  已被 _new_track_id() 取代。

downgrade 逆序重建结构 (数据不可逆: 删列时 group_id/next_group_seq 值即丢失)。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0114"
down_revision = "0113"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_annotations_task_group", table_name="annotations")
    op.drop_column("annotations", "group_id")
    op.drop_column("tasks", "next_group_seq")
    op.execute("DROP SEQUENCE IF EXISTS cross_frame_group_seq")


def downgrade() -> None:
    op.execute(
        "CREATE SEQUENCE IF NOT EXISTS cross_frame_group_seq START WITH 1000000000"
    )
    op.add_column(
        "tasks",
        sa.Column(
            "next_group_seq",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "annotations",
        sa.Column("group_id", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ix_annotations_task_group",
        "annotations",
        ["task_id", "group_id"],
        unique=False,
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )
