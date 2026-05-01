"""v0.6.2 评论 polish：annotation_comments 加 mentions / attachments / canvas_drawing 列。

- mentions JSONB DEFAULT '[]'         —— @ 提及，每项 {userId, displayName, offset, length}
- attachments JSONB DEFAULT '[]'      —— 附件，每项 {storageKey, fileName, mimeType, size}
- canvas_drawing JSONB NULL           —— reviewer 端 Konva overlay 序列化的 svg path 数据

Revision ID: 0020
Revises: 0019
Create Date: 2026-05-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0020"
down_revision = "0019"


def upgrade() -> None:
    op.add_column(
        "annotation_comments",
        sa.Column("mentions", JSONB, server_default="[]", nullable=False),
    )
    op.add_column(
        "annotation_comments",
        sa.Column("attachments", JSONB, server_default="[]", nullable=False),
    )
    op.add_column(
        "annotation_comments",
        sa.Column("canvas_drawing", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("annotation_comments", "canvas_drawing")
    op.drop_column("annotation_comments", "attachments")
    op.drop_column("annotation_comments", "mentions")
