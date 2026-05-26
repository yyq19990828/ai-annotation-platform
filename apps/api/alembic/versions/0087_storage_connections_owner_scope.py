"""v0.11.16 · storage_connections owner-scope constraint

Revision ID: 0087
Revises: 0086
Create Date: 2026-05-26
"""

from alembic import op


revision = "0087"
down_revision = "0086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_storage_connections_scope", "storage_connections", type_="check"
    )
    op.execute("UPDATE storage_connections SET scope = 'owner' WHERE scope = 'project'")
    op.create_check_constraint(
        "ck_storage_connections_scope",
        "storage_connections",
        "scope IN ('global', 'owner')",
    )
    op.alter_column("storage_connections", "scope", server_default="owner")


def downgrade() -> None:
    op.drop_constraint(
        "ck_storage_connections_scope", "storage_connections", type_="check"
    )
    op.execute("UPDATE storage_connections SET scope = 'project' WHERE scope = 'owner'")
    op.create_check_constraint(
        "ck_storage_connections_scope",
        "storage_connections",
        "scope IN ('global', 'project')",
    )
    op.alter_column("storage_connections", "scope", server_default="project")
