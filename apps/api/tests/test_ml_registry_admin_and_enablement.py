"""v0.19.0 ADR-0044 · PR3 端点:
- superadmin 全局注册表 CRUD (/admin/ml-integrations/registry)
- 项目启用勾选清单 (GET /projects/{id}/ml-backends/available)
- 项目启用切换 + 覆盖 (PUT /projects/{id}/ml-backends/{rid}/enablement)
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend_registry import MLBackendRegistry, ProjectMLBackend
from app.db.models.project import Project
from app.services.ml_backend import MLBackendService


async def _seed_project(db: AsyncSession, owner_id: uuid.UUID, **overrides) -> Project:
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-RG-{suffix}",
        name=f"rg-{suffix}",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
        **overrides,
    )
    db.add(proj)
    await db.flush()
    return proj


async def _seed_registry(db: AsyncSession, name: str = "g") -> MLBackendRegistry:
    b = MLBackendRegistry(
        id=uuid.uuid4(),
        name=name,
        url=f"http://reg/{uuid.uuid4().hex[:8]}",
        is_interactive=False,
        state="connected",
    )
    db.add(b)
    await db.flush()
    return b


# ── admin 全局 CRUD ──────────────────────────────────────────────────────


async def test_create_registry_superadmin(httpx_client, super_admin):
    _, token = super_admin
    res = await httpx_client.post(
        "/api/v1/admin/ml-integrations/registry",
        json={"name": "alpha", "url": "http://alpha:8000", "is_interactive": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "alpha"
    assert body["url"] == "http://alpha:8000"
    assert body["project_id"] is None


async def test_create_registry_duplicate_url_409(httpx_client, db_session, super_admin):
    _, token = super_admin
    existing = await _seed_registry(db_session, name="dup")
    await db_session.commit()
    res = await httpx_client.post(
        "/api/v1/admin/ml-integrations/registry",
        json={"name": "dup2", "url": existing.url},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409


async def test_create_registry_requires_superadmin(httpx_client, project_admin):
    _, token = project_admin
    res = await httpx_client.post(
        "/api/v1/admin/ml-integrations/registry",
        json={"name": "x", "url": "http://x:8000"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


async def test_update_registry(httpx_client, db_session, super_admin):
    _, token = super_admin
    b = await _seed_registry(db_session, name="old")
    await db_session.commit()
    res = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/registry/{b.id}",
        json={"name": "renamed", "is_interactive": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "renamed"
    assert res.json()["is_interactive"] is True


async def test_update_registry_404(httpx_client, super_admin):
    _, token = super_admin
    res = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/registry/{uuid.uuid4()}",
        json={"name": "x"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404


async def test_delete_registry_cascades_project_binding(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    b = await _seed_registry(db_session, name="todel")
    db_session.add(ProjectMLBackend(project_id=proj.id, registry_id=b.id, enabled=True))
    proj.ml_backend_id = b.id
    await db_session.commit()

    res = await httpx_client.delete(
        f"/api/v1/admin/ml-integrations/registry/{b.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 204
    # 全局项已删 + 项目绑定 SET NULL
    assert await MLBackendService(db_session).get(b.id) is None


# ── 项目启用勾选清单 ──────────────────────────────────────────────────────


async def test_available_lists_all_with_enabled_flag(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    on = await _seed_registry(db_session, name="on")
    off = await _seed_registry(db_session, name="off")
    db_session.add(
        ProjectMLBackend(
            project_id=proj.id,
            registry_id=on.id,
            enabled=True,
            default_variants={"sam_variant": "large"},
        )
    )
    await db_session.commit()

    res = await httpx_client.get(
        f"/api/v1/projects/{proj.id}/ml-backends/available",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    by_id = {it["backend"]["id"]: it for it in res.json()["items"]}
    assert by_id[str(on.id)]["enabled"] is True
    assert by_id[str(on.id)]["default_variants"] == {"sam_variant": "large"}
    assert by_id[str(off.id)]["enabled"] is False
    assert by_id[str(off.id)]["default_variants"] is None


async def test_enablement_toggle_and_override(httpx_client, db_session, super_admin):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    b = await _seed_registry(db_session, name="tog")
    await db_session.commit()

    # 启用 + 写变体覆盖
    res = await httpx_client.put(
        f"/api/v1/projects/{proj.id}/ml-backends/{b.id}/enablement",
        json={"enabled": True, "default_variants": {"sam_variant": "base"}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["enabled"] is True
    assert body["default_variants"] == {"sam_variant": "base"}

    # 停用 (覆盖缺省不动)
    res = await httpx_client.put(
        f"/api/v1/projects/{proj.id}/ml-backends/{b.id}/enablement",
        json={"enabled": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["enabled"] is False
    assert res.json()["default_variants"] == {"sam_variant": "base"}


async def test_enablement_unknown_backend_404(httpx_client, db_session, super_admin):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    await db_session.commit()
    res = await httpx_client.put(
        f"/api/v1/projects/{proj.id}/ml-backends/{uuid.uuid4()}/enablement",
        json={"enabled": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
