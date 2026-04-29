from fastapi import APIRouter, Depends

from app.config import settings
from app.deps import require_roles
from app.db.enums import UserRole
from app.db.models.user import User
from app.schemas.me import SmtpStatus, SystemSettingsOut

router = APIRouter()


@router.get("/system", response_model=SystemSettingsOut)
async def get_system_settings(
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    return SystemSettingsOut(
        environment=settings.environment,
        invitation_ttl_days=settings.invitation_ttl_days,
        frontend_base_url=settings.frontend_base_url,
        smtp=SmtpStatus(
            host=settings.smtp_host,
            port=settings.smtp_port,
            user=settings.smtp_user,
            from_address=settings.smtp_from,
            configured=settings.smtp_configured,
        ),
    )
