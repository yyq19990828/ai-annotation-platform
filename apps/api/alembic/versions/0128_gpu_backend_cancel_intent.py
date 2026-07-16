"""Persist exact GPU drain-cancel generation intents.

Revision ID: 0128
Revises: 0127
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0128"
down_revision = "0127"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gpu_backend_cancel_intents",
        sa.Column(
            "backend_registry_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("gpu_resource_id", sa.String(length=512), nullable=False),
        sa.Column("membership_epoch", sa.BigInteger(), nullable=False),
        sa.Column("boot_id", sa.String(length=128), nullable=False),
        sa.Column("control_epoch", sa.BigInteger(), nullable=False),
        sa.Column("runtime_epoch", sa.BigInteger(), nullable=False),
        sa.Column("source_generation", sa.BigInteger(), nullable=False),
        sa.Column("drain_generation", sa.BigInteger(), nullable=False),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        sa.Column("owner_id", sa.String(length=256), nullable=False),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("owner_hard_deadline_ms", sa.BigInteger(), nullable=False),
        sa.Column(
            "drain_token_expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("jti", sa.String(length=256), nullable=False),
        sa.Column("pool_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("subject_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "membership_epoch > 0",
            name="ck_gpu_backend_cancel_intents_membership_epoch",
        ),
        sa.CheckConstraint(
            "drain_generation > 0 AND generation > drain_generation",
            name="ck_gpu_backend_cancel_intents_generation",
        ),
        sa.CheckConstraint(
            "source_generation > 0 AND drain_generation > source_generation",
            name="ck_gpu_backend_cancel_intents_source_generation",
        ),
        sa.CheckConstraint(
            "control_epoch > 0 AND runtime_epoch > 0",
            name="ck_gpu_backend_cancel_intents_epochs",
        ),
        sa.CheckConstraint(
            "operation = 'evict'",
            name="ck_gpu_backend_cancel_intents_operation",
        ),
        sa.CheckConstraint(
            "owner_hard_deadline_ms > 0",
            name="ck_gpu_backend_cancel_intents_owner_deadline",
        ),
        sa.CheckConstraint(
            "gpu_resource_id <> '' AND boot_id <> '' AND owner_id <> '' AND jti <> ''",
            name="ck_gpu_backend_cancel_intents_nonempty",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(pool_ids) = 'array' AND jsonb_array_length(pool_ids) > 0",
            name="ck_gpu_backend_cancel_intents_pool_ids",
        ),
        sa.CheckConstraint(
            "subject_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_gpu_backend_cancel_intents_fingerprint",
        ),
        sa.ForeignKeyConstraint(
            ["backend_registry_id"],
            ["gpu_backend_fences.backend_registry_id"],
            name="fk_gpu_backend_cancel_intents_fence",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("backend_registry_id"),
    )


def downgrade() -> None:
    op.drop_table("gpu_backend_cancel_intents")
