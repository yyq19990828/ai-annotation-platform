"""Repair invitation authorization and user group memberships.

Revision ID: 0152
Revises: 0151
"""

from collections.abc import Sequence

from alembic import op

revision = "0152"
down_revision = "0151"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE user_invitations AS invitation
        SET revoked_at = now(),
            expires_at = now()
        WHERE invitation.role IN ('super_admin', 'project_admin')
          AND invitation.accepted_at IS NULL
          AND invitation.revoked_at IS NULL
          AND invitation.expires_at > now()
          AND NOT EXISTS (
              SELECT 1
              FROM users AS inviter
              WHERE inviter.id = invitation.invited_by
                AND inviter.role = 'super_admin'
                AND inviter.is_active IS TRUE
          )
        """
    )
    op.execute(
        """
        UPDATE users
        SET group_name = NULL
        WHERE group_id IS NULL
          AND group_name IS NOT NULL
          AND REGEXP_REPLACE(
                group_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
              ) = ''
        """
    )
    op.execute(
        """
        INSERT INTO groups (name, created_at)
        SELECT DISTINCT REGEXP_REPLACE(
                            u.group_name,
                            '^[[:space:]]+|[[:space:]]+$',
                            '',
                            'g'
                        ),
                        now()
        FROM users u
        WHERE u.group_id IS NULL
          AND NULLIF(
                REGEXP_REPLACE(
                    u.group_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
                ),
                ''
              ) IS NOT NULL
        ON CONFLICT (name) DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE users AS u
        SET group_id = g.id,
            group_name = g.name
        FROM groups AS g
        WHERE u.group_id IS NULL
          AND NULLIF(
                REGEXP_REPLACE(
                    u.group_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
                ),
                ''
              ) IS NOT NULL
          AND g.name = REGEXP_REPLACE(
                u.group_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
              )
        """
    )


def downgrade() -> None:
    # Data repair is compatible with the previous application version and should
    # not recreate invalid name-only memberships during rollback.
    pass
