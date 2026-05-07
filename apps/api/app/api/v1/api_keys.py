"""v0.9.3 · /me/api-keys CRUD。

- list/create/revoke 均针对当前登录用户自己的 keys，不分角色（每个用户都可管理自己）。
- create 响应一次性返回 plaintext，前端必须当场展示并提示用户复制；之后无法再获取。
- revoke 是软删（revoked_at 落时间戳），不删行，方便审计追溯 last_used_at。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.db.models.user import User
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreated, ApiKeyOut
from app.services import api_key_service

router = APIRouter()


@router.get("", response_model=list[ApiKeyOut])
async def list_my_keys(
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
):
    keys = await api_key_service.list_keys(db, me.id)
    return keys


@router.post("", response_model=ApiKeyCreated, status_code=201)
async def create_my_key(
    data: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
):
    key, plaintext = await api_key_service.create_key(db, me, data.name, data.scopes)
    await db.commit()
    await db.refresh(key)
    return ApiKeyCreated(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        scopes=list(key.scopes or []),
        last_used_at=key.last_used_at,
        revoked_at=key.revoked_at,
        created_at=key.created_at,
        plaintext=plaintext,
    )


@router.delete("/{key_id}", status_code=204)
async def revoke_my_key(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
):
    ok = await api_key_service.revoke_key(db, me.id, key_id)
    if not ok:
        raise HTTPException(status_code=404, detail="API key 不存在或已吊销")
    await db.commit()
