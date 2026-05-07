import uuid
from typing import AsyncGenerator, Callable
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.base import async_session
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.core.security import decode_access_token
from app.core.token_blacklist import is_blacklisted, get_user_generation

bearer_scheme = HTTPBearer()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的认证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = credentials.credentials

    # v0.9.3 · ak_ 前缀走 api_key 路径；不走 JWT 解码（避免 jose 抛形错日志）
    from app.services import api_key_service

    if api_key_service.is_api_key_token(token):
        resolved = await api_key_service.resolve_token(db, token)
        if resolved is None:
            raise exc
        _key, user = resolved
        await db.commit()  # 持久化 last_used_at
        return user

    try:
        payload = decode_access_token(token)
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise exc
    except JWTError:
        raise exc

    jti: str | None = payload.get("jti")
    token_gen: int = payload.get("gen", 0)

    if jti:
        try:
            if await is_blacklisted(jti):
                raise exc
        except HTTPException:
            raise
        except Exception:
            pass

        try:
            current_gen = await get_user_generation(user_id)
            if current_gen > token_gen:
                raise exc
        except HTTPException:
            raise
        except Exception:
            pass

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise exc
    return user


def require_roles(*roles: str) -> Callable:
    """工厂函数：返回一个依赖，要求当前用户持有指定角色之一。"""

    async def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要角色权限: {'或'.join(roles)}",
            )
        return current_user

    return checker


async def assert_project_visible(
    project_id: uuid.UUID,
    db: AsyncSession,
    user: User,
) -> Project:
    """
    可见性规则：
      - super_admin：全部可见
      - project_admin：仅 owner_id == self
      - 其他角色：仅当存在 ProjectMember(project_id, user_id=self)
    返回 Project 实体；不可见则 404 隐藏存在性。
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")

    if user.role == UserRole.SUPER_ADMIN:
        return project
    if user.role == UserRole.PROJECT_ADMIN and project.owner_id == user.id:
        return project

    member = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    if member.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


async def require_project_visible(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Project:
    return await assert_project_visible(project_id, db, user)


async def require_project_owner(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Project:
    """super_admin 或项目 owner 可执行写操作。"""
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    if user.role == UserRole.SUPER_ADMIN or project.owner_id == user.id:
        return project
    raise HTTPException(status_code=403, detail="仅项目负责人或超级管理员可执行")
