from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.ratelimit import limiter
from app.core.password import validate_password_strength
from app.deps import get_db, get_current_user
from app.db.models.user import User
from app.db.enums import UserRole
from app.schemas.user import Token, LoginRequest, UserOut
from app.schemas.invitation import OpenRegisterRequest, RegisterResponse
from app.core.security import (
    verify_password,
    create_access_token,
    hash_password,
    decode_access_token,
)
from app.services.audit import AuditAction, AuditService
from app.services.password_reset import PasswordResetService
from app.services.system_settings_service import SystemSettingsService
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
        await AuditService.log(
            db,
            actor=None,
            action=AuditAction.AUTH_LOGIN,
            target_type="user",
            target_id=data.email,
            request=request,
            status_code=401,
            detail={
                "email": data.email,
                "result": "invalid_credentials",
                "user_agent": request.headers.get("user-agent", "")[:256],
            },
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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="账户已被停用"
        )

    user.last_login_at = datetime.now(timezone.utc)
    from app.core.token_blacklist import get_user_generation

    gen = await get_user_generation(str(user.id))
    token = create_access_token(subject=str(user.id), role=user.role, gen=gen)
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

    if token:
        base_url = (
            await SystemSettingsService.get(db, "frontend_base_url")
            or settings.frontend_base_url
        )
        smtp_host = await SystemSettingsService.get(db, "smtp_host")
        if smtp_host:
            reset_url = f"{str(base_url).rstrip('/')}/reset-password?token={token}"
            logger.info("Password reset token for %s: %s", data.email, reset_url)
        else:
            logger.info(
                "Password reset token for %s (SMTP not configured): token=%s",
                data.email,
                token,
            )

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


@router.get("/registration-status")
async def registration_status(db: AsyncSession = Depends(get_db)):
    enabled = bool(await SystemSettingsService.get(db, "allow_open_registration"))
    return {"open_registration_enabled": enabled}


@router.post("/register-open", response_model=RegisterResponse, status_code=201)
@limiter.limit("3/minute")
async def register_open(
    payload: OpenRegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if not await SystemSettingsService.get(db, "allow_open_registration"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="开放注册未启用",
        )

    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱已被注册",
        )

    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=UserRole.VIEWER.value,
        status="online",
        is_active=True,
    )
    db.add(user)
    await db.flush()

    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.USER_REGISTER,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=201,
        detail={"email": user.email, "role": user.role, "method": "open_registration"},
    )
    await db.commit()
    await db.refresh(user)

    token = create_access_token(subject=str(user.id), role=user.role)
    return RegisterResponse(
        access_token=token,
        token_type="bearer",
        user=UserOut.model_validate(user),
    )


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.core.token_blacklist import blacklist_token

    payload = decode_access_token(credentials.credentials)
    jti = payload.get("jti")
    if jti:
        exp = payload.get("exp", 0)
        remaining = int(exp - datetime.now(timezone.utc).timestamp())
        await blacklist_token(jti, max(remaining, 0))

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.AUTH_LOGOUT,
        target_type="user",
        target_id=str(current_user.id),
        request=request,
        status_code=204,
    )
    await db.commit()


@router.post("/logout-all", response_model=Token)
async def logout_all(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.core.token_blacklist import increment_user_generation

    new_gen = await increment_user_generation(str(current_user.id))

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.AUTH_LOGOUT_ALL,
        target_type="user",
        target_id=str(current_user.id),
        request=request,
        status_code=200,
        detail={"new_generation": new_gen},
    )
    await db.commit()

    new_token = create_access_token(
        subject=str(current_user.id), role=current_user.role, gen=new_gen
    )
    return Token(access_token=new_token)
