"""Add entity scope to Data Manager saved views.

Revision ID: 0119
Revises: 0118
"""

from alembic import op
import sqlalchemy as sa


revision = "0119"
down_revision = "0118"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_task_views",
        sa.Column(
            "entity_scope",
            sa.String(length=16),
            nullable=False,
            server_default="tasks",
        ),
    )
    op.create_check_constraint(
        "ck_project_task_views_entity_scope",
        "project_task_views",
        "entity_scope IN ('tasks', 'objects', 'tracks')",
    )
    op.drop_constraint(
        "uq_project_task_views_private_owner_name",
        "project_task_views",
        type_="unique",
    )
    op.drop_index(
        "uq_project_task_views_project_name",
        table_name="project_task_views",
    )
    op.create_unique_constraint(
        "uq_project_task_views_private_owner_name",
        "project_task_views",
        ["project_id", "owner_id", "entity_scope", "name"],
    )
    op.create_index(
        "uq_project_task_views_project_name",
        "project_task_views",
        ["project_id", "entity_scope", "name"],
        unique=True,
        postgresql_where=sa.text("visibility = 'project'"),
    )
    op.create_index(
        "ix_project_task_views_scope_visibility",
        "project_task_views",
        ["project_id", "entity_scope", "visibility"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_project_task_views_scope_visibility",
        table_name="project_task_views",
    )
    op.drop_index(
        "uq_project_task_views_project_name",
        table_name="project_task_views",
    )
    op.drop_constraint(
        "uq_project_task_views_private_owner_name",
        "project_task_views",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_project_task_views_private_owner_name",
        "project_task_views",
        ["project_id", "owner_id", "name"],
    )
    op.create_index(
        "uq_project_task_views_project_name",
        "project_task_views",
        ["project_id", "name"],
        unique=True,
        postgresql_where=sa.text("visibility = 'project'"),
    )
    op.drop_constraint(
        "ck_project_task_views_entity_scope",
        "project_task_views",
        type_="check",
    )
    op.drop_column("project_task_views", "entity_scope")
