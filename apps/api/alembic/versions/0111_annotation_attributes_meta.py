"""v0.20.10 · annotation 属性级溯源 sidecar 列

新增 annotations.attributes_meta JSONB 列, 存每个 attribute key 的来源标记
{key: {origin: "ai"|"human", model_ref?, confidence?, at?}}. 独立列不污染
attributes 值空间. 存量行 server_default '{}' → 读作全 human, 无需回填.

Revision ID: 0111
Revises: 0110
Create Date: 2026-07-01
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0111"
down_revision = "0110"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column(
            "attributes_meta",
            JSONB(),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("annotations", "attributes_meta")
