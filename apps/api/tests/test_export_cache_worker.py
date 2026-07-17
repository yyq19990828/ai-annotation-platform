"""Export cache and worker wiring regression tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.exporting import cache
from app.workers import export as export_worker
from app.workers.celery_app import celery_app


class _ScalarResult:
    def __init__(self, value: object) -> None:
        self.value = value

    def scalar_one_or_none(self) -> object:
        return self.value


class _CacheDB:
    def __init__(self, value: object) -> None:
        self.value = value
        self.deleted: list[object] = []

    async def execute(self, _statement: object) -> _ScalarResult:
        return _ScalarResult(self.value)

    async def delete(self, value: object) -> None:
        self.deleted.append(value)


def test_cache_key_is_target_order_independent_and_contract_sensitive() -> None:
    scope_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    updated_at = datetime(2026, 7, 17, tzinfo=timezone.utc)
    base = cache.compute_cache_key(
        scope_id,
        ["coco", "yolo"],
        True,
        "keyframes",
        updated_at,
        5,
    )
    assert base == "81b5ba8014714ec9ccdef7792801b8fb8624ec1f748174acbf2143af0198b9bf"
    assert base == cache.compute_cache_key(
        scope_id,
        ["yolo", "coco"],
        True,
        "keyframes",
        updated_at,
        5,
    )
    assert base != cache.compute_cache_key(
        scope_id,
        ["coco", "yolo"],
        True,
        "keyframes",
        updated_at,
        4,
    )
    assert base != cache.compute_cache_key(
        scope_id,
        ["coco", "yolo"],
        True,
        "keyframes",
        updated_at,
        5,
        axis_frame="source",
    )


@pytest.mark.asyncio
async def test_cache_lookup_deletes_stale_row_when_object_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = SimpleNamespace(object_key="image/project/job.zip")
    db = _CacheDB(artifact)
    monkeypatch.setattr(cache.storage_service, "verify_upload", lambda *a, **kw: None)

    assert await cache.lookup(db, "cache-key", bucket="exports") is None  # type: ignore[arg-type]
    assert db.deleted == [artifact]


@pytest.mark.asyncio
async def test_cache_lookup_returns_live_artifact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = SimpleNamespace(object_key="image/project/job.zip")
    db = _CacheDB(artifact)
    monkeypatch.setattr(
        cache.storage_service,
        "verify_upload",
        lambda *a, **kw: {"size": 12},
    )

    assert await cache.lookup(db, "cache-key", bucket="exports") is artifact  # type: ignore[arg-type]
    assert db.deleted == []


def test_export_worker_registration_and_route_are_stable() -> None:
    task_name = "app.workers.export.run_export"
    assert export_worker.run_export.name == task_name
    assert celery_app.conf.task_routes[task_name] == {"queue": "export"}


@pytest.mark.asyncio
async def test_export_worker_cache_hit_skips_packaging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    class _SessionContext:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *_args):
            return False

    class _SessionFactory:
        def __call__(self):
            return _SessionContext()

    engine = SimpleNamespace(dispose=AsyncMock())
    monkeypatch.setattr(export_worker, "create_async_engine", lambda *a, **kw: engine)
    monkeypatch.setattr(
        export_worker,
        "async_sessionmaker",
        lambda *a, **kw: _SessionFactory(),
    )

    mark_running = AsyncMock()
    mark_complete = AsyncMock()
    update_progress = AsyncMock()
    monkeypatch.setattr(export_worker.async_job_svc, "mark_running", mark_running)
    monkeypatch.setattr(export_worker.async_job_svc, "mark_complete", mark_complete)
    monkeypatch.setattr(
        export_worker.async_job_svc,
        "update_progress",
        update_progress,
    )
    monkeypatch.setattr(
        export_worker,
        "_scope_fingerprint",
        AsyncMock(return_value=(datetime(2026, 7, 17, tzinfo=timezone.utc), 3)),
    )
    monkeypatch.setattr(
        export_worker,
        "_scope_naming",
        AsyncMock(return_value=("image", "dataset", "P-1")),
    )
    monkeypatch.setattr(export_worker, "_emit_export_notification", AsyncMock())
    monkeypatch.setattr(
        export_worker.export_cache,
        "compute_cache_key",
        lambda *a, **kw: "cache-key",
    )
    artifact = SimpleNamespace(
        object_key="image/project/cached.zip",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        file_count=4,
        size_bytes=128,
    )
    lookup = AsyncMock(return_value=artifact)
    record = AsyncMock()
    monkeypatch.setattr(export_worker.export_cache, "lookup", lookup)
    monkeypatch.setattr(export_worker.export_cache, "record", record)
    build_export_zip = AsyncMock(side_effect=AssertionError("cache hit rebuilt ZIP"))
    monkeypatch.setattr(export_worker, "build_export_zip", build_export_zip)
    monkeypatch.setattr(
        export_worker.storage_service,
        "generate_download_url",
        lambda *a, **kw: "https://download.invalid/cached.zip",
    )

    project_id = "11111111-1111-1111-1111-111111111111"
    job_id = "22222222-2222-2222-2222-222222222222"
    await export_worker._run_export(
        project_id=project_id,
        batch_id=None,
        targets=["coco"],
        opts={},
        async_job_id=job_id,
        celery_task_id="celery-1",
    )

    mark_running.assert_awaited_once()
    lookup.assert_awaited_once_with(
        db,
        "cache-key",
        bucket=export_worker.settings.minio_export_bucket,
    )
    result = mark_complete.await_args.kwargs["result"]
    assert result["cache_hit"] is True
    assert result["object_key"] == artifact.object_key
    update_progress.assert_not_awaited()
    build_export_zip.assert_not_awaited()
    record.assert_not_awaited()
    engine.dispose.assert_awaited_once()
