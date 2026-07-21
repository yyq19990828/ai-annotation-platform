"""v0.6.6 · DB-backed pytest 脚手架（function-scoped engine + dependency_overrides[get_db]）。

提供:
  - test_db_url: 从 TEST_DATABASE_URL 环境变量或默认 annotation_test 库
  - apply_migrations: session 级，alembic upgrade head（一次性）
  - test_engine: function-scoped，避免 pytest-asyncio function-scope event loop 与 session-scope engine 冲突
  - db_session: function-scoped，SAVEPOINT 隔离
  - super_admin / project_admin / annotator / reviewer：四角色 fixture（含 JWT token）
  - httpx_client: 不绑定 fixture session（仅用于纯路由 / 不需要 fixture 写入数据可见的场景）
  - httpx_client_bound: app.dependency_overrides[get_db] 绑定到 db_session（fixture 写入对 API 可见）

前置条件:
    export TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/annotation_test
    # 数据库需先手动创建: createdb annotation_test

跑法:
    cd apps/api
    pytest -q

历史:
  v0.6.0 引入；v0.6.5 在 test_task_lock.py 内部 override 走通 5 例；
  v0.6.6 把 override 回写到 conftest，解锁 v0.5.5/v0.6.0/v0.6.3 旧 httpx 集成测套。
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker


def _default_test_db_url() -> str:
    """默认测试库：跟随本环境 .env 的 DATABASE_URL（host/port/账号/驱动），库名固定
    annotation_test。这样多 worktree（各连不同 postgres 端口，如点云隔离栈 5433）无需
    手动设 TEST_DATABASE_URL。CI / 显式场景仍可用 TEST_DATABASE_URL 覆盖（见 test_db_url）。
    settings 不可用时回退到历史默认（localhost:5432）。"""
    try:
        from sqlalchemy.engine import make_url

        from app.config import settings

        # render_as_string(hide_password=False)：str(URL) 会把密码渲染成 ***，
        # 直接用会导致认证失败，必须显式不隐藏。
        return (
            make_url(settings.database_url)
            .set(database="annotation_test")
            .render_as_string(hide_password=False)
        )
    except Exception:
        return "postgresql+asyncpg://user:pass@localhost:5432/annotation_test"


TEST_DB_DEFAULT = _default_test_db_url()


# v0.10.22 · 旧扁平列 classes / classes_config / attribute_schema 已删 (单源真值
# 收口到 tool_bindings). 历史测试 fixture 大量用 Project(classes=[...]) 风格直接构造
# ORM 行; 这里在 ORM __init__ 层加一个 **测试专用** 兼容层, 把旧扁平 kwargs 复用
# 生产同款 coalesce_legacy_into_tool_bindings 翻译成 tool_bindings, 等价于迁移后的
# 真实行形态. 生产模型不带任何 shim.
def _install_legacy_class_kwargs_shim() -> None:
    from app.db.models.project import Project
    from app.db.models.project_template import ProjectTemplate
    from app.services.project import coalesce_legacy_into_tool_bindings

    _LEGACY = ("classes", "classes_config", "attribute_schema")

    def _wrap(cls):
        orig_init = cls.__init__

        def __init__(self, **kw):
            if any(k in kw for k in _LEGACY):
                coalesce_legacy_into_tool_bindings(
                    kw, kw.get("tool_bindings"), kw.get("type_key")
                )
                for k in _LEGACY:
                    kw.pop(k, None)
            orig_init(self, **kw)

        cls.__init__ = __init__

    _wrap(Project)
    _wrap(ProjectTemplate)


_install_legacy_class_kwargs_shim()


@pytest.fixture(scope="session")
def test_db_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", TEST_DB_DEFAULT)


@pytest.fixture(scope="session")
def apply_migrations(test_db_url: str):
    """在整个 session 中运行一次 alembic upgrade head。

    保持 session-scope：迁移只跑一次，但下面的 test_engine 是 function-scope，
    不再共享同一 engine，迁移结果是 DDL，commit 后对所有连接可见。
    """
    from alembic.config import Config
    from alembic import command

    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)
    command.upgrade(alembic_cfg, "head")
    yield
    # 迁移保留，便于失败时检查


@pytest.fixture
async def test_engine(test_db_url: str, apply_migrations):
    """Function-scoped engine：与 pytest-asyncio 默认 function-scope event loop 兼容。"""
    engine = create_async_engine(test_db_url, echo=False)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
async def db_session(test_engine):
    """Per-test 数据库 session（SAVEPOINT 隔离）。"""
    conn = await test_engine.connect()
    trans = await conn.begin()
    maker = async_sessionmaker(conn, class_=AsyncSession, expire_on_commit=False)
    session = maker()

    await conn.begin_nested()
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()
        # v0.8.1 · 模块级进程缓存的服务（如 SystemSettingsService）需在每 test 清理，
        # 否则上一个测试的 PATCH 值会泄漏到下一个测试（DB SAVEPOINT 已回滚但缓存未失效）。
        try:
            from app.services.system_settings_service import SystemSettingsService

            SystemSettingsService.invalidate()
        except Exception:
            pass


@pytest.fixture(scope="session")
def app_module():
    from app.main import app

    return app


@pytest.fixture
async def httpx_client(app_module, db_session: AsyncSession):
    """ASGI httpx client，dependency_overrides[get_db] 已绑到 db_session。

    fixture 在 db_session 写入的数据对 API 可见（fixture 与 API 共享同一 SAVEPOINT 事务）。
    v0.6.6 起为默认行为，旧测套（v0.5.5 / v0.6.0 / v0.6.3 留下的）无需改动即可解锁。
    """
    from app.deps import get_db

    async def _override():
        yield db_session

    app_module.dependency_overrides[get_db] = _override
    transport = httpx.ASGITransport(app=app_module)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            yield client
    finally:
        app_module.dependency_overrides.pop(get_db, None)


# 保留向后兼容别名（v0.6.5 在 test_task_lock.py 内部用过 httpx_client_bound）
httpx_client_bound = httpx_client


# ── 用户 Fixtures ────────────────────────────────────────────────────


def _make_user(role: str, email: str, name: str) -> dict:
    from app.core.security import hash_password

    return {
        "id": uuid.uuid4(),
        "email": email,
        "name": name,
        "password_hash": hash_password("Test1234"),
        "role": role,
        "is_active": True,
    }


async def _create_user(db: AsyncSession, role: str, email: str, name: str):
    from app.db.models.user import User

    data = _make_user(role, email, name)
    user = User(**data)
    db.add(user)
    await db.flush()

    from app.core.security import create_access_token

    token = create_access_token(subject=str(user.id), role=role)
    return user, token


@pytest.fixture
async def super_admin(db_session: AsyncSession):
    return await _create_user(db_session, "super_admin", "admin@test.local", "Admin")


@pytest.fixture
async def project_admin(db_session: AsyncSession):
    return await _create_user(db_session, "project_admin", "pm@test.local", "PM")


@pytest.fixture
async def annotator(db_session: AsyncSession):
    return await _create_user(db_session, "annotator", "anno@test.local", "Annotator")


@pytest.fixture
async def reviewer(db_session: AsyncSession):
    return await _create_user(db_session, "reviewer", "qa@test.local", "Reviewer")


@pytest.fixture
def auth_headers(super_admin) -> dict[str, str]:
    _, token = super_admin
    return {"Authorization": f"Bearer {token}"}


# v0.23.3 ADR-0050 · 测试辅助: 创建 registry + 其 singleton 服务池 + active 成员。
# 项目启用关联 / 项目主绑定都基于 pool id (ProjectMLBackendPool.pool_id / Project.ml_backend_pool_id)。
# 测试不再直接 new ProjectMLBackend(project_id, registry_id); 改用本 helper 得到 pool 再建关联。
async def create_registry_with_pool(
    db: AsyncSession,
    *,
    name: str = "test-backend",
    url: str | None = None,
    state: str = "connected",
    is_interactive: bool = True,
    enabled_pool: bool = False,
    **registry_kwargs,
):
    """Create a MLBackendRegistry row + its singleton service pool + active member.

    Returns (registry, pool). The pool's legacy_instance_id points at the registry.
    Pass enabled_pool=True to mark the pool enabled (rare; off mode leaves it false
    and project enablement is expressed via ProjectMLBackendPool.enabled).
    """
    from app.db.models.ml_backend_pool import MLBackendPoolMember, MLBackendServicePool
    from app.db.models.ml_backend_registry import MLBackendRegistry

    url = url or f"http://{name}.test:9999"
    registry = MLBackendRegistry(
        name=name,
        url=url,
        state=state,
        is_interactive=is_interactive,
        source="manual",
        **registry_kwargs,
    )
    db.add(registry)
    await db.flush()
    pool = MLBackendServicePool(
        name=registry.name,
        enabled=enabled_pool,
        routing_policy="smooth_weighted_round_robin",
        legacy_instance_id=registry.id,
        routing_generation=1,
    )
    db.add(pool)
    await db.flush()
    db.add(
        MLBackendPoolMember(
            pool_id=pool.id,
            registry_id=registry.id,
            traffic_state="active",
            weight=1,
        )
    )
    await db.flush()
    return registry, pool
