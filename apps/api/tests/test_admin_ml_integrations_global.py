"""v0.9.7 · /admin/ml-integrations/all + project create with ml_backend_source_id."""

from __future__ import annotations

import uuid

import pytest

from app.db.models.ml_backend import MLBackend
from tests.factory import create_project


async def _make_backend(db, *, project_id, name="b", url="http://h:8000"):
    b = MLBackend(
        project_id=project_id,
        name=name,
        url=url,
        state="connected",
        is_interactive=False,
        auth_method="none",
        auth_token=None,
        extra_params={},
    )
    db.add(b)
    await db.flush()
    return b


@pytest.mark.asyncio
async def test_list_all_requires_admin(httpx_client, annotator):
    _, token = annotator
    res = await httpx_client.get(
        "/api/v1/admin/ml-integrations/all",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_list_all_dedups_by_url(httpx_client, db_session, super_admin):
    user, token = super_admin
    p1 = await create_project(db_session, owner_id=user.id, name="P1")
    p2 = await create_project(db_session, owner_id=user.id, name="P2")
    await _make_backend(db_session, project_id=p1.id, url="http://shared:8000", name="A")
    await _make_backend(db_session, project_id=p2.id, url="http://shared:8000", name="B")
    await _make_backend(db_session, project_id=p1.id, url="http://other:8000", name="C")
    await db_session.commit()

    res = await httpx_client.get(
        "/api/v1/admin/ml-integrations/all",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    items = res.json()["items"]
    urls = sorted(it["url"] for it in items)
    assert urls == ["http://other:8000", "http://shared:8000"]
    for it in items:
        assert "source_project_name" in it
        assert it["source_project_name"] in {"P1", "P2"}


@pytest.mark.asyncio
async def test_create_project_with_backend_source_clones_row(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    src_proj = await create_project(db_session, owner_id=user.id, name="Source")
    src = await _make_backend(
        db_session,
        project_id=src_proj.id,
        url="http://source:8001",
        name="src-backend",
    )
    await db_session.commit()

    payload = {
        "name": "New Project",
        "type_label": "图像目标检测",
        "type_key": "image-det",
        "ai_enabled": True,
        "ml_backend_source_id": str(src.id),
    }
    res = await httpx_client.post(
        "/api/v1/projects",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    new_backend_id = body["ml_backend_id"]
    assert new_backend_id is not None
    assert new_backend_id != str(src.id)  # 复制 row 而非引用 source

    # 新 backend 应在新项目下, state 重置, url 保留
    new_backend = await db_session.get(MLBackend, uuid.UUID(new_backend_id))
    assert new_backend is not None
    assert new_backend.url == "http://source:8001"
    assert new_backend.name == "src-backend"
    assert new_backend.state == "disconnected"
    assert new_backend.health_meta is None
    assert str(new_backend.project_id) == body["id"]


@pytest.mark.asyncio
async def test_create_project_invalid_backend_source_400(
    httpx_client, super_admin
):
    _, token = super_admin
    payload = {
        "name": "X",
        "type_label": "图像目标检测",
        "type_key": "image-det",
        "ml_backend_source_id": str(uuid.uuid4()),
    }
    res = await httpx_client.post(
        "/api/v1/projects",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
