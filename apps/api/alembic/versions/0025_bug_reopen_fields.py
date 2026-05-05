"""v0.6.8 · BUG 反馈闭环：bug_reports 加 reopen 字段

提交者在 fixed/wont_fix/duplicate 终态评论时，service 层同事务把 status 切回
triaged 并 reopen_count++、last_reopened_at = now()。配套字段透出到详情接口供前端
渲染「曾重开 N 次」徽章。

Revision ID: 0025
Revises: 0024
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa


revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bug_reports",
        sa.Column("reopen_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "bug_reports",
        sa.Column("last_reopened_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bug_reports", "last_reopened_at")
    op.drop_column("bug_reports", "reopen_count")
