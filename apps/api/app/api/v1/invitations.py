from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.deps import get_db
from app.db.models.user import User
from app.schemas.invitation import (
    InvitationResolve,
    RegisterRequest,
    RegisterResponse,
)
from app.schemas.user import UserOut
from app.services.invitation import InvitationService
from app.services.audit import AuditService, AuditAction

router = APIRouter()


@router.get("/invitations/{token}", response_model=InvitationResolve)
async def resolve_invitation(token: str, db: AsyncSession = Depends(get_db)):
    inv = await InvitationService.resolve(db, token)
    inviter_name: str | None = None
    inviter = await db.get(User, inv.invited_by)
    if inviter is not None:
        inviter_name = inviter.name
    return InvitationResolve(
        email=inv.email,
        role=inv.role,
        group_name=inv.group_name,
        expires_at=inv.expires_at,
        invited_by_name=inviter_name,
    )


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register_via_invitation(
    payload: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user, inv = await InvitationService.accept(
        db,
        token=payload.token,
        name=payload.name,
        password=payload.password,
    )
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.USER_REGISTER,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=201,
        detail={
            "email": user.email,
            "role": user.role,
            "invitation_id": str(inv.id),
        },
    )
    await db.commit()
    await db.refresh(user)

    token = create_access_token(subject=str(user.id), role=user.role)
    return RegisterResponse(
        access_token=token,
        token_type="bearer",
        user=UserOut.model_validate(user),
    )
