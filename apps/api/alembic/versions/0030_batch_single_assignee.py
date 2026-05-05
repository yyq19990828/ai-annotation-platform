"""v0.7.2 · 批次分派单值化：annotator_id / reviewer_id

业务理念：一个 batch = 一个标注员 + 一个审核员。先前 `assigned_user_ids`
是 list 模糊语义，本迁移把它显式拆为两列：
  - annotator_id: UUID（FK users.id ON DELETE SET NULL）
  - reviewer_id: UUID（FK users.id ON DELETE SET NULL）

数据迁移：JOIN project_members 把现有 assigned_user_ids 中的标注员/审核员
取「第一个」写入新列。已有但分到多人的批次只保留首位（与新理念一致）。
保留 assigned_user_ids 列做 union 派生写入兼容（service 层维护）。

Revision ID: 0030
Revises: 0029
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_batches",
        sa.Column(
            "annotator_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "task_batches",
        sa.Column(
            "reviewer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_task_batches_annotator_id", "task_batches", ["annotator_id"])
    op.create_index("ix_task_batches_reviewer_id", "task_batches", ["reviewer_id"])

    # 数据迁移：把 assigned_user_ids 中的 annotator / reviewer 第一个分别写入两列
    # 用 jsonb_array_elements_text 展开 + JOIN project_members 拿到 role + DISTINCT ON 取首位
    op.execute("""
    WITH expanded AS (
        SELECT
            tb.id AS batch_id,
            tb.project_id,
            (uid::text)::uuid AS user_id
        FROM task_batches tb
        CROSS JOIN LATERAL jsonb_array_elements_text(tb.assigned_user_ids) AS uid
        WHERE jsonb_typeof(tb.assigned_user_ids) = 'array'
    ),
    role_resolved AS (
        SELECT DISTINCT ON (e.batch_id, pm.role)
            e.batch_id,
            pm.role,
            e.user_id
        FROM expanded e
        JOIN project_members pm
          ON pm.project_id = e.project_id AND pm.user_id = e.user_id
        ORDER BY e.batch_id, pm.role, e.user_id
    )
    UPDATE task_batches tb
    SET annotator_id = COALESCE(
            (SELECT user_id FROM role_resolved rr
             WHERE rr.batch_id = tb.id AND rr.role = 'annotator'),
            tb.annotator_id),
        reviewer_id = COALESCE(
            (SELECT user_id FROM role_resolved rr
             WHERE rr.batch_id = tb.id AND rr.role = 'reviewer'),
            tb.reviewer_id);
    """)


def downgrade() -> None:
    op.drop_index("ix_task_batches_reviewer_id", table_name="task_batches")
    op.drop_index("ix_task_batches_annotator_id", table_name="task_batches")
    op.drop_column("task_batches", "reviewer_id")
    op.drop_column("task_batches", "annotator_id")
