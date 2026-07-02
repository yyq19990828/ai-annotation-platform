"""v0.21.0 · 命名项目编排表

新增 project_pipelines, 将 projects.preannotate_pipeline 非空数据回填为
scope=private 且 is_default=true 的命名编排。旧列保留一版读兼容。
同时移除 projects.ml_backend_id 的外键约束, 项目默认编排的源阶段成为后续主 backend
派生来源。

Revision ID: 0112
Revises: 0111
Create Date: 2026-07-02
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0112"
down_revision = "0111"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_pipelines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", sa.String(20), nullable=False, server_default="private"),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "stages",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("usage_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.CheckConstraint(
            "scope IN ('private', 'organization', 'public')",
            name="ck_project_pipelines_scope",
        ),
        sa.CheckConstraint(
            """
            (
              scope = 'private'
              AND project_id IS NOT NULL
              AND organization_id IS NULL
            )
            OR (
              scope = 'organization'
              AND project_id IS NULL
              AND organization_id IS NOT NULL
            )
            OR (
              scope = 'public'
              AND project_id IS NULL
              AND organization_id IS NULL
            )
            """,
            name="ck_project_pipelines_scope_owner",
        ),
        sa.CheckConstraint(
            "scope = 'private' OR is_default = false",
            name="ck_project_pipelines_default_private",
        ),
    )
    op.create_index(
        "ix_project_pipelines_project_id", "project_pipelines", ["project_id"]
    )
    op.create_index(
        "ix_project_pipelines_organization_id",
        "project_pipelines",
        ["organization_id"],
    )
    op.create_index(
        "ix_project_pipelines_created_by", "project_pipelines", ["created_by"]
    )
    op.create_index(
        "uq_project_pipelines_default_per_project",
        "project_pipelines",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("is_default = true"),
    )

    op.execute(
        """
        INSERT INTO project_pipelines
          (id, scope, project_id, organization_id, name, stages, is_default,
           created_by, usage_count, created_at, updated_at)
        SELECT
          gen_random_uuid(), 'private', p.id, NULL,
          '项目默认编排', p.preannotate_pipeline, true,
          p.owner_id, 0, now(), now()
        FROM projects p
        WHERE p.preannotate_pipeline IS NOT NULL;
        """
    )

    op.drop_constraint("projects_ml_backend_id_fkey", "projects", type_="foreignkey")


def downgrade() -> None:
    op.create_foreign_key(
        "projects_ml_backend_id_fkey",
        "projects",
        "ml_backend_registry",
        ["ml_backend_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_index(
        "uq_project_pipelines_default_per_project", table_name="project_pipelines"
    )
    op.drop_index("ix_project_pipelines_created_by", table_name="project_pipelines")
    op.drop_index("ix_project_pipelines_organization_id", table_name="project_pipelines")
    op.drop_index("ix_project_pipelines_project_id", table_name="project_pipelines")
    op.drop_table("project_pipelines")
