"""Project ↔ MLBackend 真实绑定。

覆盖：
- 创建/更新项目带 ml_backend_id 后保存真实绑定
- 解绑/删除 backend 时项目 ml_backend_id 置 null
- service.get_project_backend 优先返回显式绑定，否则 fallback
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend_registry import MLBackendRegistry, ProjectMLBackend
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
) -> MLBackendRegistry:
    """v0.19.0 ADR-0044 · 建全局注册项 + 为本项目建启用关联 (项目内「可用 backend」读
    enabled 集合; url 全局唯一, 故每次造唯一 url)。"""
    b = MLBackendRegistry(
        id=uuid.uuid4(),
        name=name,
        url=f"http://example/{uuid.uuid4().hex[:8]}",
        is_interactive=True,
        state="connected",
    )
    db.add(b)
    await db.flush()
    db.add(ProjectMLBackend(project_id=project_id, registry_id=b.id, enabled=True))
    await db.flush()
    return b


async def test_create_project_with_ml_backend_id_binds_backend(
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


async def test_patch_project_bind_backend_updates_binding(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
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


async def test_patch_project_unbind_backend_clears_binding(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id, ai_enabled=True)
    backend = await _seed_backend(db_session, proj.id, name="gsam2-video")
    proj.ml_backend_id = backend.id
    await db_session.flush()
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    resp = await httpx_client_bound.patch(
        f"/api/v1/projects/{proj.id}",
        json={"ml_backend_id": None},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ml_backend_id"] is None


async def test_raw_delete_ml_backend_no_longer_sets_project_null(
    db_session, super_admin
):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id)
    backend = await _seed_backend(db_session, proj.id)
    proj.ml_backend_id = backend.id
    await db_session.flush()
    await db_session.commit()

    # v0.21.0 · projects.ml_backend_id 不再是 FK; app/service 删除路径负责清兼容列。
    # 直接 SQL 删除 registry 行不会再触发 ON DELETE SET NULL。
    await db_session.execute(
        text("DELETE FROM ml_backend_registry WHERE id = :bid"), {"bid": backend.id}
    )
    await db_session.commit()

    # 直接读 raw SQL，避免 ORM identity map 缓存陈旧值
    refreshed = (
        await db_session.execute(
            text("SELECT ml_backend_id FROM projects WHERE id = :pid"),
            {"pid": proj.id},
        )
    ).scalar_one_or_none()
    assert refreshed == backend.id


async def test_service_delete_ml_backend_clears_project_binding(
    db_session, super_admin
):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id, ai_enabled=True)
    backend = await _seed_backend(db_session, proj.id, name="gsam2-video")
    proj.ml_backend_id = backend.id
    await db_session.flush()

    assert await MLBackendService(db_session).delete(backend.id) is True
    await db_session.flush()

    row = (
        await db_session.execute(
            text("SELECT ml_backend_id FROM projects WHERE id = :pid"),
            {"pid": proj.id},
        )
    ).scalar_one_or_none()
    assert row is None


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
