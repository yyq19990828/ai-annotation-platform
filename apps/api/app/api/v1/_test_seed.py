"""v0.8.3 · 仅测试 / 非 production 环境暴露的 seed router。

E2E（Playwright）通过 `POST /api/v1/__test/seed/reset` 在每个 spec 前重置数据库
到固定 fixture（admin / annotator / reviewer 三个用户 + 1 项目 + 5 任务），通过
`POST /api/v1/__test/seed/login` 跳过 UI 登录直接拿 JWT。

安全：
  - 仅当 `settings.environment != "production"` 时挂载（main.py 条件 include_router）
  - 即使误挂到 production，每个端点入口再做一次 environment 守卫
  - 不调 AuditService，避免污染审计测试

不暴露给 OpenAPI 公开 schema（include_in_schema=False）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import create_access_token
from app.deps import get_db
from app.schemas.user import UserOut

router = APIRouter()


def _ensure_non_production() -> None:
    if settings.environment == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="seed routes disabled in production",
        )


class SeedReset(BaseModel):
    admin_email: str
    annotator_email: str
    reviewer_email: str
    project_id: str
    task_ids: list[str]


@router.post(
    "/seed/reset",
    response_model=SeedReset,
    status_code=200,
    include_in_schema=False,
)
async def seed_reset(db: AsyncSession = Depends(get_db)) -> SeedReset:
    """重置测试数据库为固定 E2E fixture（幂等）。"""
    _ensure_non_production()

    from tests.factory import create_user, create_project, create_task

    # 清表（按 FK 反向顺序）—— audit_logs 因 trigger 不可 DELETE，用豁免
    await db.execute(text("SET LOCAL \"app.allow_audit_update\" = 'true'"))
    for tbl in (
        "annotations",
        "tasks",
        "task_batches",
        "audit_logs",
        "project_members",
        "projects",
        "groups",
        "users",
    ):
        try:
            await db.execute(text(f"TRUNCATE TABLE {tbl} RESTART IDENTITY CASCADE"))
        except Exception:
            # 表不存在 / 分区表 TRUNCATE 行为可能不同，吞掉以保证 reset 端点鲁棒
            pass
    await db.flush()

    admin = await create_user(db, "super_admin", "admin@e2e.test", "E2E Admin")
    annotator = await create_user(db, "annotator", "anno@e2e.test", "E2E Annotator")
    reviewer = await create_user(db, "reviewer", "rev@e2e.test", "E2E Reviewer")
    project = await create_project(db, owner_id=admin.id, name="E2E Demo Project")
    tasks = []
    for _ in range(5):
        t = await create_task(db, project_id=project.id)
        tasks.append(t)
    await db.commit()

    return SeedReset(
        admin_email=admin.email,
        annotator_email=annotator.email,
        reviewer_email=reviewer.email,
        project_id=str(project.id),
        task_ids=[str(t.id) for t in tasks],
    )


class SeedLoginRequest(BaseModel):
    email: str


class SeedLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post(
    "/seed/login",
    response_model=SeedLoginResponse,
    include_in_schema=False,
)
async def seed_login(
    payload: SeedLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> SeedLoginResponse:
    """跳过密码验证发 JWT（仅 E2E 测试用）。"""
    _ensure_non_production()

    from sqlalchemy import select
    from app.db.models.user import User

    res = await db.execute(select(User).where(User.email == payload.email))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail=f"user {payload.email} not found")

    token = create_access_token(subject=str(user.id), role=user.role)
    return SeedLoginResponse(
        access_token=token,
        user=UserOut.model_validate(user),
    )
