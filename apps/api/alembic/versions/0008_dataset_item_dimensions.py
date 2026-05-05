"""Add dataset_items.width / height

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dataset_items", sa.Column("width", sa.Integer(), nullable=True))
    op.add_column("dataset_items", sa.Column("height", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("dataset_items", "height")
    op.drop_column("dataset_items", "width")
