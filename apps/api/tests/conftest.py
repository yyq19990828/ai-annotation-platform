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


TEST_DB_DEFAULT = "postgresql+asyncpg://user:pass@localhost:5432/annotation_test"


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
