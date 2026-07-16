"""Persist exact GPU rollout reset/mode control intent.

Revision ID: 0130
Revises: 0129
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0130"
down_revision = "0129"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gpu_backend_fences",
        sa.Column("rollout_control_operation", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "gpu_backend_fences",
        sa.Column(
            "rollout_control_transition_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "gpu_backend_fences",
        sa.Column("rollout_control_epoch", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "gpu_backend_fences",
        sa.Column(
            "rollout_control_membership_epoch",
            sa.BigInteger(),
            nullable=True,
        ),
    )
    op.add_column(
        "gpu_backend_fences",
        sa.Column("rollout_control_boot_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "gpu_backend_fences",
        sa.Column(
            "rollout_control_token_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_gpu_backend_fences_rollout_control_shape",
        "gpu_backend_fences",
        "(rollout_control_operation IS NULL "
        "AND rollout_control_transition_id IS NULL "
        "AND rollout_control_epoch IS NULL "
        "AND rollout_control_membership_epoch IS NULL "
        "AND rollout_control_boot_id IS NULL "
        "AND rollout_control_token_expires_at IS NULL) OR "
        "(rollout_control_operation IN "
        "('reset', 'mode_enforce', 'mode_legacy') "
        "AND rollout_control_transition_id IS NOT NULL "
        "AND rollout_control_epoch > 0 "
        "AND rollout_control_membership_epoch > 0 "
        "AND rollout_control_boot_id IS NOT NULL "
        "AND rollout_control_boot_id = btrim(rollout_control_boot_id) "
        "AND rollout_control_boot_id <> '' "
        "AND rollout_control_token_expires_at IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_gpu_backend_fences_rollout_control_shape",
        "gpu_backend_fences",
        type_="check",
    )
    op.drop_column("gpu_backend_fences", "rollout_control_token_expires_at")
    op.drop_column("gpu_backend_fences", "rollout_control_boot_id")
    op.drop_column("gpu_backend_fences", "rollout_control_membership_epoch")
    op.drop_column("gpu_backend_fences", "rollout_control_epoch")
    op.drop_column("gpu_backend_fences", "rollout_control_transition_id")
    op.drop_column("gpu_backend_fences", "rollout_control_operation")
