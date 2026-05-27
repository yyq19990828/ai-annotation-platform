from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.email_verification_token import EmailVerificationToken
from app.db.models.user import User


class EmailVerificationService:
    """v0.12.0 · 开放注册邮箱验证 token 生成 / 消费（对齐 PasswordResetService）。"""

    TOKEN_EXPIRY_HOURS = 24

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_token(self, user: User) -> str:
        """为未验证用户生成验证 token。"""
        token = secrets.token_hex(32)
        entry = EmailVerificationToken(
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
        """验证并消费 token，置 user.email_verified_at。无效/过期/已用返回 None。"""
        result = await self.db.execute(
            select(EmailVerificationToken).where(
                EmailVerificationToken.token == token
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            return None
        if entry.used_at is not None:
            return None
        if datetime.now(timezone.utc) > entry.expires_at:
            return None

        now = datetime.now(timezone.utc)
        entry.used_at = now
        user = await self.db.get(User, entry.user_id)
        if user is not None and user.email_verified_at is None:
            user.email_verified_at = now
        await self.db.flush()
        return user
