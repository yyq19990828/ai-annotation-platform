"""v0.14.0 · scenes 表 + dataset_items.scene_id / frame_index

跨 task 帧序列地基:
- 新表 scenes(display_id "SCN-N", dataset_id FK CASCADE, 同 dataset 下 name 唯一)
- dataset_items 加 scene_id (FK scenes SET NULL) + frame_index (int)
- 复合索引 idx_dataset_items_scene_frame on (scene_id, frame_index) 给 neighbors 查询
- 不加 UNIQUE(scene_id, frame_index):多模态同帧 lidar/cam 共享 frame_index;
  calib 等 scene-level 元数据需要 frame_index=NULL 多行共存

向后兼容:scene_id/frame_index 均 nullable,历史 dataset_items 不动;
backfill 走 scripts/backfill_scenes.py (人工 review,非 migration 内自动重写数据)

Revision ID: 0096
Revises: 0095
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0096"
down_revision = "0095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS display_seq_scenes")

    op.create_table(
        "scenes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("display_id", sa.String(20), nullable=False, unique=True),
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_format", sa.String(50), nullable=True),
        sa.Column(
            "source_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("dataset_id", "name", name="uq_scenes_dataset_name"),
    )
    op.create_index("ix_scenes_dataset_id", "scenes", ["dataset_id"])

    op.add_column(
        "dataset_items",
        sa.Column("scene_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "dataset_items",
        sa.Column("frame_index", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_dataset_items_scene",
        "dataset_items",
        "scenes",
        ["scene_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_dataset_items_scene_frame",
        "dataset_items",
        ["scene_id", "frame_index"],
    )


def downgrade() -> None:
    op.drop_index("idx_dataset_items_scene_frame", table_name="dataset_items")
    op.drop_constraint("fk_dataset_items_scene", "dataset_items", type_="foreignkey")
    op.drop_column("dataset_items", "frame_index")
    op.drop_column("dataset_items", "scene_id")
    op.drop_index("ix_scenes_dataset_id", table_name="scenes")
    op.drop_table("scenes")
    op.execute("DROP SEQUENCE IF EXISTS display_seq_scenes")
