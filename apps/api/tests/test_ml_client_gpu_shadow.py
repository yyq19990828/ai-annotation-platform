from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest

from app.config import GPUArbiterMode, settings
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.services.ml_client import MLBackendClient, _semaphores


RESOURCE_ID = "node-a/index:0"


def _backend(*, max_concurrency: int = 4) -> MLBackendRegistry:
    backend = MLBackendRegistry()
    backend.id = uuid.uuid4()
    backend.url = "http://gpu-backend:9090"
    backend.auth_method = "none"
    backend.auth_token = None
    backend.extra_params = {"max_concurrency": max_concurrency}
    backend.gpu_resource_id = RESOURCE_ID
    backend.vram_budget_mb = 8_000
    backend.eviction_priority = 0
    return backend


@pytest.fixture
def observe_mode(monkeypatch):
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode.OBSERVE)
    monkeypatch.setattr(
        settings,
        "gpu_arbiter_resources_json",
        '{"node-a/index:0":{"node_id":"node-a",'
        '"physical_device_token":"index:0","allocatable_mb":20000,'
        '"mode":"observe"}}',
    )


def _transport(events: list[str], *, block: asyncio.Event | None = None):
    async def handler(request: httpx.Request) -> httpx.Response:
        events.append(f"http:{request.url.path}")
        assert "X-AAP-GPU-Generation" not in request.headers
        assert "X-AAP-GPU-Admission-Token" not in request.headers
        if block is not None and request.url.path == "/predict":
            await block.wait()
        if request.url.path == "/predict":
            return httpx.Response(
                200,
                json={"results": [{"task": "t1", "result": []}]},
            )
        return httpx.Response(200, json={"ok": True})

    return httpx.MockTransport(handler)


def _patch_async_client(monkeypatch, transport: httpx.MockTransport) -> None:
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real(*args, **kwargs)

    monkeypatch.setattr("app.services.ml_client.httpx.AsyncClient", factory)


@pytest.mark.asyncio
async def test_all_residency_changing_methods_observe_before_http(
    monkeypatch, observe_mode
) -> None:
    events: list[str] = []
    factory = object()

    async def record(backend_id, operation, session_factory):
        assert session_factory is factory
        events.append(f"shadow:{operation}")

    monkeypatch.setattr("app.services.ml_client.record_gpu_shadow_dispatch", record)
    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(_backend(), shadow_session_factory=factory)  # type: ignore[arg-type]

    await client.predict([{"id": "t1"}])
    await client.predict_interactive({"id": "t1"}, {})
    await client.warmup({})
    await client.reload()
    await client.unload()

    assert events == [
        "shadow:predict",
        "http:/predict",
        "shadow:predict_interactive",
        "http:/predict",
        "shadow:warmup",
        "http:/warmup",
        "shadow:reload",
        "http:/reload",
        "shadow:unload",
        "http:/unload",
    ]


@pytest.mark.asyncio
async def test_shadow_failure_is_fail_open(monkeypatch, observe_mode) -> None:
    events: list[str] = []

    async def fail(*args, **kwargs):
        raise RuntimeError("shadow DB unavailable")

    monkeypatch.setattr("app.services.ml_client.record_gpu_shadow_dispatch", fail)
    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(_backend(), shadow_session_factory=lambda: None)  # type: ignore[arg-type,return-value]

    result = await client.predict([{"id": "t1"}])

    assert len(result) == 1
    assert events == ["http:/predict"]


@pytest.mark.asyncio
async def test_shadow_timeout_is_fail_open_before_pool_wait_can_block_http(
    monkeypatch, observe_mode
) -> None:
    events: list[str] = []
    never = asyncio.Event()

    async def blocked(*args, **kwargs):
        await never.wait()

    monkeypatch.setattr("app.services.ml_client.record_gpu_shadow_dispatch", blocked)
    monkeypatch.setattr(
        "app.services.ml_client._GPU_SHADOW_OBSERVER_TIMEOUT_SECONDS", 0.001
    )
    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(
        _backend(), shadow_session_factory=lambda: None  # type: ignore[arg-type,return-value]
    )

    result = await client.predict([{"id": "t1"}])

    assert len(result) == 1
    assert events == ["http:/predict"]


@pytest.mark.asyncio
async def test_off_mode_does_not_touch_shadow_factory_or_recorder(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode.OFF)
    events: list[str] = []

    async def unexpected(*args, **kwargs):
        raise AssertionError("off mode must not record shadow state")

    monkeypatch.setattr("app.services.ml_client.record_gpu_shadow_dispatch", unexpected)
    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(_backend(), shadow_session_factory=lambda: None)  # type: ignore[arg-type,return-value]

    await client.predict([{"id": "t1"}])

    assert events == ["http:/predict"]


@pytest.mark.asyncio
async def test_predict_observer_runs_after_local_semaphore_acquisition(
    monkeypatch, observe_mode
) -> None:
    backend = _backend(max_concurrency=1)
    _semaphores.pop(str(backend.id), None)
    release = asyncio.Event()
    first_http_started = asyncio.Event()
    shadow_calls = 0

    async def record(*args, **kwargs):
        nonlocal shadow_calls
        shadow_calls += 1

    async def handler(request: httpx.Request) -> httpx.Response:
        first_http_started.set()
        await release.wait()
        return httpx.Response(200, json={"results": [{"task": "t1", "result": []}]})

    monkeypatch.setattr("app.services.ml_client.record_gpu_shadow_dispatch", record)
    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(backend, shadow_session_factory=lambda: None)  # type: ignore[arg-type,return-value]

    first = asyncio.create_task(client.predict([{"id": "t1"}]))
    await first_http_started.wait()
    second = asyncio.create_task(client.predict([{"id": "t2"}]))
    await asyncio.sleep(0)

    assert shadow_calls == 1
    release.set()
    await asyncio.gather(first, second)
    assert shadow_calls == 2
