from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_roles
from app.db.enums import UserRole
from app.db.models.audit_log import AuditLog
from app.db.models.user import User
from app.schemas.audit import AuditLogList, AuditLogOut

router = APIRouter()


@router.get("", response_model=AuditLogList)
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    action: str | None = None,
    target_type: str | None = None,
    actor_id: str | None = None,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    base = select(AuditLog)
    count_q = select(func.count()).select_from(AuditLog)

    if action:
        base = base.where(AuditLog.action == action)
        count_q = count_q.where(AuditLog.action == action)
    if target_type:
        base = base.where(AuditLog.target_type == target_type)
        count_q = count_q.where(AuditLog.target_type == target_type)
    if actor_id:
        base = base.where(AuditLog.actor_id == actor_id)
        count_q = count_q.where(AuditLog.actor_id == actor_id)
    if from_:
        base = base.where(AuditLog.created_at >= from_)
        count_q = count_q.where(AuditLog.created_at >= from_)
    if to:
        base = base.where(AuditLog.created_at <= to)
        count_q = count_q.where(AuditLog.created_at <= to)

    total = (await db.execute(count_q)).scalar_one()
    rows = (
        await db.execute(
            base.order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    # 把 actor_email 即时回填（避免历史 actor_email=NULL 行的可读性差）
    items: list[AuditLogOut] = []
    cache: dict[str, str | None] = {}
    for r in rows:
        if r.actor_email is None and r.actor_id is not None:
            key = str(r.actor_id)
            if key not in cache:
                u = await db.get(User, r.actor_id)
                cache[key] = u.email if u is not None else None
            r.actor_email = cache[key]
        items.append(AuditLogOut.model_validate(r))

    return AuditLogList(items=items, total=total, page=page, page_size=page_size)
