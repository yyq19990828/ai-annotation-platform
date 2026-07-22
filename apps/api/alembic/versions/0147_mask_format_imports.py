"""Add staged Mask format import ledger.

Revision ID: 0147
Revises: 0146
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0147"
down_revision = "0146"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mask_format_imports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("async_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("format_id", sa.String(length=80), nullable=False),
        sa.Column("adapter_version", sa.String(length=40), nullable=False),
        sa.Column("manifest_version", sa.String(length=40), nullable=False),
        sa.Column("staged_object_key", sa.String(length=500), nullable=False),
        sa.Column("staged_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "mapping_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "options_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("mapping_digest", sa.String(length=64), nullable=False),
        sa.Column("options_digest", sa.String(length=64), nullable=False),
        sa.Column("plan_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("plan_digest", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("receipt_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="staged"
        ),
        sa.Column(
            "result_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('staged', 'pending', 'running', 'partial', 'completed', "
            "'failed', 'cancelled')",
            name="ck_mask_format_imports_status",
        ),
        sa.CheckConstraint(
            "staged_sha256 ~ '^[0-9a-f]{64}$' AND mapping_digest ~ '^[0-9a-f]{64}$' "
            "AND options_digest ~ '^[0-9a-f]{64}$' AND plan_digest ~ '^[0-9a-f]{64}$' "
            "AND token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_mask_format_imports_digests",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["async_job_id"], ["async_jobs.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("async_job_id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_mask_format_imports_project_status",
        "mask_format_imports",
        ["project_id", "status"],
    )
    op.create_index(
        "ix_mask_format_imports_receipt_expiry",
        "mask_format_imports",
        ["receipt_expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mask_format_imports_receipt_expiry",
        table_name="mask_format_imports",
    )
    op.drop_index(
        "ix_mask_format_imports_project_status",
        table_name="mask_format_imports",
    )
    op.drop_table("mask_format_imports")
