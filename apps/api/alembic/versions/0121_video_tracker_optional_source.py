"""Video tracker: optional source annotation + explicit target category.

Revision ID: 0121
Revises: 0120

v0.22.1 · B 阶段入口解耦: 追踪 job 支持无源发起 (画布级文本/种子检测), annotation_id
放开为可空; 无源新建轨迹的类别由 target_class_name / target_tool_unit_id 显式指定
(缺省继承源轨迹)。存量 job 均有 annotation_id, 无需回填。
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0121"
down_revision = "0120"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "video_tracker_jobs",
        "annotation_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.add_column(
        "video_tracker_jobs",
        sa.Column("target_class_name", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "video_tracker_jobs",
        sa.Column("target_tool_unit_id", sa.String(length=30), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("video_tracker_jobs", "target_tool_unit_id")
    op.drop_column("video_tracker_jobs", "target_class_name")
    op.alter_column(
        "video_tracker_jobs",
        "annotation_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
