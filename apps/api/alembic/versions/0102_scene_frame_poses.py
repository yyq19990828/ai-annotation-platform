"""v0.15.0 · scene_frame_poses 表(逐帧 ego pose + 时间戳)

scene 的时序骨架:
- 新表 scene_frame_poses,grain = (scene_id, frame_index),一帧一行
- ego_translation [x,y,z] / ego_rotation [w,x,y,z] 存 ego→global(世界系)原始位姿,
  跨帧相对位移由消费方算(inv(pose_i) @ pose_j),不预存
- timestamp_us 取主帧时钟(nuScenes 为 LIDAR_TOP 的 sample_data.timestamp,微秒)
- 不需要 display_id:非用户实体
- 复合唯一 uq_scene_frame_pose(scene_id, frame_index) 兼做"按 scene 取轨迹"的索引

向后兼容:历史 scene 无位姿 → 无行;消费方按"无轨迹"降级,不报错。

Revision ID: 0102
Revises: 0101
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0102"
down_revision = "0101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scene_frame_poses",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "scene_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("scenes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("frame_index", sa.Integer(), nullable=False),
        sa.Column("timestamp_us", sa.BigInteger(), nullable=True),
        sa.Column(
            "ego_translation",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "ego_rotation",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "source_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("scene_id", "frame_index", name="uq_scene_frame_pose"),
    )


def downgrade() -> None:
    op.drop_table("scene_frame_poses")
