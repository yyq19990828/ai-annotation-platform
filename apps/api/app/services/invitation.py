from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import hash_password
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.user_invitation import UserInvitation


_ALLOWED_ROLES = {r.value for r in UserRole}


class InvitationService:
    @staticmethod
    async def create(
        db: AsyncSession,
        *,
        email: str,
        role: str,
        group_name: str | None,
        invited_by: uuid.UUID,
    ) -> UserInvitation:
        if role not in _ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail=f"非法角色: {role}")

        # 已激活用户存在 → 拒绝
        active = await db.execute(
            select(User).where(User.email == email, User.is_active.is_(True))
        )
        if active.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"邮箱 {email} 已注册",
            )

        # 作废同 email 仍 pending 的旧邀请（accepted_at IS NULL）
        now = datetime.now(timezone.utc)
        await db.execute(
            update(UserInvitation)
            .where(UserInvitation.email == email, UserInvitation.accepted_at.is_(None))
            .values(expires_at=now)
        )

        token = secrets.token_urlsafe(32)
        inv = UserInvitation(
            email=email,
            role=role,
            group_name=group_name,
            token=token,
            expires_at=now + timedelta(days=settings.invitation_ttl_days),
            invited_by=invited_by,
        )
        db.add(inv)
        await db.flush()
        return inv

    @staticmethod
    async def resolve(db: AsyncSession, token: str) -> UserInvitation:
        result = await db.execute(
            select(UserInvitation).where(UserInvitation.token == token)
        )
        inv = result.scalar_one_or_none()
        if inv is None:
            raise HTTPException(status_code=404, detail="邀请链接无效")
        if inv.accepted_at is not None:
            raise HTTPException(status_code=410, detail="该邀请已被使用")
        if inv.expires_at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="该邀请已过期")
        return inv

    @staticmethod
    async def revoke(db: AsyncSession, invitation_id: uuid.UUID) -> UserInvitation:
        inv = await db.get(UserInvitation, invitation_id)
        if inv is None:
            raise HTTPException(status_code=404, detail="邀请不存在")
        if inv.accepted_at is not None:
            raise HTTPException(status_code=400, detail="该邀请已被接受，无法撤销")
        if inv.revoked_at is not None:
            return inv
        inv.revoked_at = datetime.now(timezone.utc)
        await db.flush()
        return inv

    @staticmethod
    async def resend(db: AsyncSession, invitation_id: uuid.UUID) -> UserInvitation:
        inv = await db.get(UserInvitation, invitation_id)
        if inv is None:
            raise HTTPException(status_code=404, detail="邀请不存在")
        if inv.accepted_at is not None:
            raise HTTPException(status_code=400, detail="该邀请已被接受，无法重发")
        inv.token = secrets.token_urlsafe(32)
        inv.expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.invitation_ttl_days
        )
        inv.revoked_at = None
        await db.flush()
        return inv

    @staticmethod
    async def accept(
        db: AsyncSession,
        *,
        token: str,
        name: str,
        password: str,
    ) -> tuple[User, UserInvitation]:
        inv = await InvitationService.resolve(db, token)

        # 二次防御：注册期间该 email 是否被抢占
        existing = await db.execute(
            select(User).where(User.email == inv.email, User.is_active.is_(True))
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="该邮箱已被注册")

        user = User(
            email=inv.email,
            name=name,
            password_hash=hash_password(password),
            role=inv.role,
            group_name=inv.group_name,
            status="online",
            is_active=True,
        )
        db.add(user)
        await db.flush()

        inv.accepted_at = datetime.now(timezone.utc)
        inv.accepted_user_id = user.id
        await db.flush()
        return user, inv
