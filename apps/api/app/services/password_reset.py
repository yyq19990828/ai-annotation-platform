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
        """生成重置 token。返回 None 表示 email 不存在（防枚举）。"""
        result = await self.db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if not user:
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
        result = await self.db.execute(
            select(PasswordResetToken).where(PasswordResetToken.token == token)
        )
        entry = result.scalar_one_or_none()
        if not entry:
            return None
        if entry.used_at is not None:
            return None
        if datetime.now(timezone.utc) > entry.expires_at:
            return None

        entry.used_at = datetime.now(timezone.utc)
        user = await self.db.get(User, entry.user_id)
        await self.db.flush()
        return user
