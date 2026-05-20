"""导出产物缓存表 export_artifacts（2026-05-20 计划 §3，阶段 2）

cache_key → MinIO 桶内产物映射，做导出去重缓存。cache_key 唯一索引。

Revision ID: 0081
Revises: 0080
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0081"
down_revision = "0080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "export_artifacts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("cache_key", sa.String(64), nullable=False),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("format", sa.String(20), nullable=False),
        sa.Column("object_key", sa.String(500), nullable=False),
        sa.Column("file_count", sa.Integer, nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_export_artifacts_cache_key",
        "export_artifacts",
        ["cache_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_export_artifacts_cache_key", table_name="export_artifacts")
    op.drop_table("export_artifacts")
