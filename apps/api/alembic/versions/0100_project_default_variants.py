"""v0.14.13 · projects.default_variants

Revision ID: 0100
Revises: 0099
Create Date: 2026-06-08

加 `projects.default_variants JSONB` 字段, 存项目级 variant 偏好 (按 ml_backend_id 分桶).
形状: { "<backend_uuid>": { "<axis_key>": "<axis_value>", ... }, ... }
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "default_variants",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "default_variants")
