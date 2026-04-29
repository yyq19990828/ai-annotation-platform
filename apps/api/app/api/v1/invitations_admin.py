"""Admin endpoints for managing user invitations (list / revoke / resend).

The /auth/invitations/{token} resolve and /auth/register endpoints live in
`invitations.py` and remain unauthenticated. This module mounts under
`/invitations` and requires the actor to be a project_admin or super_admin.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.user_invitation import UserInvitation
from app.deps import get_db, require_roles
from app.schemas.invitation import InvitationOut, InvitationResendResponse
from app.services.audit import AuditService
from app.services.invitation import InvitationService

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)
_StatusFilter = Literal["pending", "accepted", "expired", "revoked", "all"]
_ScopeFilter = Literal["me", "all"]


def _to_out(inv: UserInvitation, inviter: User | None) -> InvitationOut:
    return InvitationOut(
        id=inv.id,
        email=inv.email,
        role=inv.role,
        group_name=inv.group_name,
        status=inv.status,
        expires_at=inv.expires_at,
        invited_by=inv.invited_by,
        invited_by_name=inviter.name if inviter else None,
        accepted_at=inv.accepted_at,
        revoked_at=inv.revoked_at,
        created_at=inv.created_at,
    )


@router.get("", response_model=list[InvitationOut])
async def list_invitations(
    status_filter: _StatusFilter = Query("all", alias="status"),
    scope: _ScopeFilter = Query("me"),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    if scope == "all" and actor.role != UserRole.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="仅超级管理员可查看全部邀请")

    q = select(UserInvitation)
    if scope == "me":
        q = q.where(UserInvitation.invited_by == actor.id)

    rows = (await db.execute(q.order_by(UserInvitation.created_at.desc()))).scalars().all()

    if status_filter != "all":
        rows = [r for r in rows if r.status == status_filter]

    inviter_ids = {r.invited_by for r in rows}
    inviters: dict[uuid.UUID, User] = {}
    if inviter_ids:
        u_rows = (
            await db.execute(select(User).where(User.id.in_(inviter_ids)))
        ).scalars().all()
        inviters = {u.id: u for u in u_rows}

    return [_to_out(r, inviters.get(r.invited_by)) for r in rows]


@router.delete("/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    invitation_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    inv = await InvitationService.revoke(db, invitation_id)
    await AuditService.log(
        db,
        actor=actor,
        action="user.invite_revoke",
        target_type="invitation",
        target_id=str(invitation_id),
        request=request,
        status_code=204,
        detail={"email": inv.email, "role": inv.role},
    )
    await db.commit()


@router.post("/{invitation_id}/resend", response_model=InvitationResendResponse)
async def resend_invitation(
    invitation_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    inv = await InvitationService.resend(db, invitation_id)
    await AuditService.log(
        db,
        actor=actor,
        action="user.invite_resend",
        target_type="invitation",
        target_id=str(invitation_id),
        request=request,
        status_code=200,
        detail={"email": inv.email, "role": inv.role},
    )
    await db.commit()
    invite_url = f"{settings.frontend_base_url.rstrip('/')}/register?token={inv.token}"
    return InvitationResendResponse(
        invite_url=invite_url,
        token=inv.token,
        expires_at=inv.expires_at,
    )
