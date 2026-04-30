from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.ratelimit import limiter
from app.core.password import validate_password_strength
from app.deps import get_db, get_current_user
from app.db.models.user import User
from app.schemas.user import Token, LoginRequest, UserOut
from app.core.security import verify_password, create_access_token, hash_password
from app.services.audit import AuditAction, AuditService
from app.services.password_reset import PasswordResetService
from app.config import settings
import logging

logger = logging.getLogger("anno-api.auth")
router = APIRouter()


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)

    @field_validator("email")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return (v or "").strip().lower()


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strength(cls, v: str) -> str:
        errors = validate_password_strength(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
async def login(
    data: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(data.password, user.password_hash):
        # 失败登录也写一条（actor=None，detail 含尝试 email）
        await AuditService.log(
            db,
            actor=None,
            action=AuditAction.AUTH_LOGIN,
            target_type="user",
            target_id=data.email,
            request=request,
            status_code=401,
            detail={"email": data.email, "result": "invalid_credentials"},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        await AuditService.log(
            db,
            actor=user,
            action=AuditAction.AUTH_LOGIN,
            target_type="user",
            target_id=str(user.id),
            request=request,
            status_code=403,
            detail={"email": user.email, "result": "deactivated"},
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账户已被停用")

    token = create_access_token(subject=str(user.id), role=user.role)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.AUTH_LOGIN,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={"email": user.email, "result": "success"},
    )
    await db.commit()
    return Token(access_token=token)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/forgot-password", status_code=202)
@limiter.limit("3/minute")
async def forgot_password(
    data: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    svc = PasswordResetService(db)
    token = await svc.create_token(data.email)
    await db.commit()

    if token and settings.smtp_configured:
        reset_url = f"{settings.frontend_base_url}/reset-password?token={token}"
        logger.info("Password reset token for %s: %s", data.email, reset_url)
    elif token:
        logger.info("Password reset token for %s (SMTP not configured): token=%s", data.email, token)

    # 无论成功与否都返回 202，防邮箱枚举
    return {"message": "如果该邮箱已注册，您将收到一封包含重置链接的邮件"}


@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    svc = PasswordResetService(db)
    user = await svc.consume_token(data.token)
    if not user:
        raise HTTPException(status_code=400, detail="重置链接无效或已过期")

    user.password_hash = hash_password(data.new_password)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.USER_PASSWORD_CHANGE,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={"method": "reset_token"},
    )
    await db.commit()
    return {"message": "密码已重置，请使用新密码登录"}
