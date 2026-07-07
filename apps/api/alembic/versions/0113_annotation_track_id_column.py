"""v0.21.2 · ADR-0045 · annotation.track_id 表列 + 存量回填

跨帧对象标识从「video geometry 内 track_id + box_3d 借 group_id>=1e9」两套统一到
annotation.track_id 通用表列 (几何类型无关)。

回填两步:
1. geometry 内 track_id (交互式/检测式 video_track_bbox) → 列。
2. 存量跨帧链 (group_id >= 1e9, 主要是 box_3d) 按每链生成一个 trk_<hex> 回填
   (cross_frame_group_seq 是全局序列, 故 group_id>=1e9 全局唯一, 按 group_id 分链即可)。

本迁移只加列 + 回填, 不动 group_id / cross_frame_group_seq (那在后续 Phase)。

Revision ID: 0113
Revises: 0112
Create Date: 2026-07-03
"""

import sqlalchemy as sa
from alembic import op

revision = "0113"
down_revision = "0112"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("track_id", sa.String(64), nullable=True),
    )
    op.create_index("ix_annotations_track_id", "annotations", ["track_id"])

    # [1] geometry 内 track_id (video_track_bbox) → 列。opaque 字符串原样迁入
    # (旧交互式带横杠 / 新检测式 hex 均保留, 唯一性不受影响)。
    op.execute(
        """
        UPDATE annotations
        SET track_id = geometry->>'track_id'
        WHERE geometry->>'track_id' IS NOT NULL
          AND track_id IS NULL;
        """
    )

    # [2] 存量跨帧链 (group_id >= 1e9) 按链回填新 track_id。MATERIALIZED 强制 CTE
    # 只算一次, 否则 volatile gen_random_uuid() 被内联会对同链每行重算 → 破坏
    # 「同链共享一个 track_id」。
    op.execute(
        """
        WITH chains AS (
            SELECT DISTINCT group_id
            FROM annotations
            WHERE group_id >= 1000000000 AND track_id IS NULL
        ),
        assigned AS MATERIALIZED (
            SELECT group_id,
                   'trk_' || replace(gen_random_uuid()::text, '-', '') AS new_tid
            FROM chains
        )
        UPDATE annotations a
        SET track_id = assigned.new_tid
        FROM assigned
        WHERE a.group_id = assigned.group_id
          AND a.group_id >= 1000000000
          AND a.track_id IS NULL;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_annotations_track_id", table_name="annotations")
    op.drop_column("annotations", "track_id")
