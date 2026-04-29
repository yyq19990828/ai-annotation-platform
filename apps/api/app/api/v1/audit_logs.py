import base64
import csv
import io
import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, outerjoin, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_roles
from app.db.enums import UserRole
from app.db.models.audit_log import AuditLog
from app.db.models.user import User
from app.schemas.audit import AuditLogList, AuditLogOut

router = APIRouter()


def _build_base_query(
    action: str | None,
    target_type: str | None,
    actor_id: str | None,
    from_: datetime | None,
    to: datetime | None,
):
    """返回带 actor_email JOIN 的基础 select，避免 N+1。"""
    j = outerjoin(AuditLog, User, AuditLog.actor_id == User.id)
    base = (
        select(AuditLog, User.email.label("_u_email"))
        .select_from(j)
    )
    count_base = select(func.count()).select_from(AuditLog)

    if action:
        base = base.where(AuditLog.action == action)
        count_base = count_base.where(AuditLog.action == action)
    if target_type:
        base = base.where(AuditLog.target_type == target_type)
        count_base = count_base.where(AuditLog.target_type == target_type)
    if actor_id:
        base = base.where(AuditLog.actor_id == actor_id)
        count_base = count_base.where(AuditLog.actor_id == actor_id)
    if from_:
        base = base.where(AuditLog.created_at >= from_)
        count_base = count_base.where(AuditLog.created_at >= from_)
    if to:
        base = base.where(AuditLog.created_at <= to)
        count_base = count_base.where(AuditLog.created_at <= to)

    return base, count_base


def _row_to_out(row) -> AuditLogOut:
    log, u_email = row
    # actor_email 优先使用 JOIN 结果，兼容历史已存名字段
    if log.actor_email is None and u_email is not None:
        log.actor_email = u_email
    return AuditLogOut.model_validate(log)


def _encode_cursor(created_at: datetime, id_: int) -> str:
    payload = f"{created_at.isoformat()}|{id_}"
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    payload = base64.urlsafe_b64decode(cursor.encode()).decode()
    ts_str, id_str = payload.rsplit("|", 1)
    return datetime.fromisoformat(ts_str), int(id_str)


@router.get("", response_model=AuditLogList)
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    cursor: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
    actor_id: str | None = None,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    base, count_q = _build_base_query(action, target_type, actor_id, from_, to)

    total = (await db.execute(count_q)).scalar_one()

    if cursor:
        cur_ts, cur_id = _decode_cursor(cursor)
        paged = base.where(
            (AuditLog.created_at < cur_ts)
            | ((AuditLog.created_at == cur_ts) & (AuditLog.id < cur_id))
        )
    else:
        paged = base.offset((page - 1) * page_size)

    rows = (
        await db.execute(
            paged.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(page_size)
        )
    ).all()

    items = [_row_to_out(r) for r in rows]

    next_cursor = None
    if len(items) == page_size and items:
        last = items[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)

    return AuditLogList(items=items, total=total, page=page, page_size=page_size, next_cursor=next_cursor)


@router.get("/export")
async def export_audit_logs(
    format: Literal["csv", "json"] = "csv",
    action: str | None = None,
    target_type: str | None = None,
    actor_id: str | None = None,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    _MAX_ROWS = 50_000
    base, count_q = _build_base_query(action, target_type, actor_id, from_, to)

    total = (await db.execute(count_q)).scalar_one()
    if total > _MAX_ROWS:
        from fastapi import HTTPException
        raise HTTPException(status_code=413, detail=f"导出条数超过 {_MAX_ROWS}，请缩小筛选范围")

    rows = (
        await db.execute(
            base.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(_MAX_ROWS)
        )
    ).all()
    items = [_row_to_out(r) for r in rows]

    # 记录自身的导出操作
    from app.services.audit import AuditService
    await AuditService.log(
        db,
        actor=current_user,
        action="audit.export",
        target_type="audit_logs",
        status_code=200,
        detail={"format": format, "rows": len(items), "action_filter": action, "target_type_filter": target_type},
    )
    await db.commit()

    if format == "json":
        def _gen_json():
            yield json.dumps([i.model_dump(mode="json") for i in items], ensure_ascii=False, indent=2)

        return StreamingResponse(
            _gen_json(),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=audit_logs.json"},
        )

    # CSV
    _COLS = ["id", "created_at", "actor_email", "actor_role", "action",
             "target_type", "target_id", "method", "path", "status_code", "ip", "detail_json"]

    def _gen_csv():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_COLS, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            row = item.model_dump(mode="json")
            if row.get("detail_json") is not None:
                row["detail_json"] = json.dumps(row["detail_json"], ensure_ascii=False)
            writer.writerow(row)
        yield buf.getvalue()

    return StreamingResponse(
        _gen_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=audit_logs.csv"},
    )
