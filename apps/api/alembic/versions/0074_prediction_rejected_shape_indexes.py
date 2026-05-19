"""B-37 · predictions.rejected_shape_indexes (持久化 AI 候选驳回状态)

新增 predictions.rejected_shape_indexes JSONB 列, 默认 '[]'::jsonb.
一个 Prediction.result 内可含多个 shape, 该数组存被驳回的 shape 下标,
GET predictions 时跨 shape 过滤掉这些下标.

Revision ID: 0074
Revises: 0073
Create Date: 2026-05-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "predictions",
        sa.Column(
            "rejected_shape_indexes",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("predictions", "rejected_shape_indexes")
