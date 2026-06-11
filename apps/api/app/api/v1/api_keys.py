"""v0.9.3 · /me/api-keys CRUD（v0.15.11 加 rotate / patch / 过期）。

- list/create/revoke/rotate/patch 均针对当前登录用户自己的 keys，不分角色。
- create / rotate 响应一次性返回 plaintext，前端必须当场展示并提示复制；之后无法再获取。
- revoke 是软删（revoked_at 落时间戳），不删行，方便审计追溯 last_used_at。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.db.models.user import User
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreated, ApiKeyOut, ApiKeyUpdate
from app.services import api_key_service

router = APIRouter()


def _expires_at_from_days(days: int | None) -> datetime | None:
    if days is None:
        return None
    return datetime.now(timezone.utc) + timedelta(days=days)


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
    key, plaintext = await api_key_service.create_key(
        db, me, data.name, data.scopes, _expires_at_from_days(data.expires_in_days)
    )
    await db.commit()
    await db.refresh(key)
    return ApiKeyCreated(**ApiKeyOut.model_validate(key).model_dump(), plaintext=plaintext)


@router.patch("/{key_id}", response_model=ApiKeyOut)
async def update_my_key(
    key_id: uuid.UUID,
    data: ApiKeyUpdate,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
):
    fields = data.model_fields_set
    kwargs = {}
    if "name" in fields:
        kwargs["name"] = data.name
    if "scopes" in fields:
        kwargs["scopes"] = data.scopes
    if "expires_in_days" in fields:
        kwargs["expires_at"] = _expires_at_from_days(data.expires_in_days)
    key = await api_key_service.update_key(db, me.id, key_id, **kwargs)
    if key is None:
        raise HTTPException(status_code=404, detail="API key 不存在或已吊销")
    await db.commit()
    await db.refresh(key)
    return key


@router.post("/{key_id}/rotate", response_model=ApiKeyCreated)
async def rotate_my_key(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(get_current_user),
):
    result = await api_key_service.rotate_key(db, me.id, key_id)
    if result is None:
        raise HTTPException(status_code=404, detail="API key 不存在或已吊销")
    key, plaintext = result
    await db.commit()
    await db.refresh(key)
    return ApiKeyCreated(**ApiKeyOut.model_validate(key).model_dump(), plaintext=plaintext)


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
