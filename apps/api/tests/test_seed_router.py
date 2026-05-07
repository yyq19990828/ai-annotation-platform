"""v0.8.3 · _test_seed router 烟测：reset + login 端点契约。"""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_seed_reset_returns_fixture_payload(httpx_client):
    res = await httpx_client.post("/api/v1/__test/seed/reset")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["admin_email"] == "admin@e2e.test"
    assert body["annotator_email"] == "anno@e2e.test"
    assert body["reviewer_email"] == "rev@e2e.test"
    assert isinstance(body["task_ids"], list)
    assert len(body["task_ids"]) == 5


async def test_seed_login_after_reset_returns_jwt(httpx_client):
    await httpx_client.post("/api/v1/__test/seed/reset")
    res = await httpx_client.post(
        "/api/v1/__test/seed/login",
        json={"email": "admin@e2e.test"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "admin@e2e.test"


async def test_seed_login_unknown_email_404(httpx_client):
    await httpx_client.post("/api/v1/__test/seed/reset")
    res = await httpx_client.post(
        "/api/v1/__test/seed/login",
        json={"email": "no-such@nowhere"},
    )
    assert res.status_code == 404


async def test_seed_reset_preserves_dev_data(httpx_client_bound, db_session):
    """v0.8.7+ · D 方案核心断言：reset 不动非 fixture 的开发数据。

    造一个 dev 用户 + dev 项目，跑 reset，断言它们仍然存在；同时 fixture
    （admin@e2e.test 等）被重建。
    """
    import uuid

    from app.db.models.project import Project
    from app.db.models.user import User
    from sqlalchemy import select

    # 造 dev 数据（与 E2E fixture 用 distinct 命名）
    dev_user = User(
        id=uuid.uuid4(),
        email="dev-keeper@example.com",
        name="Dev Keeper",
        password_hash="x",
        role="super_admin",
        status="offline",
        is_active=True,
    )
    db_session.add(dev_user)
    await db_session.flush()
    dev_proj = Project(
        id=uuid.uuid4(),
        display_id="P-DEV-KEEP",
        name="Dev Keeper Project",
        type_label="image-det",
        type_key="image-det",
        owner_id=dev_user.id,
    )
    db_session.add(dev_proj)
    await db_session.commit()

    # 跑 reset
    res = await httpx_client_bound.post("/api/v1/__test/seed/reset")
    assert res.status_code == 200, res.text

    # dev 数据应保留
    kept_user = (
        await db_session.execute(
            select(User).where(User.email == "dev-keeper@example.com")
        )
    ).scalar_one_or_none()
    assert kept_user is not None, "dev 用户被误删"
    kept_proj = (
        await db_session.execute(
            select(Project).where(Project.display_id == "P-DEV-KEEP")
        )
    ).scalar_one_or_none()
    assert kept_proj is not None, "dev 项目被误删"

    # fixture 应存在
    e2e_admin = (
        await db_session.execute(
            select(User).where(User.email == "admin@e2e.test")
        )
    ).scalar_one_or_none()
    assert e2e_admin is not None, "E2E fixture admin 应被重建"
