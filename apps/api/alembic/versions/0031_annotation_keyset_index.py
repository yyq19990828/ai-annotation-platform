"""v0.7.6 · annotation keyset 索引 + predictions.created_at 索引

S5：`GET /tasks/{id}/annotations/page` keyset 分页，加 (task_id, created_at, id)
复合索引覆盖排序键，避免 1000+ 框场景内存 sort。

S6：predictions.created_at 索引为后续 RANGE(created_at) 月分区做准备（参见
docs/adr/0006-predictions-partition-by-month.md）。本期不动 PK / FK 形状，
真正 partition 迁移延期到行数 > 1M 触发。

Revision ID: 0031
Revises: 0030
Create Date: 2026-05-06
"""

from alembic import op


revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_annotations_task_created_id",
        "annotations",
        ["task_id", "created_at", "id"],
        postgresql_using="btree",
    )
    op.create_index(
        "ix_predictions_created_at",
        "predictions",
        ["created_at"],
        postgresql_using="btree",
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_predictions_created_at")
    op.execute("DROP INDEX IF EXISTS ix_annotations_task_created_id")
