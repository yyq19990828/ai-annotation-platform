"""v0.5.4: annotation.attributes / project.attribute_schema / project.classes_config

为标注属性 schema（B）与 classes 颜色/排序升级（E）一次性铺数据列。
- annotations.attributes JSONB DEFAULT '{}'：标注级自由字段（业务属性）。
- projects.attribute_schema JSONB DEFAULT '{"fields": []}'：项目级 schema DSL。
- projects.classes_config JSONB DEFAULT '{}'：每个 class 的 {color, order} 元信息。

存量数据：
- attributes / attribute_schema / classes_config 均填空对象/数组，不影响现有逻辑。
- classes_config 不在 migration 里自动派生（前端首次保存时会写）。

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column(
            "attributes", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "attribute_schema",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{\"fields\": []}'::jsonb"),
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "classes_config",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "classes_config")
    op.drop_column("projects", "attribute_schema")
    op.drop_column("annotations", "attributes")
