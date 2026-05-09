"""v0.6.9 · 通知中心 REST。

- GET /notifications        list（unread_only / limit / offset）
- GET /notifications/unread-count  TopBar 角标
- POST /notifications/{id}/read    标记单条
- POST /notifications/mark-all-read 批量
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.db.models.user import User
from app.db.models.notification_preference import NotificationPreference
from app.schemas.notification import NotificationList, NotificationOut, UnreadCount
from app.services.notification import NotificationService


# v0.7.0：当前已知的可静音 type 列表 — 设置页据此渲染开关
KNOWN_NOTIFICATION_TYPES = [
    "bug_report.commented",
    "bug_report.reopened",
    "bug_report.status_changed",
    "batch.rejected",
    "task.approved",
    "task.rejected",
]


class NotificationPreferenceItem(BaseModel):
    type: str
    in_app: bool = True
    email: bool = False


class NotificationPreferencesOut(BaseModel):
    items: list[NotificationPreferenceItem]


class NotificationPreferenceUpdate(BaseModel):
    type: str
    in_app: bool


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
        raise HTTPException(
            status_code=404, detail="Notification not found or already read"
        )
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


@router.get("/notification-preferences", response_model=NotificationPreferencesOut)
async def get_preferences(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """v0.7.0：返回所有已知 type 的偏好；无记录默认 in_app=True / email=False。"""
    rows = (
        (
            await db.execute(
                select(NotificationPreference).where(
                    NotificationPreference.user_id == user.id
                )
            )
        )
        .scalars()
        .all()
    )
    by_type = {r.type: (r.channels or {}) for r in rows}
    items = []
    for t in KNOWN_NOTIFICATION_TYPES:
        ch = by_type.get(t, {})
        items.append(
            NotificationPreferenceItem(
                type=t,
                in_app=bool(ch.get("in_app", True)),
                email=bool(ch.get("email", False)),
            )
        )
    return NotificationPreferencesOut(items=items)


@router.put("/notification-preferences")
async def update_preference(
    data: NotificationPreferenceUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """v0.7.0：upsert 单条偏好。channels.email 字段保留但 v0.7.0 不消费。"""
    if data.type not in KNOWN_NOTIFICATION_TYPES:
        raise HTTPException(
            status_code=400, detail=f"unknown notification type: {data.type}"
        )

    stmt = (
        pg_insert(NotificationPreference)
        .values(
            user_id=user.id,
            type=data.type,
            channels={"in_app": data.in_app, "email": False},
        )
        .on_conflict_do_update(
            index_elements=["user_id", "type"],
            set_={
                "channels": {"in_app": data.in_app, "email": False},
            },
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True}
