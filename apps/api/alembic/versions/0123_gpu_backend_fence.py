"""Add durable GPU backend fencing high-water marks.

Revision ID: 0123
Revises: 0122

Every existing registry backend receives a row with zero-valued sentinels. New rows
are created lazily by the atomic allocator before the first issued generation or
control epoch, so an unavailable durable store can never be guessed from Redis.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0123"
down_revision = "0122"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gpu_backend_fences",
        sa.Column(
            "backend_registry_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "generation_high_water",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "control_epoch_high_water",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "generation_high_water >= 0",
            name="ck_gpu_backend_fences_generation_nonnegative",
        ),
        sa.CheckConstraint(
            "control_epoch_high_water >= 0",
            name="ck_gpu_backend_fences_control_epoch_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["backend_registry_id"],
            ["ml_backend_registry.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("backend_registry_id"),
    )
    op.execute(
        """
        INSERT INTO gpu_backend_fences (backend_registry_id)
        SELECT id FROM ml_backend_registry
        ON CONFLICT (backend_registry_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("gpu_backend_fences")
