"""Convert global staff roles and backfill invitation project roles.

This is the Increment-B data conversion that follows the additive preparation
of revision 0173.

What it does (deterministically, without guessing):

* ``users.role`` values ``annotator`` / ``reviewer`` become ``employee``.
  Account IDs, activation state, lifecycle metadata and every other column are
  preserved; inactive accounts are converted without being reactivated.
* Pending project invitations gain an explicit ``project_role`` from the role
  they already carried, and their platform role is normalised to ``employee``
  (or kept ``viewer``).  Accepted / revoked / expired invitations are left
  untouched as historical facts.
* Pending account-only staff invitations adopt ``employee`` with no project
  role.

What it deliberately does NOT do:

* It never creates memberships from a global role and never derives authority
  from ``users.role``.  A missing membership stays missing and fails closed.
* It does not add final ``CHECK`` constraints.  Unknown or unexpected legacy
  values must be reconciled by an operator through the audit gate first; the
  final constraints belong to the compatibility-cleanup increment.
* It does not drop the legacy ``annotator`` / ``reviewer`` code paths that
  historical records and the read-only audit still reference.

Rollback boundary
-----------------
The upgrade is not losslessly reversible: after the cutover an employee may
legitimately be an annotator in one project and a reviewer in another, so the
old global role cannot represent the new state.  A blind downgrade is rejected.
Set ``AAP_ALLOW_ROLE_MIGRATION_DOWNGRADE=1`` to run the conservative,
explicitly lossy reverse used only for a rehearsed isolated database: it
restores ``annotator`` / ``reviewer`` for employees whose memberships are
unambiguous, restores pending invitation project roles, and leaves genuinely
mixed or unassigned employees as ``employee``.

Revision ID: 0174
Revises: 0173
"""

from __future__ import annotations

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision = "0174"
down_revision: str | Sequence[str] | None = "0173"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DOWNGRADE_GATE_ENV = "AAP_ALLOW_ROLE_MIGRATION_DOWNGRADE"

#: Pending invitations only: accepted / revoked / expired rows are history.
_PENDING_INVITATION_PREDICATE = """
    accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
"""


def upgrade() -> None:
    # 1. Convert the global staff identities.  Nothing else about the account
    #    changes; legacy values survive only in preserved historical records.
    op.execute(
        sa.text(
            """
            UPDATE users
            SET role = 'employee'
            WHERE role IN ('annotator', 'reviewer')
            """
        )
    )

    # 2. Pending project invitations: capture the project responsibility before
    #    normalising the platform role, so acceptance still grants exactly the
    #    intended membership.
    op.execute(
        sa.text(
            f"""
            UPDATE user_invitations
            SET project_role = role,
                role = 'employee'
            WHERE project_id IS NOT NULL
              AND project_role IS NULL
              AND role IN ('annotator', 'reviewer')
              AND {_PENDING_INVITATION_PREDICATE}
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE user_invitations
            SET project_role = 'viewer'
            WHERE project_id IS NOT NULL
              AND project_role IS NULL
              AND role = 'viewer'
              AND {_PENDING_INVITATION_PREDICATE}
            """
        )
    )

    # 3. Pending account-only staff invitations become employee with no project
    #    role; account-only viewer invitations keep the viewer platform role.
    op.execute(
        sa.text(
            f"""
            UPDATE user_invitations
            SET role = 'employee'
            WHERE project_id IS NULL
              AND role IN ('annotator', 'reviewer')
              AND {_PENDING_INVITATION_PREDICATE}
            """
        )
    )


def downgrade() -> None:
    if os.environ.get(_DOWNGRADE_GATE_ENV) != "1":
        raise RuntimeError(
            "0174 downgrade is gated: the employee cutover is not losslessly "
            "reversible. Restore the pre-migration snapshot, or set "
            f"{_DOWNGRADE_GATE_ENV}=1 for a rehearsed isolated database."
        )

    # Conservative, explicitly lossy reverse: only employees whose memberships
    # agree on a single work role are restored; anything ambiguous stays
    # employee.
    op.execute(
        sa.text(
            """
            UPDATE users AS u
            SET role = restored.role
            FROM (
                SELECT pm.user_id,
                       CASE
                           WHEN COUNT(DISTINCT pm.role) = 1
                               AND MIN(pm.role) IN ('annotator', 'reviewer')
                           THEN MIN(pm.role)
                           ELSE NULL
                       END AS role
                FROM project_members AS pm
                JOIN users AS member_user
                  ON member_user.id = pm.user_id
                 AND member_user.role = 'employee'
                GROUP BY pm.user_id
            ) AS restored
            WHERE u.id = restored.user_id
              AND u.role = 'employee'
              AND restored.role IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE user_invitations
            SET role = project_role,
                project_role = NULL
            WHERE project_id IS NOT NULL
              AND project_role IS NOT NULL
              AND {_PENDING_INVITATION_PREDICATE}
            """
        )
    )
