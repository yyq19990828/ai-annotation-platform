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

    # Successful irreversible operations take precedence over later legacy
    # deactivation events. Unknown history stays non-reactivatable without
    # inventing a suspension timestamp from the account creation date.
    op.execute(
        sa.text(
            "UPDATE users SET disabled_kind = 'historical_unknown' "
            "WHERE is_active IS FALSE AND disabled_kind IS NULL"
        )
    )
    op.execute(
        sa.text(
            """
            WITH known_history AS (
                SELECT DISTINCT ON (u.id)
                    u.id AS user_id,
                    CASE WHEN a.action = 'user.deactivate'
                        THEN 'suspended' ELSE 'deleted' END AS disabled_kind,
                    a.created_at AS disabled_at,
                    actor.id AS disabled_by
                FROM users u
                JOIN audit_logs a ON a.target_id = u.id::text
                    AND a.target_type = 'user'
                    AND a.status_code BETWEEN 200 AND 299
                    AND a.action IN (
                        'user.deactivate', 'user.delete',
                        'user.deactivation_approve'
                    )
                LEFT JOIN users actor ON actor.id = a.actor_id
                WHERE u.is_active IS FALSE
                ORDER BY u.id,
                    (a.action <> 'user.deactivate') DESC,
                    a.created_at DESC, a.id DESC
            )
            UPDATE users u SET
                disabled_kind = h.disabled_kind,
                disabled_at = h.disabled_at,
                disabled_by = h.disabled_by
            FROM known_history h WHERE u.id = h.user_id
            """
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
