"""I18 · annotation_feedbacks 统一反馈表 (取经合集 §2.2).

仅立新表; 旧 bug_reports / annotation_comments / tasks.reject_reason 保持不动.
下一切片 (v0.10.20) 加 UNION ALL view 与双写, 详见 ADR-0027.

Revision ID: 0076
Revises: 0075
Create Date: 2026-05-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0076"
down_revision = "0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "annotation_feedbacks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            primary_key=True,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("anchor_type", sa.String(length=16), nullable=False),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id"),
            nullable=True,
        ),
        sa.Column(
            "annotation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("annotations.id"),
            nullable=True,
        ),
        sa.Column("anchor_position", postgresql.JSONB, nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="open",
        ),
        sa.Column("severity", sa.String(length=16), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "attachments",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "thread_parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("annotation_feedbacks.id"),
            nullable=True,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_feedback_project_kind_status",
        "annotation_feedbacks",
        ["project_id", "kind", "status"],
    )
    op.create_index(
        "ix_feedback_task_kind",
        "annotation_feedbacks",
        ["task_id", "kind"],
        postgresql_where=sa.text("task_id IS NOT NULL"),
    )
    op.create_index(
        "ix_feedback_annotation",
        "annotation_feedbacks",
        ["annotation_id"],
        postgresql_where=sa.text("annotation_id IS NOT NULL"),
    )
    # CHECK 约束保证 anchor 一致性: pixel 必带 position 与 task; annotation 必带 annotation_id 等
    op.create_check_constraint(
        "ck_feedback_anchor_consistency",
        "annotation_feedbacks",
        """
        (anchor_type = 'project' AND task_id IS NULL AND annotation_id IS NULL AND anchor_position IS NULL)
        OR (anchor_type = 'task' AND task_id IS NOT NULL AND annotation_id IS NULL AND anchor_position IS NULL)
        OR (anchor_type = 'annotation' AND task_id IS NOT NULL AND annotation_id IS NOT NULL AND anchor_position IS NULL)
        OR (anchor_type = 'pixel' AND task_id IS NOT NULL AND anchor_position IS NOT NULL)
        """,
    )
    op.create_check_constraint(
        "ck_feedback_kind_valid",
        "annotation_feedbacks",
        "kind IN ('issue', 'comment', 'reject', 'bug')",
    )
    op.create_check_constraint(
        "ck_feedback_status_valid",
        "annotation_feedbacks",
        "status IN ('open', 'resolved', 'wont_fix')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_feedback_status_valid", "annotation_feedbacks", type_="check"
    )
    op.drop_constraint("ck_feedback_kind_valid", "annotation_feedbacks", type_="check")
    op.drop_constraint(
        "ck_feedback_anchor_consistency", "annotation_feedbacks", type_="check"
    )
    op.drop_index("ix_feedback_annotation", table_name="annotation_feedbacks")
    op.drop_index("ix_feedback_task_kind", table_name="annotation_feedbacks")
    op.drop_index("ix_feedback_project_kind_status", table_name="annotation_feedbacks")
    op.drop_table("annotation_feedbacks")
