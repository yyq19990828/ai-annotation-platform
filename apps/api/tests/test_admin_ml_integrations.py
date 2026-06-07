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


@pytest.mark.asyncio
async def test_overview_includes_ai_enabled_project_without_backend(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="AI Empty")
    proj.ai_enabled = True
    await db_session.commit()

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
        group = next(p for p in body["projects"] if p["project_id"] == str(proj.id))
        assert group["project_name"] == "AI Empty"
        assert group["backends"] == []
        assert body["total_backends"] == 0


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
async def test_runtime_hints_returns_default_url(
    httpx_client, super_admin, monkeypatch
):
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


# ── v0.10.26 · 容器直连观测 /observe + /observe/smoke-test ──────────────


class _FakeResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx as _h

            raise _h.HTTPStatusError("err", request=None, response=None)


def _fake_client(routes):
    """routes: dict[("get"|"post", path_suffix)] -> _FakeResp。"""

    class FakeClient:
        def __init__(self, *_, **__):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def get(self, url, **_kw):
            for (m, suffix), resp in routes.items():
                if m == "get" and url.endswith(suffix):
                    return resp
            return _FakeResp(404, {})

        async def post(self, url, **_kw):
            for (m, suffix), resp in routes.items():
                if m == "post" and url.endswith(suffix):
                    return resp
            return _FakeResp(404, {})

    return FakeClient


@pytest.mark.asyncio
async def test_observe_returns_variant_catalog_and_registered_flag(
    httpx_client, db_session, super_admin, monkeypatch
):
    user, token = super_admin
    from app.config import settings

    monkeypatch.setattr(settings, "ml_backend_observe_urls", ["http://obs1:8001"])

    # 注册一个同 URL 的 backend → observe 应标 registered。
    proj = await create_project(db_session, owner_id=user.id, name="POBS")
    from app.db.models.ml_backend import MLBackend

    db_session.add(
        MLBackend(
            project_id=proj.id, name="b", url="http://obs1:8001", state="connected"
        )
    )
    await db_session.flush()

    routes = {
        ("get", "/health"): _FakeResp(
            200,
            {
                "ok": True,
                "loaded": False,
                "model_version": "mv",
                "pool": {"cap": 1, "loaded_variants": []},
                "gpu_info": {"memory_used_mb": 1},
            },
        ),
        ("get", "/setup"): _FakeResp(
            200,
            {
                "supported_variants": [
                    {
                        "key": "series",
                        "title": "Series",
                        "variants": [{"value": "yolo11", "label": "YOLO 11"}],
                    }
                ],
                "params": {
                    "properties": {
                        "sam_variant": {"enum": ["tiny", "large"]},
                        "dino_variant": {"enum": ["T", "B"]},
                    }
                },
            },
        ),
    }
    with patch(
        "app.api.v1.admin_ml_integrations.httpx.AsyncClient", _fake_client(routes)
    ):
        res = await httpx_client.get(
            "/api/v1/admin/ml-integrations/observe",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["configured_count"] == 1
    t = body["targets"][0]
    assert t["ok"] is True
    assert t["supports_variants"] is True
    assert t["variant_catalog"]["sam_variant"] == ["tiny", "large"]
    assert t["supported_variants"][0]["key"] == "series"
    assert t["registered"] is True
    assert "POBS" in (t["registered_label"] or "")


@pytest.mark.asyncio
async def test_smoke_test_skips_when_pool_already_loaded(httpx_client, super_admin):
    """冲突守护: 池子已有变体常驻时不预热/不卸载, 只确认可加载性。"""
    _, token = super_admin
    routes = {
        ("get", "/health"): _FakeResp(
            200,
            {
                "ok": True,
                "loaded": True,
                "pool": {
                    "loaded_variants": [{"sam_variant": "tiny", "dino_variant": "T"}]
                },
            },
        ),
    }
    with patch(
        "app.api.v1.admin_ml_integrations.httpx.AsyncClient", _fake_client(routes)
    ):
        res = await httpx_client.post(
            "/api/v1/admin/ml-integrations/observe/smoke-test",
            json={
                "url": "http://obs1:8001",
                "sam_variant": "large",
                "dino_variant": "B",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["skipped"] is True
    assert body["auto_unloaded"] is False


@pytest.mark.asyncio
async def test_smoke_test_generic_variant_is_skipped_until_backend_warm_exists(
    httpx_client, super_admin
):
    _, token = super_admin
    with patch("app.api.v1.admin_ml_integrations.httpx.AsyncClient", _fake_client({})):
        res = await httpx_client.post(
            "/api/v1/admin/ml-integrations/observe/smoke-test",
            json={
                "url": "http://obs1:8001",
                "variant": {"series": "yolo11", "size": "n"},
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["skipped"] is True
    assert body["message"] == "该容器未声明通用 warm 接口"
    assert body["loaded_variant"] == {"series": "yolo11", "size": "n"}


@pytest.mark.asyncio
async def test_smoke_test_warms_and_unloads_empty_pool(httpx_client, super_admin):
    _, token = super_admin
    routes = {
        ("get", "/health"): _FakeResp(
            200, {"ok": True, "loaded": False, "pool": {"loaded_variants": []}}
        ),
        ("post", "/reload"): _FakeResp(
            200,
            {
                "ok": True,
                "loaded": True,
                "reloaded": True,
                "sam_variant": "large",
                "dino_variant": "B",
            },
        ),
        ("post", "/unload"): _FakeResp(200, {"ok": True, "unloaded": True}),
    }
    with patch(
        "app.api.v1.admin_ml_integrations.httpx.AsyncClient", _fake_client(routes)
    ):
        res = await httpx_client.post(
            "/api/v1/admin/ml-integrations/observe/smoke-test",
            json={
                "url": "http://obs1:8001",
                "sam_variant": "large",
                "dino_variant": "B",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["skipped"] is False
    assert body["reloaded"] is True
    assert body["auto_unloaded"] is True
    assert body["loaded_variant"]["sam_variant"] == "large"


@pytest.mark.asyncio
async def test_smoke_test_requires_super_admin(httpx_client, annotator):
    _, anno_token = annotator
    res = await httpx_client.post(
        "/api/v1/admin/ml-integrations/observe/smoke-test",
        json={"url": "http://x:8001"},
        headers={"Authorization": f"Bearer {anno_token}"},
    )
    assert res.status_code == 403
