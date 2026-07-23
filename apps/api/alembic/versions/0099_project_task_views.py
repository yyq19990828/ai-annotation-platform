"""v0.14.8 · project task saved views

Revision ID: 0099
Revises: 0098
Create Date: 2026-06-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_task_views",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "visibility",
            sa.String(length=16),
            server_default="private",
            nullable=False,
        ),
        sa.Column(
            "filter_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "sort_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "columns_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
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
            "visibility IN ('private', 'project')",
            name="ck_project_task_views_visibility",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "owner_id",
            "name",
            name="uq_project_task_views_private_owner_name",
        ),
    )
    op.create_index(
        "ix_project_task_views_owner_id",
        "project_task_views",
        ["owner_id"],
    )
    op.create_index(
        "ix_project_task_views_project_id",
        "project_task_views",
        ["project_id"],
    )
    op.create_index(
        "ix_project_task_views_visibility",
        "project_task_views",
        ["project_id", "visibility"],
    )
    op.create_index(
        "uq_project_task_views_project_name",
        "project_task_views",
        ["project_id", "name"],
        unique=True,
        postgresql_where=sa.text("visibility = 'project'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_project_task_views_project_name",
        table_name="project_task_views",
        postgresql_where=sa.text("visibility = 'project'"),
    )
    op.drop_index("ix_project_task_views_visibility", table_name="project_task_views")
    op.drop_index("ix_project_task_views_project_id", table_name="project_task_views")
    op.drop_index("ix_project_task_views_owner_id", table_name="project_task_views")
    op.drop_table("project_task_views")
