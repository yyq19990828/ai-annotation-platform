from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.ratelimit import limiter
from app.db.enums import UserRole
from app.db.models.user import User
from app.deps import get_db, require_roles
from app.schemas.me import SmtpStatus, SystemSettingsOut, SystemSettingsUpdate
from app.services.audit import AuditAction, AuditService
from app.services.email import SmtpConfigError, send_test_email
from app.services.system_settings_service import SystemSettingsService

router = APIRouter()


async def _build_response(db: AsyncSession) -> SystemSettingsOut:
    cur = await SystemSettingsService.get_all(db)
    smtp_password_set = bool(cur.get("smtp_password"))
    smtp_configured = bool(
        cur.get("smtp_host") and cur.get("smtp_port") and cur.get("smtp_from")
    )
    return SystemSettingsOut(
        environment=settings.environment,
        invitation_ttl_days=int(
            cur.get("invitation_ttl_days") or settings.invitation_ttl_days
        ),
        frontend_base_url=str(
            cur.get("frontend_base_url") or settings.frontend_base_url
        ),
        smtp=SmtpStatus(
            host=cur.get("smtp_host"),
            port=cur.get("smtp_port"),
            user=cur.get("smtp_user"),
            from_address=cur.get("smtp_from"),
            password_set=smtp_password_set,
            configured=smtp_configured,
        ),
        allow_open_registration=bool(cur.get("allow_open_registration") or False),
    )


@router.get("/system", response_model=SystemSettingsOut)
async def get_system_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    return await _build_response(db)


@router.patch("/system", response_model=SystemSettingsOut)
async def update_system_settings(
    payload: SystemSettingsUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    # 仅 PATCH 中显式给出的字段进入 updates；None 表示未提供，跳过。
    updates: dict = {}
    for key in (
        "allow_open_registration",
        "invitation_ttl_days",
        "frontend_base_url",
        "smtp_host",
        "smtp_port",
        "smtp_user",
        "smtp_password",
        "smtp_from",
    ):
        val = getattr(payload, key)
        if val is not None:
            updates[key] = val
    if not updates:
        return await _build_response(db)

    try:
        changes = await SystemSettingsService.set_many(db, updates, actor.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if changes:
        await AuditService.log(
            db,
            actor=actor,
            action=AuditAction.SYSTEM_SETTINGS_UPDATE,
            target_type="system",
            target_id="settings",
            request=request,
            status_code=200,
            detail=SystemSettingsService.safe_audit_detail(changes),
        )
    await db.commit()
    return await _build_response(db)


@router.post("/system/test-smtp", status_code=200)
@limiter.limit("3/minute")
async def test_smtp(
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    """用当前 DB override 的 SMTP 配置发一封测试邮件到 actor.email。"""
    try:
        result = await send_test_email(db, actor.email)
    except SmtpConfigError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"ok": True, **result}
