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
    # v0.9.4 phase 3: SAM E2E 走 page.route 拦截 /interactive-annotating, 但项目侧仍需
    # 「AI 启用 + 有效 ml_backend_id 绑定」, 否则 GeneralSection / 工作台显示「未绑定」红字,
    # SAM 工具按钮直接 disabled. 这个 backend 的 url 是 mock://e2e-sam (前端不会真的请求,
    # 由 Playwright page.route 拦截). 字段返回让 spec 可声明依赖.
    ml_backend_id: str


@router.post(
    "/seed/reset",
    response_model=SeedReset,
    status_code=200,
    include_in_schema=False,
)
async def seed_reset(db: AsyncSession = Depends(get_db)) -> SeedReset:
    """重置测试数据库为固定 E2E fixture（幂等）。

    v0.8.7+ · 不再 TRUNCATE 整库，改为定向 DELETE：只清除 `@e2e.test` 用户 +
    name='E2E Demo Project' 项目（含其 task_batches/tasks/annotations/locks 等
    FK 链条）。开发者本地的 admin/pm/qa/anno 等账号 + dev 项目 / 数据集 / 标注
    完全保留。

    注：audit_logs 不删（trigger 阻止 + 用户 FK SET NULL 已无害）。
    """
    _ensure_non_production()

    from tests.factory import create_user, create_project, create_task

    import logging

    log = logging.getLogger("anno-api.seed_reset")

    # 0) 豁免 audit_logs immutability trigger：DELETE users 触发 audit_logs.actor_id
    #    ON DELETE SET NULL（隐式 UPDATE）会被 trigger 拒绝（"audit_logs rows are
    #    immutable: UPDATE operation denied"）。SET LOCAL 在外层事务中生效，所有
    #    SAVEPOINT 自动继承。
    await db.execute(text("SET LOCAL \"app.allow_audit_update\" = 'true'"))

    # 1) 找 fixture 项目 / 用户的 id
    fixture_proj_rows = (
        await db.execute(
            text(
                "SELECT id FROM projects "
                "WHERE name = 'E2E Demo Project' "
                "OR display_id LIKE 'P-E2E-%'"
            )
        )
    ).fetchall()
    fixture_project_ids = [r[0] for r in fixture_proj_rows]
    log.info("seed_reset · fixture project ids: %s", fixture_project_ids)

    fixture_user_rows = (
        await db.execute(text("SELECT id FROM users WHERE email LIKE '%@e2e.test'"))
    ).fetchall()
    fixture_user_ids = [r[0] for r in fixture_user_rows]
    log.info("seed_reset · fixture user ids: %s", fixture_user_ids)

    # 2) 按 FK 依赖顺序定向 DELETE。
    #    用 SAVEPOINT 隔离每个 DELETE：单条失败（如表不存在 / 列名漂移）不让外层
    #    事务进入 aborted 状态。asyncpg 的 InFailedSQLTransactionError 必须靠
    #    SAVEPOINT 回滚，try/except 单纯吞异常不够。
    async def _try_delete(sql: str, params: dict | None = None) -> None:
        async with db.begin_nested() as sp:
            try:
                await db.execute(text(sql), params or {})
            except Exception as exc:
                log.warning("seed_reset skip · %s · %s", sql.split()[2], exc)
                await sp.rollback()

    if fixture_project_ids:
        # 2a) 找 fixture 项目下所有 task/annotation 的 id（在 SAVEPOINT 里）
        fixture_task_ids: list = []
        fixture_annotation_ids: list = []
        async with db.begin_nested() as sp:
            try:
                fixture_task_ids = [
                    r[0]
                    for r in (
                        await db.execute(
                            text("SELECT id FROM tasks WHERE project_id = ANY(:pids)"),
                            {"pids": fixture_project_ids},
                        )
                    ).fetchall()
                ]
                fixture_annotation_ids = [
                    r[0]
                    for r in (
                        await db.execute(
                            text(
                                "SELECT id FROM annotations WHERE project_id = ANY(:pids)"
                            ),
                            {"pids": fixture_project_ids},
                        )
                    ).fetchall()
                ]
            except Exception as exc:
                log.warning("seed_reset · child id lookup failed: %s", exc)
                await sp.rollback()

        # 2b) 删 annotation_comments → annotations → predictions / failed_predictions
        if fixture_annotation_ids:
            await _try_delete(
                "DELETE FROM annotation_comments WHERE annotation_id = ANY(:aids)",
                {"aids": fixture_annotation_ids},
            )
        await _try_delete(
            "DELETE FROM annotations WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )
        await _try_delete(
            "DELETE FROM prediction_metas WHERE prediction_id IN "
            "(SELECT id FROM predictions WHERE project_id = ANY(:pids))",
            {"pids": fixture_project_ids},
        )
        await _try_delete(
            "DELETE FROM predictions WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )
        await _try_delete(
            "DELETE FROM failed_predictions WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

        # 2c) 删 task_locks / annotation_drafts → tasks
        if fixture_task_ids:
            await _try_delete(
                "DELETE FROM task_locks WHERE task_id = ANY(:tids)",
                {"tids": fixture_task_ids},
            )
            await _try_delete(
                "DELETE FROM annotation_drafts WHERE task_id = ANY(:tids)",
                {"tids": fixture_task_ids},
            )
        await _try_delete(
            "DELETE FROM tasks WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

        # 2d) 删 ml_backends（FK 无 ondelete）
        await _try_delete(
            "DELETE FROM ml_backends WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

        # 2e) 删 project（CASCADE 带走 task_batches / project_members /
        #     task_events / datasets）
        await _try_delete(
            "DELETE FROM projects WHERE id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

    if fixture_user_ids:
        # 删用户的反向引用，再删用户。表名 / 列名见 v0.8.7+ DB schema：
        # bug_reports.reporter_id（不是 submitter_id）；annotation_comments.author_id；
        # bug_comments.author_id；annotation_drafts.user_id；task_locks.user_id；
        # password_reset_tokens.user_id；user_invitations.invited_by；
        # organization_members.user_id（CASCADE 不在，需手删）；
        # notification_preferences / notifications 是 CASCADE，自动跟着删。
        for tbl, col in [
            ("password_reset_tokens", "user_id"),
            ("bug_comments", "author_id"),
            ("bug_reports", "reporter_id"),
            ("bug_reports", "assigned_to_id"),
            ("task_locks", "user_id"),
            ("annotation_drafts", "user_id"),
            ("annotation_comments", "author_id"),
            ("annotations", "user_id"),
            ("user_invitations", "invited_by"),
            ("organization_members", "user_id"),
        ]:
            await _try_delete(
                f"DELETE FROM {tbl} WHERE {col} = ANY(:uids)",
                {"uids": fixture_user_ids},
            )
        # 用户最后删（前面所有反向引用清干净后，仅靠 ON DELETE SET NULL FK 的字段
        # 会被 PG 自动置 NULL，无 ondelete 的字段需我们已手动删完）。
        await _try_delete("DELETE FROM users WHERE email LIKE '%@e2e.test'")

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

    # v0.9.4 phase 3: SAM E2E 用 mock ml_backend (url 不会被真请求, page.route 拦截)
    from app.db.models.ml_backend import MLBackend

    mock_backend = MLBackend(
        project_id=project.id,
        name="E2E SAM Mock",
        url="http://mock-sam.e2e:9999",
        state="connected",
        is_interactive=True,
        auth_method="none",
        extra_params={"e2e_mock": True},
    )
    db.add(mock_backend)
    await db.flush()
    project.ai_enabled = True
    project.ml_backend_id = mock_backend.id
    await db.commit()

    return SeedReset(
        admin_email=admin.email,
        annotator_email=annotator.email,
        reviewer_email=reviewer.email,
        project_id=str(project.id),
        task_ids=[str(t.id) for t in tasks],
        ml_backend_id=str(mock_backend.id),
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
