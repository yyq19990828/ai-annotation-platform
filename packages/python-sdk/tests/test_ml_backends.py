from uuid import uuid4

import httpx
import pytest

from ai_annotation.errors import ConflictError, NotFoundError
from ai_annotation.models import MLBackend

from .conftest import API

PID = str(uuid4())
BID = str(uuid4())


def _backend(state="connected", **extra) -> dict:
    return {
        "id": BID,
        "project_id": PID,
        "name": "sam2-backend",
        "url": "http://gpu-host:9000",
        "state": state,
        "health_meta": {
            "model_version": "v1.2",
            "gpu_info": {
                "gpu_utilization_percent": 73,
                "memory_used_mb": 8000,
                "memory_total_mb": 24000,
                "gpu_temperature_celsius": 61,
            },
            "cache": {"hit_rate": 0.9},
        },
        "error_message": None,
        "last_checked_at": "2026-06-11T00:00:00Z",
        "created_at": "2026-06-11T00:00:00Z",
        "updated_at": "2026-06-11T00:00:00Z",
        **extra,
    }


def test_list_ml_backends(client, respx_mock):
    route = respx_mock.get(f"{API}/projects/{PID}/ml-backends").mock(
        return_value=httpx.Response(200, json=[_backend()])
    )
    backends = client.ml_backends.list(PID)
    assert route.called
    assert len(backends) == 1
    b = backends[0]
    assert isinstance(b, MLBackend)
    assert b.state == "connected"
    assert b.health_meta.model_version == "v1.2"
    assert b.health_meta.gpu_info.gpu_utilization_percent == 73
    assert b.health_meta.cache.hit_rate == 0.9


def test_get_ml_backend(client, respx_mock):
    respx_mock.get(f"{API}/projects/{PID}/ml-backends/{BID}").mock(
        return_value=httpx.Response(200, json=_backend(state="error", error_message="down"))
    )
    b = client.ml_backends.get(PID, BID)
    assert b.state == "error"
    assert b.error_message == "down"


def test_list_ml_backends_global_project_id_none(client, respx_mock):
    # v0.19.1 · 全局注册表: 全局/admin 场景 backend 无项目归属, project_id 可缺省/为 None;
    # MLBackend 必须容忍, 不因 project_id 缺失而 validation error。
    payload = _backend()
    payload.pop("project_id")
    respx_mock.get(f"{API}/projects/{PID}/ml-backends").mock(
        return_value=httpx.Response(200, json=[payload])
    )
    backends = client.ml_backends.list(PID)
    assert len(backends) == 1
    assert backends[0].project_id is None


def test_get_ml_backend_404(client, respx_mock):
    respx_mock.get(f"{API}/projects/{PID}/ml-backends/{BID}").mock(
        return_value=httpx.Response(404, json={"detail": "ML Backend not found"})
    )
    with pytest.raises(NotFoundError):
        client.ml_backends.get(PID, BID)


def test_cancel_job(client, respx_mock):
    route = respx_mock.post(f"{API}/async-jobs/{BID}/cancel").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    client.jobs.cancel(BID)
    assert route.called
    assert route.calls.last.request.method == "POST"


def test_cancel_job_conflict_on_terminal(client, respx_mock):
    respx_mock.post(f"{API}/async-jobs/{BID}/cancel").mock(
        return_value=httpx.Response(409, json={"detail": "cannot cancel terminal job"})
    )
    with pytest.raises(ConflictError):
        client.jobs.cancel(BID)
