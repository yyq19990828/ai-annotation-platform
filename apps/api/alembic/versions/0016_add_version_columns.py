"""v0.6.0: 协作并发 — annotations / tasks 加 version 列

乐观并发控制：PATCH 端点通过 If-Match / ETag 使用该列来检测冲突。

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa


revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "tasks", sa.Column("version", sa.Integer(), server_default="1", nullable=False)
    )


def downgrade() -> None:
    op.drop_column("tasks", "version")
    op.drop_column("annotations", "version")
