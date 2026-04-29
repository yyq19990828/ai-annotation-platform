from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.config import settings
from app.deps import get_db, require_roles, get_current_user
from app.db.models.user import User
from app.db.enums import UserRole
from app.schemas.user import UserOut
from app.schemas.invitation import InvitationCreate, InvitationCreated
from app.services.invitation import InvitationService
from app.services.audit import AuditService, AuditAction

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


@router.get("", response_model=list[UserOut])
async def list_users(
    role: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_MANAGERS)),
):
    q = select(User).where(User.is_active.is_(True))
    if role:
        q = q.where(User.role == role)
    result = await db.execute(q.order_by(User.created_at.desc()))
    return result.scalars().all()


@router.post(
    "/invite",
    response_model=InvitationCreated,
    status_code=status.HTTP_201_CREATED,
)
async def invite_user(
    payload: InvitationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    inv = await InvitationService.create(
        db,
        email=payload.email,
        role=payload.role,
        group_name=payload.group_name,
        invited_by=actor.id,
    )
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.USER_INVITE,
        target_type="user",
        target_id=inv.email,
        request=request,
        status_code=201,
        detail={"role": inv.role, "group_name": inv.group_name},
    )
    await db.commit()

    invite_url = f"{settings.frontend_base_url.rstrip('/')}/register?token={inv.token}"
    return InvitationCreated(
        invite_url=invite_url,
        token=inv.token,
        expires_at=inv.expires_at,
    )


class RoleChangePayload(BaseModel):
    role: str


@router.patch("/{user_id}/role", response_model=UserOut)
async def change_user_role(
    user_id: str,
    payload: RoleChangePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    if payload.role not in {r.value for r in UserRole}:
        raise HTTPException(status_code=400, detail=f"非法角色: {payload.role}")

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")

    old_role = user.role
    if old_role == payload.role:
        return user

    user.role = payload.role
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.USER_ROLE_CHANGE,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={"email": user.email, "old": old_role, "new": payload.role},
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/{user_id}/deactivate", response_model=UserOut)
async def deactivate_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="不能停用自己")
    if not user.is_active:
        return user

    user.is_active = False
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.USER_DEACTIVATE,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={"email": user.email},
    )
    await db.commit()
    await db.refresh(user)
    return user
