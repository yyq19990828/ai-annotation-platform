"""v0.8.6 F3 · Project ↔ MLBackend 真实绑定。

覆盖：
- 创建/更新项目带 ml_backend_id 自动同步 ai_model（display hint）
- ON DELETE SET NULL：删除 backend 时项目 ml_backend_id 置 null
- service.get_project_backend 优先返回显式绑定，否则 fallback
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.services.ml_backend import MLBackendService


async def _seed_project(db: AsyncSession, owner_id: uuid.UUID, **overrides) -> Project:
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-MB-{suffix}",
        name=f"mb-{suffix}",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
        **overrides,
    )
    db.add(proj)
    await db.flush()
    return proj


async def _seed_backend(
    db: AsyncSession, project_id: uuid.UUID, name: str = "alpha-backend"
) -> MLBackend:
    b = MLBackend(
        id=uuid.uuid4(),
        project_id=project_id,
        name=name,
        url="http://example/",
        is_interactive=True,
        state="connected",
    )
    db.add(b)
    await db.flush()
    return b


async def test_create_project_with_ml_backend_id_auto_fills_ai_model(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    # 先建一个 dummy project + backend（绑定的 backend 必须先存在）
    dummy = await _seed_project(db_session, user.id)
    backend = await _seed_backend(db_session, dummy.id, name="dino-sam2")
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "name": "新项目",
        "type_label": "图像-检测",
        "type_key": "image-det",
        "ai_enabled": True,
        "ml_backend_id": str(backend.id),
    }
    resp = await httpx_client_bound.post("/api/v1/projects", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ml_backend_id"] == str(backend.id)
    # backend.name 自动覆盖 ai_model
    assert data["ai_model"] == "dino-sam2"


async def test_patch_project_bind_backend_overwrites_ai_model(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id, ai_model="legacy-name")
    backend = await _seed_backend(db_session, proj.id, name="grounded-sam2")
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        json={"ml_backend_id": str(backend.id)},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ml_backend_id"] == str(backend.id)
    assert data["ai_model"] == "grounded-sam2"


async def test_delete_ml_backend_sets_project_null(db_session, super_admin):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id)
    backend = await _seed_backend(db_session, proj.id)
    proj.ml_backend_id = backend.id
    await db_session.flush()
    await db_session.commit()

    # ON DELETE SET NULL — 走原生 SQL 触发 FK 级联
    await db_session.execute(
        text("DELETE FROM ml_backends WHERE id = :bid"), {"bid": backend.id}
    )
    await db_session.commit()

    # 直接读 raw SQL，避免 ORM identity map 缓存陈旧值
    refreshed = (
        await db_session.execute(
            text("SELECT ml_backend_id FROM projects WHERE id = :pid"),
            {"pid": proj.id},
        )
    ).scalar_one_or_none()
    assert refreshed is None


async def test_get_project_backend_prefers_explicit_binding(db_session, super_admin):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id)
    explicit = await _seed_backend(db_session, proj.id, name="explicit")
    fallback = await _seed_backend(db_session, proj.id, name="fallback")
    assert explicit.id != fallback.id

    proj.ml_backend_id = explicit.id
    await db_session.flush()

    svc = MLBackendService(db_session)
    backend = await svc.get_project_backend(proj.id)
    assert backend is not None
    assert backend.id == explicit.id


async def test_get_project_backend_falls_back_when_unbound(db_session, super_admin):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id)
    interactive = await _seed_backend(db_session, proj.id, name="iface")
    await db_session.flush()

    svc = MLBackendService(db_session)
    backend = await svc.get_project_backend(proj.id)
    assert backend is not None
    assert backend.id == interactive.id


async def test_get_project_backend_returns_none_when_no_backend(
    db_session, super_admin
):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id)
    await db_session.flush()

    svc = MLBackendService(db_session)
    backend = await svc.get_project_backend(proj.id)
    assert backend is None
