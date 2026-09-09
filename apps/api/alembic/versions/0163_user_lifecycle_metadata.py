"""Add explicit account lifecycle metadata.

Revision ID: 0163
Revises: 0162
"""

from alembic import op
import sqlalchemy as sa


revision = "0163"
down_revision = "0162"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("disabled_kind", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "disabled_by",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_users_disabled_by"),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column("disabled_reason", sa.String(length=500), nullable=True),
    )
    op.create_index("ix_users_disabled_kind", "users", ["disabled_kind"])
    op.create_index("ix_users_disabled_at", "users", ["disabled_at"])

    # Existing inactive rows predate lifecycle metadata. They must remain
    # visible to administrators but are intentionally not made reactivatable.
    op.execute(
        sa.text(
            "UPDATE users SET disabled_kind = 'historical_unknown', "
            "disabled_at = COALESCE(disabled_at, created_at) "
            "WHERE is_active IS FALSE AND disabled_kind IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_index("ix_users_disabled_at", table_name="users")
    op.drop_index("ix_users_disabled_kind", table_name="users")
    op.drop_constraint("fk_users_disabled_by", "users", type_="foreignkey")
    op.drop_column("users", "disabled_reason")
    op.drop_column("users", "disabled_by")
    op.drop_column("users", "disabled_at")
    op.drop_column("users", "disabled_kind")
