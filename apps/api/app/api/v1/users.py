import csv
import io
import json
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
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


_ExportFormat = Literal["csv", "json"]


@router.get("/export")
async def export_users(
    format: _ExportFormat = Query("csv"),
    request: Request = None,  # type: ignore[assignment]
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    rows = (
        await db.execute(
            select(User).where(User.is_active.is_(True)).order_by(User.created_at.desc())
        )
    ).scalars().all()

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    if format == "json":
        payload = [
            {
                "id": str(u.id),
                "email": u.email,
                "name": u.name,
                "role": u.role,
                "group_name": u.group_name,
                "group_id": str(u.group_id) if u.group_id else None,
                "status": u.status,
                "created_at": u.created_at.isoformat(),
            }
            for u in rows
        ]
        body = json.dumps(payload, ensure_ascii=False, indent=2)
        await AuditService.log(
            db,
            actor=actor,
            action="user.export",
            target_type="user",
            target_id=None,
            request=request,
            status_code=200,
            detail={"format": "json", "count": len(rows)},
        )
        await db.commit()
        return StreamingResponse(
            iter([body]),
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="users_{ts}.json"'},
        )

    # CSV
    buf = io.StringIO()
    # Excel UTF-8 BOM 兼容
    buf.write("﻿")
    writer = csv.writer(buf)
    writer.writerow(["id", "email", "name", "role", "group_name", "group_id", "status", "created_at"])
    for u in rows:
        writer.writerow([
            str(u.id),
            u.email,
            u.name,
            u.role,
            u.group_name or "",
            str(u.group_id) if u.group_id else "",
            u.status,
            u.created_at.isoformat(),
        ])
    body = buf.getvalue()

    await AuditService.log(
        db,
        actor=actor,
        action="user.export",
        target_type="user",
        target_id=None,
        request=request,
        status_code=200,
        detail={"format": "csv", "count": len(rows)},
    )
    await db.commit()
    return StreamingResponse(
        iter([body]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="users_{ts}.csv"'},
    )


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


class GroupAssignPayload(BaseModel):
    group_id: str | None = None


@router.patch("/{user_id}/group", response_model=UserOut)
async def assign_user_group(
    user_id: str,
    payload: GroupAssignPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    from app.db.models.group import Group

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="用户不存在")

    new_group: Group | None = None
    if payload.group_id:
        new_group = await db.get(Group, payload.group_id)
        if new_group is None:
            raise HTTPException(status_code=404, detail="数据组不存在")

    old_group_id = user.group_id
    old_group_name = user.group_name
    user.group_id = new_group.id if new_group else None
    user.group_name = new_group.name if new_group else None

    await AuditService.log(
        db,
        actor=actor,
        action="user.group_change",
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={
            "email": user.email,
            "old_group_id": str(old_group_id) if old_group_id else None,
            "old_group_name": old_group_name,
            "new_group_id": str(new_group.id) if new_group else None,
            "new_group_name": new_group.name if new_group else None,
        },
    )
    await db.commit()
    await db.refresh(user)
    return user
