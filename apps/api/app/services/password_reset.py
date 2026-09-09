from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.password_reset_token import PasswordResetToken
from app.db.models.user import User


class PasswordResetService:
    TOKEN_EXPIRY_HOURS = 1

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_token(self, email: str) -> str | None:
        """生成重置 token。返回 None 表示邮箱不存在或账号不可用（防枚举）。"""
        result = await self.db.execute(
            select(User)
            .where(User.email == email)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            return None

        token = secrets.token_hex(32)
        entry = PasswordResetToken(
            id=uuid.uuid4(),
            user_id=user.id,
            token=token,
            expires_at=datetime.now(timezone.utc)
            + timedelta(hours=self.TOKEN_EXPIRY_HOURS),
        )
        self.db.add(entry)
        await self.db.flush()
        return token

    async def consume_token(self, token: str) -> User | None:
        """验证并消费 token，返回关联用户。返回 None 表示无效/过期/已用。"""
        # Lifecycle changes lock User before retiring reset tokens. Resolve the
        # immutable owner first, then use the same User -> token lock order.
        user_id = await self.db.scalar(
            select(PasswordResetToken.user_id).where(PasswordResetToken.token == token)
        )
        if user_id is None:
            return None
        user = await self.db.scalar(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        result = await self.db.execute(
            select(PasswordResetToken)
            .where(PasswordResetToken.token == token)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        entry = result.scalar_one_or_none()
        if not entry:
            return None
        if entry.used_at is not None:
            return None
        if datetime.now(timezone.utc) >= entry.expires_at:
            return None

        entry.used_at = datetime.now(timezone.utc)
        await self.db.flush()
        if user is None or not user.is_active:
            return None
        return user

    async def invalidate_token(self, token: str) -> None:
        """让尚未发送出去的 token 失效。

        邮件发送属于数据库事务之外的外部副作用。发送明确失败时将 token 标记
        为已使用，避免失败请求留下可猜测或被误用的有效恢复凭据；申请入口仍
        由现有速率限制保护，用户可以稍后重新申请。
        """
        result = await self.db.execute(
            select(PasswordResetToken)
            .where(PasswordResetToken.token == token)
            .with_for_update()
        )
        entry = result.scalar_one_or_none()
        if entry is not None and entry.used_at is None:
            entry.used_at = datetime.now(timezone.utc)
            await self.db.flush()
