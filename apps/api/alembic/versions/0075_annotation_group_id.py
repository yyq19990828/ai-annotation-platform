"""I12 · annotations.group_id + tasks.next_group_seq (Object Group)

新增:
- annotations.group_id (BigInteger NULLABLE): task 内分组序号; 同 task 内 group_id 相同的多框为一组.
- tasks.next_group_seq (Integer DEFAULT 0): 每 task 一个独立序号空间,
  POST /annotations/group 时 UPDATE ... SET next_group_seq = next_group_seq + 1 RETURNING.
- 复合索引 ix_annotations_task_group(task_id, group_id) WHERE group_id IS NOT NULL.

与 parent_annotation_id 正交: parent 表"车牌属于车"层级, group 表"平等成员同组".

Revision ID: 0075
Revises: 0074
Create Date: 2026-05-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("group_id", sa.BigInteger(), nullable=True),
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
    op.create_index(
        "ix_annotations_task_group",
        "annotations",
        ["task_id", "group_id"],
        unique=False,
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_annotations_task_group", table_name="annotations")
    op.drop_column("tasks", "next_group_seq")
    op.drop_column("annotations", "group_id")
