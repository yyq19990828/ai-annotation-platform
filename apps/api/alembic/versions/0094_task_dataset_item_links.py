"""v0.13.0 · task_dataset_item_links（点云多文件关联中间表）

一个点云任务可关联主点云 (role=primary_lidar) 与多路相机图像
(role=camera_<name>)。同一 task 同一 role 唯一。纯新增，不动现有 2D 流程。

Revision ID: 0094
Revises: 0093
Create Date: 2026-06-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0094"
down_revision = "0093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_dataset_item_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dataset_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dataset_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("sensor_name", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "task_id",
            "role",
            name="uq_task_dataset_item_links_task_role",
        ),
    )
    op.create_index(
        "ix_task_dataset_item_links_task_id",
        "task_dataset_item_links",
        ["task_id"],
    )
    op.create_index(
        "ix_task_dataset_item_links_dataset_item_id",
        "task_dataset_item_links",
        ["dataset_item_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_task_dataset_item_links_dataset_item_id",
        table_name="task_dataset_item_links",
    )
    op.drop_index(
        "ix_task_dataset_item_links_task_id",
        table_name="task_dataset_item_links",
    )
    op.drop_table("task_dataset_item_links")
