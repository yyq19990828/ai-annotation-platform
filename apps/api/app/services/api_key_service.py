"""v0.9.3 · API Key 生成 / 校验。

token 形态：``ak_`` + 32 字符 url-safe base64（`secrets.token_urlsafe(24)` 输出 32 字符）。
入库存 bcrypt(plaintext)；前 12 字符（含 ``ak_``）作 key_prefix 用于列表展示与定位。

校验流程（被 deps.get_current_user 复用）：
1. 头 3 字符必须为 ``ak_``；否则非 api_key token，跳过。
2. 取前 12 字符作 prefix，查同 prefix 未吊销 ApiKey 行（通常 ≤ 1 行；冲突极小）。
3. 候选行逐个 ``bcrypt.checkpw``；命中即返回 ApiKey + 关联 user。
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.db.models.api_key import ApiKey
from app.db.models.user import User

_PREFIX = "ak_"
_PREFIX_LEN = 12  # "ak_" + 9 chars
_TOKEN_RANDOM_BYTES = 24  # token_urlsafe(24) -> 32 chars


def generate_token() -> tuple[str, str]:
    """返回 (plaintext, key_prefix)。plaintext 仅返回一次，不入库。"""
    plaintext = _PREFIX + secrets.token_urlsafe(_TOKEN_RANDOM_BYTES)
    return plaintext, plaintext[:_PREFIX_LEN]


def is_api_key_token(token: str) -> bool:
    return token.startswith(_PREFIX)


async def list_keys(db: AsyncSession, user_id) -> list[ApiKey]:
    """列出某用户的全部 keys（含已 revoked，按 created_at desc）。"""
    res = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == user_id)
        .order_by(ApiKey.created_at.desc())
    )
    return list(res.scalars().all())


async def create_key(
    db: AsyncSession,
    user: User,
    name: str,
    scopes: list[str],
    expires_at: datetime | None = None,
) -> tuple[ApiKey, str]:
    """生成 + 入库；返回 (entity, plaintext)。调用方需 commit。"""
    plaintext, prefix = generate_token()
    key = ApiKey(
        user_id=user.id,
        name=name,
        key_prefix=prefix,
        key_hash=hash_password(plaintext),
        scopes=scopes,
        expires_at=expires_at,
    )
    db.add(key)
    await db.flush()
    await db.refresh(key)
    return key, plaintext


async def _get_owned(db: AsyncSession, user_id, key_id) -> ApiKey | None:
    res = await db.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user_id)
    )
    return res.scalar_one_or_none()


async def revoke_key(db: AsyncSession, user_id, key_id) -> bool:
    key = await _get_owned(db, user_id, key_id)
    if key is None or key.revoked_at is not None:
        return False
    key.revoked_at = datetime.now(timezone.utc)
    await db.flush()
    return True


async def rotate_key(db: AsyncSession, user_id, key_id) -> tuple[ApiKey, str] | None:
    """轮换：换新明文/hash/prefix，保留 id/name/scopes/expires_at；旧明文立即失效。

    返回 (entity, new_plaintext)；key 不存在 / 已吊销返 None。调用方需 commit。
    """
    key = await _get_owned(db, user_id, key_id)
    if key is None or key.revoked_at is not None:
        return None
    plaintext, prefix = generate_token()
    key.key_hash = hash_password(plaintext)
    key.key_prefix = prefix
    key.last_used_at = None
    await db.flush()
    await db.refresh(key)
    return key, plaintext


_UNSET = object()


async def update_key(
    db: AsyncSession,
    user_id,
    key_id,
    *,
    name=_UNSET,
    scopes=_UNSET,
    expires_at=_UNSET,
) -> ApiKey | None:
    """部分更新 name / scopes / expires_at（不动 hash）。

    用 _UNSET 哨兵区分「不改」与「显式置 None」（如把 expires_at 改回永不过期）。
    返回更新后的 entity；key 不存在 / 已吊销返 None。调用方需 commit。
    """
    key = await _get_owned(db, user_id, key_id)
    if key is None or key.revoked_at is not None:
        return None
    if name is not _UNSET:
        key.name = name
    if scopes is not _UNSET:
        key.scopes = scopes
    if expires_at is not _UNSET:
        key.expires_at = expires_at
    await db.flush()
    await db.refresh(key)
    return key


async def resolve_token(db: AsyncSession, token: str) -> tuple[ApiKey, User] | None:
    """ak_ token → (ApiKey, User)。无效 / revoked 返 None。
    命中后顺手刷新 last_used_at（最终 commit 由调用方控制）。
    """
    if not is_api_key_token(token) or len(token) < _PREFIX_LEN:
        return None
    prefix = token[:_PREFIX_LEN]
    res = await db.execute(
        select(ApiKey).where(ApiKey.key_prefix == prefix, ApiKey.revoked_at.is_(None))
    )
    candidates: Iterable[ApiKey] = res.scalars().all()
    now = datetime.now(timezone.utc)
    for key in candidates:
        if verify_password(token, key.key_hash):
            if key.expires_at is not None and key.expires_at < now:
                return None  # 已过期
            user = await db.get(User, key.user_id)
            if user is None or not user.is_active:
                return None
            key.last_used_at = now
            return key, user
    return None
