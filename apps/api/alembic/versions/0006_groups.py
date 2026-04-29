"""Groups: groups table + users.group_id; seed from existing users.group_name

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("name", name="uq_groups_name"),
    )
    op.create_index("ix_groups_name", "groups", ["name"])

    op.add_column(
        "users",
        sa.Column("group_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_group_id",
        "users",
        "groups",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_users_group_id", "users", ["group_id"])

    # 数据迁移：依据现有 users.group_name 去重 seed groups，并回填 users.group_id
    op.execute(
        """
        INSERT INTO groups (id, name, created_at)
        SELECT gen_random_uuid(), trimmed, now()
        FROM (
            SELECT DISTINCT TRIM(group_name) AS trimmed
            FROM users
            WHERE group_name IS NOT NULL
              AND TRIM(group_name) <> ''
        ) AS s
        ON CONFLICT (name) DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE users u
        SET group_id = g.id
        FROM groups g
        WHERE u.group_name IS NOT NULL
          AND TRIM(u.group_name) = g.name
        """
    )


def downgrade() -> None:
    op.drop_index("ix_users_group_id", table_name="users")
    op.drop_constraint("fk_users_group_id", "users", type_="foreignkey")
    op.drop_column("users", "group_id")

    op.drop_index("ix_groups_name", table_name="groups")
    op.drop_table("groups")
