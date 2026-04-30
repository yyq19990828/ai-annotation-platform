"""v0.6.0: DB-backed pytest 脚手架。

提供:
  - test_db_url: 从 TEST_DATABASE_URL 环境变量或默认 annotation_test 库
  - apply_migrations: session 级 fixture，alembic upgrade head
  - db_session: per-test SAVEPOINT 隔离
  - super_admin / project_admin / annotator: 三角色用户 fixture（含 JWT token）
  - httpx_client: 基于 ASGITransport 的异步 client（挂真实 DB）

前置条件:
    export TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/annotation_test
    # 数据库需先手动创建: createdb annotation_test

跑法:
    cd apps/api
    pytest -q
"""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker


TEST_DB_DEFAULT = "postgresql+asyncpg://user:pass@localhost:5432/annotation_test"


@pytest.fixture(scope="session")
def test_db_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", TEST_DB_DEFAULT)


@pytest.fixture(scope="session")
def test_engine(test_db_url: str):
    engine = create_async_engine(test_db_url, echo=False)
    return engine


@pytest.fixture(scope="session")
async def apply_migrations(test_db_url: str, test_engine):
    """在整个 session 中运行一次 alembic upgrade head。"""
    from alembic.config import Config
    from alembic import command

    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)
    command.upgrade(alembic_cfg, "head")
    yield
    # 迁移保留，便于失败时检查


@pytest.fixture
async def db_session(test_engine):
    """Per-test 数据库 session（SAVEPOINT 隔离）。"""
    conn = await test_engine.connect()
    trans = await conn.begin()
    maker = async_sessionmaker(conn, class_=AsyncSession, expire_on_commit=False)
    session = maker()

    await conn.begin_nested()

    yield session

    await trans.rollback()
    await conn.close()


@pytest.fixture(scope="session")
def app_module():
    from app.main import app
    return app


@pytest.fixture
async def httpx_client(app_module):
    import httpx
    transport = httpx.ASGITransport(app=app_module)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


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
