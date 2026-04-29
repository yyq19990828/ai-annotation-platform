from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.deps import get_db, get_current_user
from app.db.models.user import User
from app.schemas.user import Token, LoginRequest, UserOut
from app.core.security import verify_password, create_access_token
from app.services.audit import AuditAction, AuditService

router = APIRouter()


@router.post("/login", response_model=Token)
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
