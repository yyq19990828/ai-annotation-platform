"""
首个 super_admin 引导脚本，与 seed.py 物理隔离，可在 production 安全运行。

用法（推荐通过环境变量传入）：
    cd apps/api
    ADMIN_EMAIL=ops@your-org.com \
    ADMIN_PASSWORD='change-me-now' \
    ADMIN_NAME='平台管理员' \
    uv run python -m scripts.bootstrap_admin
"""

import asyncio
import os
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.security import hash_password
from app.db.enums import UserRole
from app.db.models.audit_log import AuditLog
from app.db.models.user import User


def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        print(f"[bootstrap_admin] missing env: {key}", file=sys.stderr)
        raise SystemExit(2)
    return val


async def _bootstrap() -> int:
    email = _require_env("ADMIN_EMAIL").strip().lower()
    password = _require_env("ADMIN_PASSWORD")
    name = _require_env("ADMIN_NAME").strip()

    engine = create_async_engine(settings.database_url, echo=False)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        existing = await db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none() is not None:
            print(f"[bootstrap_admin] user {email} already exists, skip")
            return 0

        admin = User(
            email=email,
            name=name,
            password_hash=hash_password(password),
            role=UserRole.SUPER_ADMIN.value,
            group_name=None,
            status="online",
            is_active=True,
        )
        db.add(admin)
        await db.flush()

        db.add(
            AuditLog(
                actor_id=admin.id,
                actor_email=admin.email,
                actor_role=admin.role,
                action="system.bootstrap_admin",
                target_type="user",
                target_id=str(admin.id),
                method=None,
                path=None,
                status_code=None,
                ip=None,
                detail_json={"email": admin.email},
            )
        )
        await db.commit()
        print(f"[bootstrap_admin] created super_admin {email}")
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_bootstrap()))
