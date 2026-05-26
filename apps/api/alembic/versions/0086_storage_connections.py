"""v0.11.14 · storage_connections（服务端拉取连接器）

外部 S3 / SFTP 的可复用连接配置。密钥经 Fernet 加密存 secret_enc（bytea），
非密钥配置存 config JSONB。scope 区分 global（超管）/ project（项目级）。

Revision ID: 0086
Revises: 0085
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0086"
down_revision = "0085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "storage_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column(
            "config",
            postgresql.JSONB(),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("secret_enc", sa.LargeBinary(), nullable=True),
        sa.Column(
            "scope", sa.String(20), nullable=False, server_default="project"
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "kind IN ('s3', 'sftp')", name="ck_storage_connections_kind"
        ),
        sa.CheckConstraint(
            "scope IN ('global', 'project')",
            name="ck_storage_connections_scope",
        ),
    )
    op.create_index(
        "ix_storage_connections_scope_project",
        "storage_connections",
        ["scope", "project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_storage_connections_scope_project",
        table_name="storage_connections",
    )
    op.drop_table("storage_connections")
