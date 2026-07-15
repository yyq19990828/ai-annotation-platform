from __future__ import annotations

import inspect
from types import SimpleNamespace
import uuid

import pytest
from fastapi.params import Depends as DependsParam

from app import deps
from app.api.v1 import admin_ml_integrations, ml_backends
from app.api.v1.tasks import annotations
from app.services import ml_backend as ml_backend_module
from app.services import video_tracker_adapters as tracker_module
from app.services.ml_backend import MLBackendService
from app.services.video_tracker_adapters import (
    MLBackendVideoTrackerAdapter,
    TrackerContext,
)
from app.workers import frame_preannotate


def test_gpu_dispatch_dependency_uses_the_global_short_session_factory(
    monkeypatch,
) -> None:
    marker = object()
    captured: list[object] = []

    def build(session_factory):
        captured.append(session_factory)
        return marker

    monkeypatch.setattr(deps, "build_gpu_dispatch_context_factory", build)

    assert deps.get_gpu_dispatch_context_factory() is marker
    assert captured == [deps.async_session]


def test_dispatching_api_routes_require_the_explicit_authority_dependency() -> None:
    routes = (
        ml_backends.unload_ml_backend,
        ml_backends.reload_ml_backend,
        ml_backends.warmup_ml_backend,
        ml_backends.predict_test,
        ml_backends.interactive_annotating,
        ml_backends.predict_frame,
        ml_backends.interactive_annotating_frame,
        admin_ml_integrations.unload_registry_backend,
        admin_ml_integrations.smoke_test_backend,
        annotations.secondary_inference,
    )

    for route in routes:
        parameter = inspect.signature(route).parameters["dispatch_context_factory"]
        assert isinstance(parameter.default, DependsParam)
        assert parameter.default.dependency is deps.get_gpu_dispatch_context_factory


@pytest.mark.asyncio
async def test_ml_backend_service_forwards_the_exact_authority_factory(
    monkeypatch,
) -> None:
    shadow_factory = object()
    authority_factory = object()
    backend = object()
    clients: list[dict] = []

    class FakeDB:
        async def commit(self) -> None:
            pass

    class FakeClient:
        def __init__(self, received_backend, **kwargs) -> None:
            assert received_backend is backend
            clients.append(kwargs)

        async def unload(self) -> dict:
            return {"operation": "unload"}

        async def reload(self, **kwargs) -> dict:
            return {"operation": "reload", **kwargs}

        async def warmup(self, body: dict) -> dict:
            return {"operation": "warmup", "body": body}

    service = MLBackendService(
        FakeDB(),  # type: ignore[arg-type]
        shadow_session_factory=shadow_factory,  # type: ignore[arg-type]
        dispatch_context_factory=authority_factory,  # type: ignore[arg-type]
    )

    async def get_backend(_registry_id):
        return backend

    monkeypatch.setattr(service, "get", get_backend)
    monkeypatch.setattr(ml_backend_module, "MLBackendClient", FakeClient)

    registry_id = uuid.uuid4()
    assert await service.unload(registry_id) == {"operation": "unload"}
    assert (await service.reload(registry_id))["operation"] == "reload"
    assert await service.warmup(registry_id, {"model": "tiny"}) == {
        "operation": "warmup",
        "body": {"model": "tiny"},
    }
    assert len(clients) == 3
    assert all(item["shadow_session_factory"] is shadow_factory for item in clients)
    assert all(
        item["dispatch_context_factory"] is authority_factory for item in clients
    )


@pytest.mark.asyncio
async def test_video_tracker_adapter_forwards_the_exact_authority_factory(
    monkeypatch,
) -> None:
    shadow_factory = object()
    authority_factory = object()
    captured: list[dict] = []

    class FakeClient:
        def __init__(self, backend, **kwargs) -> None:
            assert backend.state == "connected"
            captured.append(kwargs)

        async def predict_interactive(self, task_data, context):
            return SimpleNamespace(result=[])

    monkeypatch.setattr(tracker_module, "MLBackendClient", FakeClient)
    context = TrackerContext(
        job_id=uuid.uuid4(),
        task_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        dataset_item_id=uuid.uuid4(),
        annotation_id=uuid.uuid4(),
        from_frame=0,
        to_frame=1,
        direction="forward",
        prompt={},
        source_geometry={},
        task_data={"id": "task"},
        ml_backend=SimpleNamespace(state="connected"),
        shadow_session_factory=shadow_factory,  # type: ignore[arg-type]
        dispatch_context_factory=authority_factory,  # type: ignore[arg-type]
    )

    results = [
        item
        async for item in MLBackendVideoTrackerAdapter("sam2_video").propagate(context)
    ]

    assert results == []
    assert captured == [
        {
            "shadow_session_factory": shadow_factory,
            "dispatch_context_factory": authority_factory,
        }
    ]


@pytest.mark.asyncio
async def test_frame_segment_builds_authority_from_its_own_session_factory(
    monkeypatch,
) -> None:
    authority_marker = object()
    backend = object()
    task = object()
    client_kwargs: list[dict] = []
    built_from: list[object] = []

    class FakeEngine:
        async def dispose(self) -> None:
            pass

    class FakeDB:
        async def get(self, model, _row_id):
            if model.__name__ == "MLBackendRegistry":
                return backend
            if model.__name__ == "Task":
                return task
            raise AssertionError(f"unexpected model: {model}")

    class FakeSessionFactory:
        def __call__(self):
            class SessionContext:
                async def __aenter__(self):
                    return FakeDB()

                async def __aexit__(self, *args):
                    return False

            return SessionContext()

    session_factory = FakeSessionFactory()

    def build_authority(received_factory):
        built_from.append(received_factory)
        return authority_marker

    class FakeClient:
        def __init__(self, received_backend, **kwargs) -> None:
            assert received_backend is backend
            client_kwargs.append(kwargs)

    async def build_frame_context(_db, received_task):
        assert received_task is task
        return object()

    async def cancelled(_db, _job_id):
        return True

    monkeypatch.setattr(
        "sqlalchemy.ext.asyncio.create_async_engine",
        lambda *args, **kwargs: FakeEngine(),
    )
    monkeypatch.setattr(
        "sqlalchemy.ext.asyncio.async_sessionmaker",
        lambda *args, **kwargs: session_factory,
    )
    monkeypatch.setattr(
        "app.services.gpu_dispatch_authority.build_gpu_dispatch_context_factory",
        build_authority,
    )
    monkeypatch.setattr("app.services.ml_client.MLBackendClient", FakeClient)
    monkeypatch.setattr(
        "app.services.video_frame_service.build_context_from_task",
        build_frame_context,
    )
    monkeypatch.setattr(frame_preannotate, "_job_cancelled", cancelled)

    stats = await frame_preannotate._run_segment(
        segment={"task_id": str(uuid.uuid4()), "frame_indices": [0]},
        project_id=str(uuid.uuid4()),
        ml_backend_id=str(uuid.uuid4()),
        stage0={},
        job_id=str(uuid.uuid4()),
        celery_root_task_id=None,
    )

    assert stats["frames_done"] == 0
    assert built_from == [session_factory]
    assert client_kwargs == [
        {
            "shadow_session_factory": session_factory,
            "dispatch_context_factory": authority_marker,
        }
    ]
