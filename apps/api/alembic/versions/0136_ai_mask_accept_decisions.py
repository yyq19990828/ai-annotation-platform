"""Add durable native Mask accept decisions.

Revision ID: 0136
Revises: 0135
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0136"
down_revision = "0135"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_mask_accept_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_digest", sa.String(length=64), nullable=False),
        sa.Column("candidate_id", sa.String(length=71), nullable=False),
        sa.Column("content_digest", sa.String(length=64), nullable=False),
        sa.Column("prediction_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("prediction_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("annotation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_annotation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_version", sa.Integer(), nullable=True),
        sa.Column("result_version", sa.Integer(), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("response_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id",
            "idempotency_key",
            name="uq_ai_mask_accept_decisions_task_key",
        ),
    )
    op.create_index(
        op.f("ix_ai_mask_accept_decisions_task_id"),
        "ai_mask_accept_decisions",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ai_mask_accept_decisions_prediction_id"),
        "ai_mask_accept_decisions",
        ["prediction_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ai_mask_accept_decisions_annotation_id"),
        "ai_mask_accept_decisions",
        ["annotation_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_ai_mask_accept_decisions_annotation_id"),
        table_name="ai_mask_accept_decisions",
    )
    op.drop_index(
        op.f("ix_ai_mask_accept_decisions_prediction_id"),
        table_name="ai_mask_accept_decisions",
    )
    op.drop_index(
        op.f("ix_ai_mask_accept_decisions_task_id"),
        table_name="ai_mask_accept_decisions",
    )
    op.drop_table("ai_mask_accept_decisions")
