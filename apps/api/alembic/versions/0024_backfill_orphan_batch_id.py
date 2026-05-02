"""v0.6.7 · 回填 batch_id IS NULL 的孤儿 task 到对应项目的 B-DEFAULT

历史 bug：v0.6.0 引入 task_batches 后，0019 migration 把当时所有 task 写到了 B-DEFAULT，
但**之后**所有 `link_project()` 创建的 task 都没写 `batch_id`（直到 v0.6.7 修复）。
线上一个项目可能出现 1200+ 孤儿 task，前端 BatchesSection 只能看到 0019 时的存量，
看起来「分包都丢了」。本迁移把孤儿挂回 B-DEFAULT，并按真实 task 数重算 B-DEFAULT 的计数器。

不影响 v0.6.7 新接入数据集（那批已经写到独立的「{ds.name} 默认包」）。

Revision ID: 0024
Revises: 0023
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "0024"
down_revision = "0023"


def upgrade() -> None:
    conn = op.get_bind()

    # 1. 确保每个 project 都有 B-DEFAULT；没有就建一个（极少数情况：v0.6.0 之前创建的项目走 0019 应已建过，
    #    但保险起见兼容）
    projects_without_default = conn.execute(sa.text(
        """
        SELECT p.id, p.owner_id
        FROM projects p
        WHERE NOT EXISTS (
            SELECT 1 FROM task_batches b
            WHERE b.project_id = p.id AND b.display_id = 'B-DEFAULT'
        )
        """
    )).fetchall()

    for pid, owner_id in projects_without_default:
        conn.execute(sa.text(
            "INSERT INTO task_batches "
            "(project_id, display_id, name, status, total_tasks, completed_tasks, review_tasks, created_by) "
            "VALUES (:pid, 'B-DEFAULT', '默认批次', 'active', 0, 0, 0, :owner)"
        ), {"pid": pid, "owner": owner_id})

    # 2. 把孤儿 task 挂到对应 project 的 B-DEFAULT
    conn.execute(sa.text(
        """
        UPDATE tasks
        SET batch_id = b.id
        FROM task_batches b
        WHERE tasks.batch_id IS NULL
          AND b.project_id = tasks.project_id
          AND b.display_id = 'B-DEFAULT'
        """
    ))

    # 3. 重算每个 batch 的计数器（不止 B-DEFAULT；顺手把所有 batch 一起对齐，便于切割）
    conn.execute(sa.text(
        """
        UPDATE task_batches b SET
            total_tasks = sub.total,
            completed_tasks = sub.completed,
            review_tasks = sub.review,
            approved_tasks = sub.approved,
            rejected_tasks = sub.rejected
        FROM (
            SELECT batch_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                COUNT(*) FILTER (WHERE status = 'review') AS review,
                COUNT(*) FILTER (WHERE status = 'completed') AS approved,
                0 AS rejected
            FROM tasks
            WHERE batch_id IS NOT NULL
            GROUP BY batch_id
        ) sub
        WHERE b.id = sub.batch_id
        """
    ))

    # 4. 兜底：没有任何 task 的 batch（如全空的 B-DEFAULT）计数器置零
    conn.execute(sa.text(
        """
        UPDATE task_batches SET
            total_tasks = 0, completed_tasks = 0, review_tasks = 0,
            approved_tasks = 0, rejected_tasks = 0
        WHERE id NOT IN (SELECT DISTINCT batch_id FROM tasks WHERE batch_id IS NOT NULL)
        """
    ))


def downgrade() -> None:
    # 不可逆：无法分辨「本次回填的 batch_id」 vs 「migration 之前就正确写入的 batch_id」
    pass
