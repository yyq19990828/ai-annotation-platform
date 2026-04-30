"""v0.5.5 phase 2 · A.2：pytest 脚手架（轻量版）。

当前提供：
  - `app_module`：导入 FastAPI app（验证启动期 import 健康）
  - `httpx_client`：基于 ASGITransport 的 async client（可发请求，但**不连真实 DB**）

数据库 fixture（per-test SAVEPOINT、alembic upgrade head）留给下一期：
那需要 .env 里有独立 TEST_DATABASE_URL + asyncpg + alembic 的环境配合，
属于 CI/CD 就位时再补的工作。

跑法：
    cd apps/api
    pip install -e '.[test]'   # 或 uv sync --extra test
    pytest -q
"""
from __future__ import annotations

import pytest


@pytest.fixture(scope="session")
def app_module():
    """导入 FastAPI app 实例（顺带验证全部 router / schema / depends 链路无 import 错误）。"""
    from app.main import app
    return app


@pytest.fixture
async def httpx_client(app_module):
    """基于 ASGITransport 的异步 client。
    注意：当前不挂 DB fixture，只用于纯路由 / 验证类测试（如 OpenAPI / 启动健康）。
    数据库相关的端到端测试待 fixture 套件完善后再添加。
    """
    import httpx

    transport = httpx.ASGITransport(app=app_module)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
