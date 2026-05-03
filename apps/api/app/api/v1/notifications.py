"""v0.6.9 · 通知中心 REST。

- GET /notifications        list（unread_only / limit / offset）
- GET /notifications/unread-count  TopBar 角标
- POST /notifications/{id}/read    标记单条
- POST /notifications/mark-all-read 批量
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.db.models.user import User
from app.schemas.notification import NotificationList, NotificationOut, UnreadCount
from app.services.notification import NotificationService


router = APIRouter()


@router.get("/notifications", response_model=NotificationList)
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    svc = NotificationService(db)
    items, total, unread = await svc.list_for_user(
        user.id, unread_only=unread_only, limit=limit, offset=offset
    )
    return NotificationList(
        items=[NotificationOut.model_validate(i) for i in items],
        total=total,
        unread=unread,
    )


@router.get("/notifications/unread-count", response_model=UnreadCount)
async def unread_count(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    svc = NotificationService(db)
    return UnreadCount(unread=await svc.unread_count(user.id))


@router.post("/notifications/{notification_id}/read")
async def mark_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    svc = NotificationService(db)
    ok = await svc.mark_read(user.id, notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found or already read")
    await db.commit()
    return {"ok": True}


@router.post("/notifications/mark-all-read")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    svc = NotificationService(db)
    n = await svc.mark_all_read(user.id)
    await db.commit()
    return {"updated": n}
