from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import hash_password
from app.db.enums import UserRole
from app.db.models.group import Group
from app.db.models.user import User
from app.db.models.user_invitation import UserInvitation
from app.services.system_settings_service import SystemSettingsService


_ALLOWED_ROLES = {r.value for r in UserRole}
_PROJECT_ADMIN_INVITABLE_ROLES = {
    UserRole.REVIEWER.value,
    UserRole.ANNOTATOR.value,
    UserRole.VIEWER.value,
}
_PRIVILEGED_ROLES = {
    UserRole.SUPER_ADMIN.value,
    UserRole.PROJECT_ADMIN.value,
}


async def _lock_invitation_email(db: AsyncSession, email: str) -> None:
    await db.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(email, 0)))
    )


async def _resolve_or_create_group(db: AsyncSession, name: str) -> Group:
    query = select(Group).where(Group.name == name).with_for_update(read=True)
    group = await db.scalar(query)
    if group is not None:
        return group

    await db.execute(
        pg_insert(Group)
        .values(name=name)
        .on_conflict_do_nothing(index_elements=[Group.name])
    )
    group = await db.scalar(query)
    if group is None:  # pragma: no cover - INSERT 后的行在同事务内应始终可见
        raise RuntimeError("failed to resolve invitation group")
    return group


async def _get_manageable_invitation(
    db: AsyncSession, invitation_id: uuid.UUID, actor: User
) -> UserInvitation:
    query = select(UserInvitation).where(UserInvitation.id == invitation_id)
    if actor.role != UserRole.SUPER_ADMIN.value:
        query = query.where(UserInvitation.invited_by == actor.id)
    invitation = await db.scalar(query.with_for_update())
    if invitation is None:
        raise HTTPException(status_code=404, detail="邀请不存在")
    return invitation


class InvitationService:
    @staticmethod
    async def check_daily_limit(db: AsyncSession, actor_id: uuid.UUID) -> None:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        result = await db.execute(
            select(func.count())
            .select_from(UserInvitation)
            .where(
                UserInvitation.invited_by == actor_id,
                UserInvitation.created_at >= since,
            )
        )
        count = result.scalar_one()
        if count >= settings.max_invitations_per_day:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"每日邀请上限 {settings.max_invitations_per_day} 次，请明天再试",
            )

    @staticmethod
    async def create(
        db: AsyncSession,
        *,
        email: str,
        role: str,
        group_name: str | None,
        actor: User,
    ) -> UserInvitation:
        if role not in _ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail=f"非法角色: {role}")
        if (
            actor.role != UserRole.SUPER_ADMIN.value
            and role not in _PROJECT_ADMIN_INVITABLE_ROLES
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="项目管理员仅能邀请审核员、标注员或观察者",
            )

        await InvitationService.check_daily_limit(db, actor.id)
        await _lock_invitation_email(db, email)

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
        expire_old = update(UserInvitation).where(
            UserInvitation.email == email,
            UserInvitation.accepted_at.is_(None),
        )
        if actor.role != UserRole.SUPER_ADMIN.value:
            expire_old = expire_old.where(UserInvitation.invited_by == actor.id)
        await db.execute(expire_old.values(expires_at=now))

        token = secrets.token_urlsafe(32)
        ttl_days = int(
            await SystemSettingsService.get(db, "invitation_ttl_days")
            or settings.invitation_ttl_days
        )
        inv = UserInvitation(
            email=email,
            role=role,
            group_name=group_name,
            token=token,
            expires_at=now + timedelta(days=ttl_days),
            invited_by=actor.id,
        )
        db.add(inv)
        await db.flush()
        return inv

    @staticmethod
    async def resolve(
        db: AsyncSession, token: str, *, for_update: bool = False
    ) -> UserInvitation:
        query = select(UserInvitation).where(UserInvitation.token == token)
        if for_update:
            query = query.with_for_update()
        result = await db.execute(query)
        inv = result.scalar_one_or_none()
        if inv is None:
            raise HTTPException(status_code=404, detail="邀请链接无效")
        if inv.accepted_at is not None:
            raise HTTPException(status_code=410, detail="该邀请已被使用")
        if inv.revoked_at is not None:
            raise HTTPException(status_code=410, detail="该邀请已撤销")
        if inv.expires_at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="该邀请已过期")
        if inv.role in _PRIVILEGED_ROLES:
            authorized_inviter = await db.scalar(
                select(User.id).where(
                    User.id == inv.invited_by,
                    User.role == UserRole.SUPER_ADMIN.value,
                    User.is_active.is_(True),
                )
            )
            if authorized_inviter is None:
                raise HTTPException(status_code=410, detail="该邀请权限已失效")
        return inv

    @staticmethod
    async def revoke(
        db: AsyncSession, invitation_id: uuid.UUID, *, actor: User
    ) -> UserInvitation:
        inv = await _get_manageable_invitation(db, invitation_id, actor)
        if inv.accepted_at is not None:
            raise HTTPException(status_code=400, detail="该邀请已被接受，无法撤销")
        if inv.revoked_at is not None:
            return inv
        now = datetime.now(timezone.utc)
        inv.revoked_at = now
        inv.expires_at = now
        await db.flush()
        return inv

    @staticmethod
    async def resend(
        db: AsyncSession, invitation_id: uuid.UUID, *, actor: User
    ) -> UserInvitation:
        inv = await _get_manageable_invitation(db, invitation_id, actor)
        if (
            actor.role == UserRole.PROJECT_ADMIN.value
            and inv.role not in _PROJECT_ADMIN_INVITABLE_ROLES
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="项目管理员不能重发高权限邀请",
            )
        if inv.accepted_at is not None:
            raise HTTPException(status_code=400, detail="该邀请已被接受，无法重发")
        inv.token = secrets.token_urlsafe(32)
        ttl_days = int(
            await SystemSettingsService.get(db, "invitation_ttl_days")
            or settings.invitation_ttl_days
        )
        inv.expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)
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
        await _lock_invitation_email(db, inv.email)
        inv = await InvitationService.resolve(db, token, for_update=True)

        # 二次防御：注册期间该 email 是否被抢占
        existing = await db.execute(
            select(User).where(User.email == inv.email, User.is_active.is_(True))
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="该邮箱已被注册")

        group_name = (inv.group_name or "").strip() or None
        if group_name is not None and len(group_name) > 100:
            raise HTTPException(
                status_code=409,
                detail="邀请中的数据组名称无效，请联系管理员重发邀请",
            )
        group = (
            await _resolve_or_create_group(db, group_name)
            if group_name is not None
            else None
        )

        user = User(
            email=inv.email,
            name=name,
            password_hash=hash_password(password),
            role=inv.role,
            group_name=group.name if group else None,
            group_id=group.id if group else None,
            status="online",
            is_active=True,
            # v0.12.0 · 邀请 token 本身即身份证明，邀请注册恒视为已验证
            email_verified_at=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.flush()

        inv.group_name = group.name if group else None
        inv.accepted_at = datetime.now(timezone.utc)
        inv.accepted_user_id = user.id
        await db.flush()
        return user, inv
