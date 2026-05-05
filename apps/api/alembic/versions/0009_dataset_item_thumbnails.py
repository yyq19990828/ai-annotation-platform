"""Add dataset_items.thumbnail_path / blurhash; fix content_hash drift

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Fix v0.4.8 alembic drift: content_hash was in the model but never migrated
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='dataset_items' AND column_name='content_hash'"
        )
    )
    if result.fetchone() is None:
        op.add_column(
            "dataset_items", sa.Column("content_hash", sa.String(64), nullable=True)
        )
        op.create_index(
            "ix_dataset_items_content_hash", "dataset_items", ["content_hash"]
        )

    op.add_column(
        "dataset_items", sa.Column("thumbnail_path", sa.String(512), nullable=True)
    )
    op.add_column("dataset_items", sa.Column("blurhash", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("dataset_items", "blurhash")
    op.drop_column("dataset_items", "thumbnail_path")
