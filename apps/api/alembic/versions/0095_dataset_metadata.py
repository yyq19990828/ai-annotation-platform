"""v0.13.11 · datasets.metadata jsonb 列

数据集级 jsonb 扩展点。首版 key: axis_convention (lidar 坐标系约定)。
server_default '{}' + not null：历史数据集自动得到 {}，前端读 axis_convention
得到 None，等价 iso_8855，行为完全向后兼容。

Revision ID: 0095
Revises: 0094
Create Date: 2026-06-05
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0095"
down_revision = "0094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("datasets", "metadata")
