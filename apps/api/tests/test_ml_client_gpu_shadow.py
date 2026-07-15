from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
import gc
import json
import uuid
import weakref

import httpx
import pytest
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    GPU_ADMISSION_TOKEN_HEADER,
    GPU_GENERATION_HEADER,
    LifecycleModeRequest,
)
from fastapi import HTTPException

from app.config import GPUArbiterMode, settings
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.services.gpu_arbiter import (
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUDispatchGrant,
)
from app.services.ml_client import MLBackendClient, _get_semaphore


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


@pytest.fixture
def enforce_dispatch_mode(monkeypatch):
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode.ENFORCE)
    monkeypatch.setattr(
        settings,
        "gpu_arbiter_resources_json",
        '{"node-a/index:0":{"node_id":"node-a",'
        '"physical_device_token":"index:0","allocatable_mb":20000,'
        '"mode":"enforce"}}',
    )
    monkeypatch.setattr(
        "app.services.ml_client.effective_gpu_arbiter_mode",
        lambda _resource_id: GPUArbiterMode.ENFORCE,
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
        if request.url.path == "/unload":
            assert request.content == b""
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

    def unexpected_dispatch(_request):
        raise AssertionError("observe must not enter workload authority")

    client = MLBackendClient(
        _backend(),
        shadow_session_factory=factory,  # type: ignore[arg-type]
        dispatch_context_factory=unexpected_dispatch,  # type: ignore[arg-type]
    )

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
async def test_two_enforced_cards_share_authority_without_cross_card_identity(
    monkeypatch,
) -> None:
    card_b = "node-a/index:1"
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode.ENFORCE)
    monkeypatch.setattr(
        settings,
        "gpu_arbiter_resources_json",
        '{"node-a/index:0":{"node_id":"node-a",'
        '"physical_device_token":"index:0","allocatable_mb":20000,'
        '"mode":"enforce"},"node-a/index:1":{"node_id":"node-a",'
        '"physical_device_token":"index:1","allocatable_mb":20000,'
        '"mode":"enforce"}}',
    )
    monkeypatch.setattr(
        "app.services.ml_client.effective_gpu_arbiter_mode",
        lambda _resource_id: GPUArbiterMode.ENFORCE,
    )
    backend_a = _backend()
    backend_b = _backend()
    backend_b.gpu_resource_id = card_b
    captured: list[tuple[str, str]] = []

    @asynccontextmanager
    async def dispatch(request):
        captured.append((request.backend_id, request.gpu_resource_id))
        yield GPUDispatchGrant(generation="1", admission_token="signed-token")

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    await MLBackendClient(backend_a, dispatch_context_factory=dispatch).reload()
    await MLBackendClient(backend_b, dispatch_context_factory=dispatch).reload()

    assert captured == [
        (str(backend_a.id), RESOURCE_ID),
        (str(backend_b.id), card_b),
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
        _backend(),
        shadow_session_factory=lambda: None,  # type: ignore[arg-type,return-value]
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

    def unexpected_dispatch(*args, **kwargs):
        raise AssertionError("off mode must not enter dispatch authority")

    monkeypatch.setattr("app.services.ml_client.record_gpu_shadow_dispatch", unexpected)
    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(
        _backend(),
        shadow_session_factory=lambda: None,  # type: ignore[arg-type,return-value]
        dispatch_context_factory=unexpected_dispatch,  # type: ignore[arg-type]
    )

    await client.predict([{"id": "t1"}])
    await client.predict_interactive({"id": "t1"}, {})
    await client.warmup({})
    await client.reload()
    await client.unload()

    assert events == [
        "http:/predict",
        "http:/predict",
        "http:/warmup",
        "http:/reload",
        "http:/unload",
    ]


@pytest.mark.asyncio
async def test_predict_observer_runs_after_local_semaphore_acquisition(
    monkeypatch, observe_mode
) -> None:
    backend = _backend(max_concurrency=1)
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


def test_contended_semaphore_cache_does_not_retain_closed_event_loop() -> None:
    loop_ref: weakref.ReferenceType[asyncio.AbstractEventLoop] | None = None

    async def exercise() -> None:
        nonlocal loop_ref
        loop = asyncio.get_running_loop()
        loop_ref = weakref.ref(loop)
        semaphore = _get_semaphore("gc-regression", 1)
        assert semaphore is not None
        await semaphore.acquire()
        waiter = asyncio.create_task(semaphore.acquire())
        await asyncio.sleep(0)
        assert getattr(semaphore, "_loop", None) is loop
        waiter.cancel()
        with suppress(asyncio.CancelledError):
            await waiter
        semaphore.release()

    asyncio.run(exercise())
    gc.collect()

    assert loop_ref is not None
    assert loop_ref() is None


@pytest.mark.asyncio
async def test_all_residency_methods_use_managed_dispatch_context(
    monkeypatch, enforce_dispatch_mode
) -> None:
    events: list[str] = []
    requests: list[httpx.Request] = []
    outcomes = []

    @asynccontextmanager
    async def dispatch(request):
        events.append(f"enter:{request.operation}:{request.scope.value}")
        grant = GPUDispatchGrant(generation="7", admission_token="signed-token")
        try:
            yield grant
        finally:
            outcomes.append(grant.outcome)
            events.append(f"exit:{request.operation}")

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        events.append(f"http:{request.url.path}")
        assert request.headers[GPU_GENERATION_HEADER] == "7"
        assert request.headers[GPU_ADMISSION_TOKEN_HEADER] == "signed-token"
        if request.url.path == "/predict":
            return httpx.Response(
                200,
                json={"results": [{"task": "t1", "result": []}]},
            )
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)

    await client.predict([{"id": "t1"}])
    await client.predict_interactive({"id": "t1"}, {})
    await client.warmup({})
    await client.reload()
    await client.unload()

    assert events == [
        "enter:predict:predict",
        "http:/predict",
        "exit:predict",
        "enter:predict_interactive:predict",
        "http:/predict",
        "exit:predict_interactive",
        "enter:warmup:warmup",
        "http:/warmup",
        "exit:warmup",
        "enter:reload:reload",
        "http:/reload",
        "exit:reload",
        "enter:unload:unload",
        "http:/unload",
        "exit:unload",
    ]
    assert json.loads(requests[-1].content) == {"generation": "7"}
    assert [outcome.kind for outcome in outcomes] == ["response_received"] * 5
    assert [outcome.status_code for outcome in outcomes] == [200] * 5


@pytest.mark.asyncio
async def test_effective_enforce_survives_desired_mode_demotion(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode.OFF)
    monkeypatch.setattr(
        settings,
        "gpu_arbiter_resources_json",
        '{"node-a/index:0":{"node_id":"node-a",'
        '"physical_device_token":"index:0","allocatable_mb":20000,'
        '"mode":"off"}}',
    )
    monkeypatch.setattr(
        "app.services.ml_client.effective_gpu_arbiter_mode",
        lambda _resource_id: GPUArbiterMode.ENFORCE,
    )
    managed_headers: list[tuple[str, str]] = []

    @asynccontextmanager
    async def dispatch(_request):
        yield GPUDispatchGrant(generation="9", admission_token="demotion-token")

    async def handler(request: httpx.Request) -> httpx.Response:
        managed_headers.append(
            (
                request.headers[GPU_GENERATION_HEADER],
                request.headers[GPU_ADMISSION_TOKEN_HEADER],
            )
        )
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)

    await client.warmup({})

    assert managed_headers == [("9", "demotion-token")]


@pytest.mark.asyncio
async def test_desired_enforce_without_effective_enforce_keeps_legacy_wire(
    monkeypatch, enforce_dispatch_mode
) -> None:
    monkeypatch.setattr(
        "app.services.ml_client.effective_gpu_arbiter_mode",
        lambda _resource_id: GPUArbiterMode.OFF,
    )
    events: list[str] = []

    def unexpected_dispatch(_request):
        raise AssertionError("desired mode must not enter dispatch authority")

    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(
        _backend(),
        dispatch_context_factory=unexpected_dispatch,  # type: ignore[arg-type]
    )

    await client.warmup({})

    assert events == ["http:/warmup"]


@pytest.mark.asyncio
async def test_missing_gpu_claim_fails_closed_when_any_resource_is_enforced(
    monkeypatch, enforce_dispatch_mode
) -> None:
    backend = _backend()
    backend.gpu_resource_id = None
    backend.vram_budget_mb = None
    backend.state = "connected"
    backend.last_checked_at = datetime.now(UTC)
    backend.health_meta = {}
    monkeypatch.setattr(
        "app.services.ml_client.any_gpu_resource_effectively_enforced",
        lambda: True,
    )
    http_calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(backend)

    with pytest.raises(GPUArbiterDispatchError) as exc_info:
        await client.warmup({})

    assert exc_info.value.error_code == GPUArbiterErrorCode.CONFIG_INVALID.value
    assert http_calls == 0


@pytest.mark.asyncio
async def test_explicit_cpu_evidence_is_rechecked_at_dispatch_time(
    monkeypatch, enforce_dispatch_mode
) -> None:
    backend = _backend()
    backend.gpu_resource_id = None
    backend.vram_budget_mb = None
    backend.state = "connected"
    backend.last_checked_at = datetime.now(UTC)
    backend.health_meta = {"compute": {"configured_device": "cpu"}}
    monkeypatch.setattr(
        "app.services.ml_client.any_gpu_resource_effectively_enforced",
        lambda: True,
    )
    events: list[str] = []
    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(backend)

    await client.warmup({})
    backend.last_checked_at = datetime.now(UTC) - timedelta(minutes=4)
    with pytest.raises(GPUArbiterDispatchError) as exc_info:
        await client.warmup({})

    assert events == ["http:/warmup"]
    assert exc_info.value.error_code == GPUArbiterErrorCode.CONFIG_INVALID.value


@pytest.mark.asyncio
async def test_unknown_resource_fails_closed_when_another_card_is_enforced(
    monkeypatch, enforce_dispatch_mode
) -> None:
    backend = _backend()
    backend.gpu_resource_id = "node-z/index:9"
    monkeypatch.setattr(
        "app.services.ml_client.effective_gpu_arbiter_mode",
        lambda _resource_id: GPUArbiterMode.OFF,
    )
    monkeypatch.setattr(
        "app.services.ml_client.any_gpu_resource_effectively_enforced",
        lambda: True,
    )
    http_calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(backend)

    with pytest.raises(GPUArbiterDispatchError) as exc_info:
        await client.reload()

    assert exc_info.value.error_code == GPUArbiterErrorCode.CONFIG_INVALID.value
    assert http_calls == 0


@pytest.mark.asyncio
async def test_enforced_card_does_not_capture_known_off_card(
    monkeypatch,
) -> None:
    card_b = "node-a/index:1"
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode.ENFORCE)
    monkeypatch.setattr(
        settings,
        "gpu_arbiter_resources_json",
        '{"node-a/index:0":{"node_id":"node-a",'
        '"physical_device_token":"index:0","allocatable_mb":20000,'
        '"mode":"enforce"},"node-a/index:1":{"node_id":"node-a",'
        '"physical_device_token":"index:1","allocatable_mb":20000,'
        '"mode":"off"}}',
    )
    monkeypatch.setattr(
        "app.services.ml_client.effective_gpu_arbiter_mode",
        lambda resource_id: (
            GPUArbiterMode.ENFORCE if resource_id == RESOURCE_ID else GPUArbiterMode.OFF
        ),
    )
    monkeypatch.setattr(
        "app.services.ml_client.any_gpu_resource_effectively_enforced",
        lambda: True,
    )
    backend = _backend()
    backend.gpu_resource_id = card_b
    events: list[str] = []

    def unexpected_dispatch(_request):
        raise AssertionError("card A authority must not capture card B")

    _patch_async_client(monkeypatch, _transport(events))
    client = MLBackendClient(
        backend,
        dispatch_context_factory=unexpected_dispatch,  # type: ignore[arg-type]
    )

    await client.reload()

    assert events == ["http:/reload"]


@pytest.mark.asyncio
async def test_enforce_without_dispatch_authority_fails_before_backend_http(
    monkeypatch, enforce_dispatch_mode
) -> None:
    http_calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend())
    calls = [
        lambda: client.predict([{"id": "t1"}]),
        lambda: client.predict_interactive({"id": "t1"}, {}),
        lambda: client.warmup({}),
        lambda: client.reload(),
        lambda: client.unload(),
    ]

    for call in calls:
        with pytest.raises(GPUArbiterDispatchError) as exc_info:
            await call()
        assert exc_info.value.status_code == 503
        assert exc_info.value.detail == {
            "error_code": GPUArbiterErrorCode.NOT_READY.value,
            "message": "GPU arbiter dispatch authority is not configured",
        }

    assert http_calls == 0


@pytest.mark.asyncio
async def test_dispatch_rejection_never_calls_backend(
    monkeypatch, enforce_dispatch_mode
) -> None:
    http_calls = 0

    @asynccontextmanager
    async def reject(_request):
        raise GPUArbiterDispatchError(
            GPUArbiterErrorCode.CAPACITY_UNAVAILABLE,
            message="no idle victim",
            retry_after_s=3,
        )
        yield  # pragma: no cover - required by asynccontextmanager

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=reject)

    with pytest.raises(GPUArbiterDispatchError) as exc_info:
        await client.predict([{"id": "t1"}])

    assert exc_info.value.error_code == "gpu_capacity_unavailable"
    assert exc_info.value.headers == {"Retry-After": "3"}
    assert http_calls == 0


@pytest.mark.asyncio
async def test_invalid_dispatch_grant_fails_closed_before_backend_http(
    monkeypatch, enforce_dispatch_mode
) -> None:
    http_calls = 0

    @asynccontextmanager
    async def invalid_grant(_request):
        try:
            yield None
        except BaseException:
            pass

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(
        _backend(),
        dispatch_context_factory=invalid_grant,  # type: ignore[arg-type]
    )
    calls = [
        lambda: client.predict([{"id": "t1"}]),
        lambda: client.predict_interactive({"id": "t1"}, {}),
        lambda: client.warmup({}),
        lambda: client.reload(),
        lambda: client.unload(),
    ]

    for call in calls:
        with pytest.raises(GPUArbiterDispatchError) as exc_info:
            await call()
        assert exc_info.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value

    assert http_calls == 0


@pytest.mark.asyncio
async def test_managed_dispatch_starts_after_local_semaphore_acquisition(
    monkeypatch, enforce_dispatch_mode
) -> None:
    backend = _backend(max_concurrency=1)
    release = asyncio.Event()
    first_http_started = asyncio.Event()
    dispatch_enters = 0

    @asynccontextmanager
    async def dispatch(_request):
        nonlocal dispatch_enters
        dispatch_enters += 1
        yield GPUDispatchGrant(generation="1", admission_token="signed-token")

    async def handler(_request: httpx.Request) -> httpx.Response:
        first_http_started.set()
        await release.wait()
        return httpx.Response(200, json={"results": [{"task": "t1", "result": []}]})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(backend, dispatch_context_factory=dispatch)

    first = asyncio.create_task(client.predict([{"id": "t1"}]))
    await first_http_started.wait()
    second = asyncio.create_task(client.predict([{"id": "t2"}]))
    await asyncio.sleep(0)

    assert dispatch_enters == 1
    release.set()
    await asyncio.gather(first, second)
    assert dispatch_enters == 2


@pytest.mark.asyncio
async def test_dispatch_context_sees_original_interactive_timeout(
    monkeypatch, enforce_dispatch_mode
) -> None:
    observed: list[type[BaseException]] = []
    outcomes = []

    @asynccontextmanager
    async def dispatch(_request):
        grant = GPUDispatchGrant(generation="1", admission_token="signed-token")
        try:
            yield grant
        except BaseException as exc:
            observed.append(type(exc))
            raise
        finally:
            outcomes.append(grant.outcome)

    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("response lost", request=request)

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)

    with pytest.raises(Exception) as exc_info:
        await client.predict_interactive({"id": "t1"}, {})

    assert getattr(exc_info.value, "status_code", None) == 502
    assert observed == [httpx.ReadTimeout]
    assert outcomes[0].kind == "uncertain"
    assert outcomes[0].reason == "request_aborted"


@pytest.mark.asyncio
async def test_dispatch_context_cannot_suppress_caller_exception(
    monkeypatch, enforce_dispatch_mode
) -> None:
    observed: list[type[BaseException]] = []

    @asynccontextmanager
    async def suppressing_dispatch(_request):
        try:
            yield GPUDispatchGrant(generation="1", admission_token="signed-token")
        except BaseException as exc:
            observed.append(type(exc))

    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("response lost", request=request)

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(
        _backend(),
        dispatch_context_factory=suppressing_dispatch,
    )

    with pytest.raises(httpx.ReadTimeout):
        await client.predict([{"id": "t1"}])

    assert observed == [httpx.ReadTimeout]


@pytest.mark.asyncio
async def test_dispatch_context_sees_explicit_backend_rejection(
    monkeypatch, enforce_dispatch_mode
) -> None:
    observed: list[type[BaseException]] = []
    outcomes = []

    @asynccontextmanager
    async def dispatch(_request):
        grant = GPUDispatchGrant(generation="1", admission_token="signed-token")
        try:
            yield grant
        except BaseException as exc:
            observed.append(type(exc))
            raise
        finally:
            outcomes.append(grant.outcome)

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "backend draining"})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)

    with pytest.raises(httpx.HTTPStatusError):
        await client.predict([{"id": "t1"}])

    assert observed == [httpx.HTTPStatusError]
    assert outcomes[0].kind == "response_received"
    assert outcomes[0].status_code == 503


@pytest.mark.asyncio
async def test_dispatch_context_sees_interactive_backend_rejection(
    monkeypatch, enforce_dispatch_mode
) -> None:
    observed: list[type[BaseException]] = []
    outcomes = []

    @asynccontextmanager
    async def dispatch(_request):
        grant = GPUDispatchGrant(generation="1", admission_token="signed-token")
        try:
            yield grant
        except BaseException as exc:
            observed.append(type(exc))
            raise
        finally:
            outcomes.append(grant.outcome)

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "backend draining"})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)

    with pytest.raises(HTTPException) as exc_info:
        await client.predict_interactive({"id": "t1"}, {})

    assert exc_info.value.status_code == 503
    assert observed == [HTTPException]
    assert outcomes[0].kind == "response_received"
    assert outcomes[0].status_code == 503


@pytest.mark.asyncio
async def test_dispatch_reports_response_before_json_parsing(
    monkeypatch, enforce_dispatch_mode
) -> None:
    outcomes = []

    @asynccontextmanager
    async def dispatch(_request):
        grant = GPUDispatchGrant(generation="1", admission_token="signed-token")
        try:
            yield grant
        finally:
            outcomes.append(grant.outcome)

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json")

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)

    with pytest.raises(json.JSONDecodeError):
        await client.warmup({})

    assert outcomes[0].kind == "response_received"
    assert outcomes[0].status_code == 200


@pytest.mark.asyncio
async def test_dispatch_missing_response_report_is_uncertain(
    monkeypatch, enforce_dispatch_mode
) -> None:
    outcomes = []

    @asynccontextmanager
    async def dispatch(_request):
        grant = GPUDispatchGrant(generation="1", admission_token="signed-token")
        try:
            yield grant
        finally:
            outcomes.append(grant.outcome)

    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)

    async with client._gpu_dispatch("warmup", AdmissionScope.WARMUP):
        pass

    assert outcomes[0].kind == "uncertain"
    assert outcomes[0].reason == "response_not_reported"


@pytest.mark.asyncio
async def test_read_only_methods_bypass_dispatch_context_in_enforce_test_mode(
    monkeypatch, enforce_dispatch_mode
) -> None:
    events: list[str] = []

    def unexpected_dispatch(_request):
        raise AssertionError("health/setup must remain outside dispatch context")

    async def handler(request: httpx.Request) -> httpx.Response:
        events.append(request.url.path)
        assert GPU_GENERATION_HEADER not in request.headers
        assert GPU_ADMISSION_TOKEN_HEADER not in request.headers
        if request.url.path == "/setup":
            assert request.headers["Cache-Control"] == "no-cache"
        return httpx.Response(200, json={"ok": True})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(
        _backend(),
        dispatch_context_factory=unexpected_dispatch,  # type: ignore[arg-type]
    )

    assert await client.health() is True
    assert await client.setup() == {"ok": True}
    assert events == ["/health", "/setup"]


def _legacy_mode_ack_payload() -> dict:
    return {
        "ok": True,
        "gate": "legacy",
        "control_epoch": "8",
        "residency": {
            "state": "unloaded",
            "gpu_loaded": False,
            "active_requests": 0,
            "builders": 0,
            "borrowers": 0,
            "draining": False,
            "evictable": False,
            "generation": None,
            "pools": {
                "models": {
                    "resident": False,
                    "device": None,
                    "provider": None,
                }
            },
            "boot_id": "boot-mode-ack",
            "lifecycle_gate": "legacy",
            "control_epoch": "8",
            "identity": {
                "audience": "aap-gpu-lifecycle",
                "backend_registry_id": "backend-mode-ack",
                "gpu_resource_id": RESOURCE_ID,
            },
        },
    }


def _managed_transition_residency(
    *,
    generation: str,
    state: str,
    gpu_loaded: bool,
    draining: bool,
) -> dict:
    payload = _legacy_mode_ack_payload()["residency"]
    payload.update(
        {
            "state": state,
            "gpu_loaded": gpu_loaded,
            "draining": draining,
            "evictable": gpu_loaded,
            "generation": generation,
            "lifecycle_gate": "enforce",
        }
    )
    payload["pools"]["models"].update(
        {
            "resident": gpu_loaded,
            "device": "cuda:0" if gpu_loaded else None,
            "provider": "CUDAExecutionProvider" if gpu_loaded else None,
        }
    )
    return payload


def _drain_ack_payload(*, cancelled: bool = False) -> dict:
    return {
        "ok": True,
        "generation": "10" if cancelled else "9",
        "draining": not cancelled,
        "active_requests": 0,
        "ready_to_unload": not cancelled,
        "residency": _managed_transition_residency(
            generation="10" if cancelled else "9",
            state="resident" if cancelled else "draining",
            gpu_loaded=True,
            draining=not cancelled,
        ),
    }


def _managed_unload_ack_payload() -> dict:
    return {
        "ok": True,
        "generation": "9",
        "unloaded": True,
        "unloaded_count": 1,
        "residency": _managed_transition_residency(
            generation="9",
            state="unloaded",
            gpu_loaded=False,
            draining=False,
        ),
    }


@pytest.mark.asyncio
async def test_lifecycle_mode_uses_only_signed_control_header(
    monkeypatch, enforce_dispatch_mode
) -> None:
    events: list[str] = []

    def unexpected_dispatch(_request):
        raise AssertionError("lifecycle mode must remain outside workload dispatch")

    async def handler(request: httpx.Request) -> httpx.Response:
        events.append(request.url.path)
        assert request.method == "POST"
        assert request.headers[GPU_ADMISSION_TOKEN_HEADER] == "signed-mode-token"
        assert GPU_GENERATION_HEADER not in request.headers
        assert json.loads(request.content) == {
            "gate": "legacy",
            "control_epoch": "8",
        }
        return httpx.Response(200, json=_legacy_mode_ack_payload())

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(
        _backend(),
        dispatch_context_factory=unexpected_dispatch,  # type: ignore[arg-type]
    )

    response = await client.lifecycle_mode(
        LifecycleModeRequest(gate="legacy", control_epoch="8"),
        admission_token="signed-mode-token",
    )

    assert response.gate.value == "legacy"
    assert response.control_epoch == "8"
    assert events == ["/lifecycle/mode"]


@pytest.mark.asyncio
async def test_lifecycle_mode_rejects_redirect_with_valid_ack_body(monkeypatch) -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(307, json=_legacy_mode_ack_payload())

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))

    with pytest.raises(HTTPException) as exc_info:
        await MLBackendClient(_backend()).lifecycle_mode(
            LifecycleModeRequest(gate="legacy", control_epoch="8"),
            admission_token="signed-mode-token",
        )

    assert exc_info.value.status_code == 502


@pytest.mark.parametrize(
    ("method_name", "path", "generation", "payload"),
    (
        ("lifecycle_drain", "/drain", "9", _drain_ack_payload()),
        (
            "lifecycle_cancel_drain",
            "/drain/cancel",
            "10",
            _drain_ack_payload(cancelled=True),
        ),
        ("lifecycle_unload", "/unload", "9", _managed_unload_ack_payload()),
    ),
)
@pytest.mark.asyncio
async def test_managed_transition_uses_generation_token_pair_outside_dispatch(
    monkeypatch,
    method_name: str,
    path: str,
    generation: str,
    payload: dict,
) -> None:
    def unexpected_dispatch(_request):
        raise AssertionError("managed transition must remain outside workload dispatch")

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == path
        assert request.headers[GPU_GENERATION_HEADER] == generation
        assert request.headers[GPU_ADMISSION_TOKEN_HEADER] == "signed-transition-token"
        assert json.loads(request.content) == {"generation": generation}
        return httpx.Response(200, json=payload)

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(
        _backend(),
        dispatch_context_factory=unexpected_dispatch,  # type: ignore[arg-type]
    )
    grant = GPUDispatchGrant(
        generation=generation,
        admission_token="signed-transition-token",
    )

    response = await getattr(client, method_name)(grant)

    assert response.generation == generation
    assert grant.outcome is not None
    assert grant.outcome.kind == "response_received"
    assert grant.outcome.status_code == 200


@pytest.mark.asyncio
async def test_managed_transition_records_response_before_status_or_json_validation(
    monkeypatch,
) -> None:
    responses = iter(
        (
            httpx.Response(409, json={"detail": "busy"}),
            httpx.Response(200, content=b'{"ok":true,"ok":true}'),
        )
    )

    async def handler(_request: httpx.Request) -> httpx.Response:
        return next(responses)

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend())
    rejected = GPUDispatchGrant(generation="9", admission_token="signed-token")
    invalid = GPUDispatchGrant(generation="9", admission_token="signed-token")

    with pytest.raises(HTTPException) as exc_info:
        await client.lifecycle_drain(rejected)
    with pytest.raises(ValueError, match="drain transition response"):
        await client.lifecycle_drain(invalid)

    assert exc_info.value.status_code == 409
    assert rejected.outcome is not None
    assert rejected.outcome.kind == "response_received"
    assert rejected.outcome.status_code == 409
    assert invalid.outcome is not None
    assert invalid.outcome.kind == "response_received"
    assert invalid.outcome.status_code == 200


@pytest.mark.parametrize(
    ("method_name", "payload"),
    (
        ("lifecycle_drain", _drain_ack_payload()),
        ("lifecycle_cancel_drain", _drain_ack_payload(cancelled=True)),
        ("lifecycle_unload", _managed_unload_ack_payload()),
    ),
)
@pytest.mark.asyncio
async def test_managed_transition_rejects_ack_for_a_different_generation(
    monkeypatch,
    method_name: str,
    payload: dict,
) -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    grant = GPUDispatchGrant(generation="8", admission_token="signed-token")

    with pytest.raises(ValueError, match="generation does not match"):
        await getattr(MLBackendClient(_backend()), method_name)(grant)

    assert grant.outcome is not None
    assert grant.outcome.kind == "response_received"


@pytest.mark.asyncio
async def test_managed_transition_marks_transport_cancellation_uncertain(
    monkeypatch,
) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("transition timed out", request=request)

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    grant = GPUDispatchGrant(generation="9", admission_token="signed-token")

    with pytest.raises(httpx.ReadTimeout):
        await MLBackendClient(_backend()).lifecycle_unload(grant)

    assert grant.outcome is not None
    assert grant.outcome.kind == "uncertain"
    assert grant.outcome.reason == "request_aborted"


@pytest.mark.asyncio
async def test_managed_transition_keeps_response_when_client_exit_fails(
    monkeypatch,
) -> None:
    class ExitFailureClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            raise asyncio.CancelledError

        async def post(self, *_args, **_kwargs) -> httpx.Response:
            return httpx.Response(200, json=_drain_ack_payload())

    monkeypatch.setattr(
        "app.services.ml_client.httpx.AsyncClient",
        lambda **_kwargs: ExitFailureClient(),
    )
    grant = GPUDispatchGrant(generation="9", admission_token="signed-token")

    with pytest.raises(asyncio.CancelledError):
        await MLBackendClient(_backend()).lifecycle_drain(grant)

    assert grant.outcome is not None
    assert grant.outcome.kind == "response_received"
    assert grant.outcome.status_code == 200


@pytest.mark.asyncio
async def test_dispatch_context_sees_cancellation(
    monkeypatch, enforce_dispatch_mode
) -> None:
    observed: list[type[BaseException]] = []
    outcomes = []
    http_started = asyncio.Event()
    never = asyncio.Event()

    @asynccontextmanager
    async def dispatch(_request):
        grant = GPUDispatchGrant(generation="1", admission_token="signed-token")
        try:
            yield grant
        except BaseException as exc:
            observed.append(type(exc))
            raise
        finally:
            outcomes.append(grant.outcome)

    async def handler(_request: httpx.Request) -> httpx.Response:
        http_started.set()
        await never.wait()
        return httpx.Response(200, json={"results": []})

    _patch_async_client(monkeypatch, httpx.MockTransport(handler))
    client = MLBackendClient(_backend(), dispatch_context_factory=dispatch)
    task = asyncio.create_task(client.predict([{"id": "t1"}]))
    await http_started.wait()

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert observed == [asyncio.CancelledError]
    assert outcomes[0].kind == "uncertain"
    assert outcomes[0].reason == "request_aborted"
