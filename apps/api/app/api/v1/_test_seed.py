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

    # v0.8.5 · 把 annotator / reviewer 加为项目成员，否则 RequireProjectMember 会
    # 在进入 /projects/:id/annotate 时 403 弹回，annotation/batch-flow spec 走不通。
    from app.db.models.project_member import ProjectMember
    from app.db.models.task_batch import TaskBatch

    db.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id=annotator.id,
                role="annotator",
                assigned_by=admin.id,
            ),
            ProjectMember(
                project_id=project.id,
                user_id=reviewer.id,
                role="reviewer",
                assigned_by=admin.id,
            ),
        ],
    )
    # v0.8.5 · 创建一个 annotating 状态的 batch + 单值分派 annotator/reviewer，
    # 否则非特权用户在 list_tasks 中被 batch_visibility_clause 过滤为空（孤儿
    # 任务不可见），工作台显示「该项目暂无任务」。
    batch = TaskBatch(
        project_id=project.id,
        display_id="B-E2E-1",
        name="E2E Default Batch",
        status="annotating",
        annotator_id=annotator.id,
        reviewer_id=reviewer.id,
        assigned_user_ids=[str(annotator.id)],
        created_by=admin.id,
    )
    db.add(batch)
    await db.flush()

    tasks = []
    for _ in range(5):
        t = await create_task(db, project_id=project.id)
        t.batch_id = batch.id
        tasks.append(t)
    await db.flush()
    batch.total_tasks = len(tasks)
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


class SeedPeekResponse(BaseModel):
    """v0.8.7 F4 · 截图自动化只读窥探：返回首个 super_admin 用户 + 首个项目 + 首个任务。

    与 `seed/reset` 不同，本端点**不修改任何数据**，仅查询 LIMIT 1 → 让
    `pnpm screenshots` 在开发者本地真实数据上跑，不破坏现有数据集 / 项目。
    任意字段可为 None（对应记录不存在时），调用方需自行处理缺失场景。
    """

    admin_email: str | None = None
    project_id: str | None = None
    task_id: str | None = None


@router.get(
    "/seed/peek",
    response_model=SeedPeekResponse,
    include_in_schema=False,
)
async def seed_peek(db: AsyncSession = Depends(get_db)) -> SeedPeekResponse:
    """只读窥探现有数据，给截图自动化用（不破坏开发数据）。"""
    _ensure_non_production()

    from sqlalchemy import select
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.db.models.user import User

    # 优先选「不像 E2E fixture」的 admin（@e2e.test 邮箱排到末尾），让截图脚本
    # 优先用开发者真实账号（如 seed.py 的 admin）。
    admin = (
        await db.execute(
            select(User)
            .where(User.role == "super_admin")
            .order_by(User.email.like("%@e2e.test").asc(), User.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    # 项目 / 任务同样按 created_at desc，优先最新（开发者刚操作过的）。
    project = (
        await db.execute(select(Project).order_by(Project.created_at.desc()).limit(1))
    ).scalar_one_or_none()
    task = (
        await db.execute(select(Task).order_by(Task.created_at.desc()).limit(1))
    ).scalar_one_or_none()

    return SeedPeekResponse(
        admin_email=admin.email if admin else None,
        project_id=str(project.id) if project else None,
        task_id=str(task.id) if task else None,
    )


class AdvanceTaskRequest(BaseModel):
    """v0.8.5 · E2E 辅助：直接把 task 推到目标状态，绕过 UI 链路。

    主要服务于 batch-flow.spec 的多角色串联（避免每个 spec 都重复画 bbox）。
    """

    task_id: str
    to_status: str  # pending | annotating | submitted | review | completed | rejected
    annotator_email: str | None = None
    reviewer_email: str | None = None


class AdvanceTaskResponse(BaseModel):
    task_id: str
    status: str


@router.post(
    "/seed/advance_task",
    response_model=AdvanceTaskResponse,
    include_in_schema=False,
)
async def seed_advance_task(
    payload: AdvanceTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> AdvanceTaskResponse:
    """绕过状态机直接置 task 到目标状态。E2E 写实化用，不调审计。"""
    _ensure_non_production()

    from datetime import datetime, timezone
    from uuid import UUID
    from sqlalchemy import select
    from app.db.models.task import Task
    from app.db.models.user import User

    res = await db.execute(select(Task).where(Task.id == UUID(payload.task_id)))
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"task {payload.task_id} not found")

    now = datetime.now(timezone.utc)
    task.status = payload.to_status

    if payload.annotator_email:
        anno_res = await db.execute(
            select(User).where(User.email == payload.annotator_email)
        )
        anno = anno_res.scalar_one_or_none()
        if anno:
            task.assignee_id = anno.id
            task.assigned_at = task.assigned_at or now
    if payload.reviewer_email:
        rev_res = await db.execute(
            select(User).where(User.email == payload.reviewer_email)
        )
        rev = rev_res.scalar_one_or_none()
        if rev:
            task.reviewer_id = rev.id
            task.reviewer_claimed_at = task.reviewer_claimed_at or now

    if payload.to_status == "submitted":
        task.submitted_at = task.submitted_at or now
        task.is_labeled = True
    elif payload.to_status in ("completed", "rejected"):
        task.reviewed_at = now

    await db.commit()
    return AdvanceTaskResponse(task_id=str(task.id), status=task.status)
