"""v0.9.3 · /admin/ml-integrations/overview 端到端测试。"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from tests.factory import create_project


@pytest.mark.asyncio
async def test_overview_super_admin_only(httpx_client, super_admin, annotator):
    _, admin_token = super_admin
    _, anno_token = annotator

    fake_summary = {
        "name": "test-bucket",
        "status": "ok",
        "object_count": 0,
        "total_size_bytes": 0,
    }
    with patch("app.api.v1.admin_ml_integrations.storage_service") as mock_storage:
        mock_storage.bucket = "annotations"
        mock_storage.datasets_bucket = "datasets"
        mock_storage.summarize_bucket.return_value = fake_summary

        # super_admin 200
        res = await httpx_client.get(
            "/api/v1/admin/ml-integrations/overview",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert "storage" in body
        assert "projects" in body
        assert body["total_backends"] == 0

        # annotator 403
        res = await httpx_client.get(
            "/api/v1/admin/ml-integrations/overview",
            headers={"Authorization": f"Bearer {anno_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_overview_groups_backends_by_project(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="P1")

    from app.db.models.ml_backend import MLBackend

    db_session.add(
        MLBackend(
            project_id=proj.id,
            name="b1",
            url="http://x:9000",
            state="connected",
        )
    )
    db_session.add(
        MLBackend(
            project_id=proj.id,
            name="b2",
            url="http://y:9000",
            state="disconnected",
        )
    )
    await db_session.flush()

    with patch("app.api.v1.admin_ml_integrations.storage_service") as mock_storage:
        mock_storage.bucket = "annotations"
        mock_storage.datasets_bucket = "datasets"
        mock_storage.summarize_bucket.return_value = {
            "name": "annotations",
            "status": "ok",
            "object_count": 0,
            "total_size_bytes": 0,
        }

        res = await httpx_client.get(
            "/api/v1/admin/ml-integrations/overview",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["total_backends"] == 2
        assert body["connected_backends"] == 1
        assert len(body["projects"]) == 1
        assert body["projects"][0]["project_name"] == "P1"
        assert len(body["projects"][0]["backends"]) == 2


# ── v0.9.6 · /probe + /runtime-hints ──────────────────────────────────


@pytest.mark.asyncio
async def test_probe_returns_ok_for_healthy_backend(httpx_client, super_admin):
    _, token = super_admin

    class FakeResp:
        status_code = 200

        def json(self):
            return {
                "ok": True,
                "gpu_info": {"device_name": "RTX 4060", "memory_used_mb": 1234},
                "cache": {"hit_rate": 0.42},
                "model_version": "grounded-sam2-tiny-large",
            }

    class FakeClient:
        def __init__(self, *_, **__):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def get(self, *_args, **_kwargs):
            return FakeResp()

    with patch("app.api.v1.admin_ml_integrations.httpx.AsyncClient", FakeClient):
        res = await httpx_client.post(
            "/api/v1/admin/ml-integrations/probe",
            json={"url": "http://172.17.0.1:8001"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["model_version"] == "grounded-sam2-tiny-large"
        assert body["gpu_info"]["device_name"] == "RTX 4060"
        assert body["cache"]["hit_rate"] == 0.42


@pytest.mark.asyncio
async def test_probe_returns_error_on_timeout(httpx_client, super_admin):
    _, token = super_admin
    import httpx as _httpx

    class FakeClient:
        def __init__(self, *_, **__):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def get(self, *_args, **_kwargs):
            raise _httpx.TimeoutException("timed out")

    with patch("app.api.v1.admin_ml_integrations.httpx.AsyncClient", FakeClient):
        res = await httpx_client.post(
            "/api/v1/admin/ml-integrations/probe",
            json={"url": "http://nope:9999"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is False
        assert "timed out" in (body["error"] or "")


@pytest.mark.asyncio
async def test_probe_requires_admin(httpx_client, annotator):
    _, anno_token = annotator
    res = await httpx_client.post(
        "/api/v1/admin/ml-integrations/probe",
        json={"url": "http://x:8001"},
        headers={"Authorization": f"Bearer {anno_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_runtime_hints_returns_default_url(httpx_client, super_admin, monkeypatch):
    _, token = super_admin
    from app.config import settings

    monkeypatch.setattr(settings, "ml_backend_default_url", "http://172.17.0.1:8001")
    res = await httpx_client.get(
        "/api/v1/admin/ml-integrations/runtime-hints",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["ml_backend_default_url"] == "http://172.17.0.1:8001"


@pytest.mark.asyncio
async def test_runtime_hints_null_when_not_set(httpx_client, super_admin, monkeypatch):
    _, token = super_admin
    from app.config import settings

    monkeypatch.setattr(settings, "ml_backend_default_url", "")
    res = await httpx_client.get(
        "/api/v1/admin/ml-integrations/runtime-hints",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["ml_backend_default_url"] is None
