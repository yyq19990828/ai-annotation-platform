"""v0.5.4: 逐框评论表 annotation_comments

reviewer 退回任务时可在某 annotation 上留批注；annotator 通过通知中心
（复用 audit_log）见到。表结构精简：硬关联 annotation + 作者 + 文本 + 解决态。

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "annotation_comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "annotation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("annotations.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), index=True
        ),
        sa.Column(
            "author_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "is_resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
    )
    op.create_index(
        "ix_annotation_comments_annotation_created",
        "annotation_comments",
        ["annotation_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_annotation_comments_annotation_created", table_name="annotation_comments"
    )
    op.drop_table("annotation_comments")
