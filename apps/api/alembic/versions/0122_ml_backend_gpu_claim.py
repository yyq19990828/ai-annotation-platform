"""Add strong-typed static GPU claims to the global ML backend registry.

Revision ID: 0122
Revises: 0121

Existing rows intentionally remain unclaimed (NULL/NULL with priority 0).  Physical
GPU identity is deployment configuration and must never be guessed during migration.
"""

from alembic import op
import sqlalchemy as sa


revision = "0122"
down_revision = "0121"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ml_backend_registry",
        sa.Column("gpu_resource_id", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "ml_backend_registry",
        sa.Column("vram_budget_mb", sa.Integer(), nullable=True),
    )
    op.add_column(
        "ml_backend_registry",
        sa.Column(
            "eviction_priority",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.create_index(
        "ix_ml_backend_registry_gpu_resource_id",
        "ml_backend_registry",
        ["gpu_resource_id"],
        unique=False,
    )
    op.create_check_constraint(
        "ck_ml_backend_registry_gpu_claim_pair",
        "ml_backend_registry",
        "(gpu_resource_id IS NULL) = (vram_budget_mb IS NULL)",
    )
    op.create_check_constraint(
        "ck_ml_backend_registry_vram_budget_positive",
        "ml_backend_registry",
        "vram_budget_mb IS NULL OR vram_budget_mb > 0",
    )
    op.create_check_constraint(
        "ck_ml_backend_registry_gpu_resource_id",
        "ml_backend_registry",
        "gpu_resource_id IS NULL OR ("
        "gpu_resource_id = btrim(gpu_resource_id) AND "
        "gpu_resource_id !~ '[[:space:],]' AND "
        "position('/' in gpu_resource_id) > 1 AND "
        "position('/' in gpu_resource_id) < char_length(gpu_resource_id))",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_ml_backend_registry_gpu_resource_id",
        "ml_backend_registry",
        type_="check",
    )
    op.drop_constraint(
        "ck_ml_backend_registry_vram_budget_positive",
        "ml_backend_registry",
        type_="check",
    )
    op.drop_constraint(
        "ck_ml_backend_registry_gpu_claim_pair",
        "ml_backend_registry",
        type_="check",
    )
    op.drop_index(
        "ix_ml_backend_registry_gpu_resource_id",
        table_name="ml_backend_registry",
    )
    op.drop_column("ml_backend_registry", "eviction_priority")
    op.drop_column("ml_backend_registry", "vram_budget_mb")
    op.drop_column("ml_backend_registry", "gpu_resource_id")
