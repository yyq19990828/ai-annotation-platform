"""Predictions.source 字段 (v0.10.15)

加 predictions.source 区分内部 ML backend 生成 vs 外部导入 (POST
/projects/{id}/predictions/import). 老数据按 default='ml_backend' 回填
(当前唯一出口是 ML backend, 语义准确).

枚举: 'ml_backend' | 'external_import' | 'unknown'

Revision ID: 0069
Revises: 0068
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "predictions",
        sa.Column(
            "source",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'ml_backend'"),
        ),
    )
    op.create_index("ix_predictions_source", "predictions", ["source"])


def downgrade() -> None:
    op.drop_index("ix_predictions_source", table_name="predictions")
    op.drop_column("predictions", "source")
