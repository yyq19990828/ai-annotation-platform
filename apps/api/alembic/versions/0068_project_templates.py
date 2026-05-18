"""Project templates (E2 · v0.10.14)

新表 project_templates: 项目模板库, 与 v0.10.11 "从已有项目复制" 并存.
模板载荷与 _CLONEABLE_PROJECT_FIELDS 对齐 + 携带 annotation_guide (Markdown 文本,
不携带 guide_assets storage key).

Revision ID: 0068
Revises: 0067
Create Date: 2026-05-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS display_seq_project_templates")

    op.create_table(
        "project_templates",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("display_id", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type_label", sa.String(50), nullable=False),
        sa.Column("type_key", sa.String(30), nullable=False),
        # 模板载荷
        sa.Column(
            "classes", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "classes_config",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "attribute_schema",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{\"fields\": []}'::jsonb"),
        ),
        sa.Column(
            "label_config",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "ai_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("ai_model", sa.String(255), nullable=True),
        sa.Column(
            "sampling",
            sa.String(30),
            nullable=False,
            server_default=sa.text("'sequence'"),
        ),
        sa.Column(
            "maximum_annotations",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "show_overlap_first",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "iou_dedup_threshold",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0.7"),
        ),
        sa.Column(
            "box_threshold", sa.Float(), nullable=False, server_default=sa.text("0.35")
        ),
        sa.Column(
            "text_threshold", sa.Float(), nullable=False, server_default=sa.text("0.25")
        ),
        sa.Column("text_output_default", sa.String(10), nullable=True),
        sa.Column(
            "rendering_config",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # E1 整合: 模板可携带 annotation_guide markdown 文本; 不存 guide_assets.
        sa.Column("annotation_guide", sa.Text(), nullable=True),
        # 共享语义
        sa.Column(
            "scope",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'private'"),
        ),
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "source_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # 元数据
        sa.Column(
            "usage_count", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.CheckConstraint(
            "scope IN ('private', 'organization', 'public')",
            name="ck_project_template_scope",
        ),
        sa.CheckConstraint(
            "(scope = 'public') OR (scope = 'private') OR "
            "(scope = 'organization' AND organization_id IS NOT NULL)",
            name="ck_project_template_org_scope",
        ),
    )
    op.create_index(
        "ix_project_templates_scope_type",
        "project_templates",
        ["scope", "type_key"],
    )
    op.create_index(
        "ix_project_templates_org",
        "project_templates",
        ["organization_id"],
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )
    op.create_index(
        "ix_project_templates_created_by",
        "project_templates",
        ["created_by"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_templates_created_by", table_name="project_templates")
    op.drop_index("ix_project_templates_org", table_name="project_templates")
    op.drop_index("ix_project_templates_scope_type", table_name="project_templates")
    op.drop_table("project_templates")
    op.execute("DROP SEQUENCE IF EXISTS display_seq_project_templates")
