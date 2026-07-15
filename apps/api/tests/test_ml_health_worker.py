"""v0.8.6 F2 · ML Backend 周期健康检查 worker 单测。

覆盖：
- `MLBackendService.check_health` 写入 `last_checked_at` + 更新 `state`
- worker `check_all_backends` 遍历所有 backend、单个失败不阻断其他
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, text, update
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)

from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.ml_backend_registry import MLBackendRegistry as MLBackend
from app.services.ml_backend import MLBackendService


async def _make_backend(db: AsyncSession, url: str = "http://example/") -> MLBackend:
    # v0.19.0 ADR-0044 · backend 上提为全局注册表, 不再有 project_id。
    backend = MLBackend(
        id=uuid.uuid4(),
        name="test-backend",
        url=url,
        state="disconnected",
        is_interactive=True,
    )
    db.add(backend)
    await db.flush()
    return backend


async def test_check_health_updates_last_checked_at(
    db_session: AsyncSession, monkeypatch
):
    backend = await _make_backend(db_session)

    async def fake_health_meta(self) -> tuple[bool, dict | None]:  # noqa: ARG001
        return True, None

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health_meta",
        fake_health_meta,
        raising=True,
    )

    svc = MLBackendService(db_session)
    before = datetime.now(timezone.utc)
    healthy = await svc.check_health(backend.id)
    await db_session.flush()

    assert healthy is True
    fresh = await svc.get(backend.id)
    assert fresh is not None
    assert fresh.state == "connected"
    assert fresh.last_checked_at is not None
    assert fresh.last_checked_at >= before


async def test_check_health_marks_error_on_failure(
    db_session: AsyncSession, monkeypatch
):
    backend = await _make_backend(db_session)
    backend.health_meta = {
        "compute": {"configured_device": "cpu"},
        "gpu_info": {"device_uuid": "GPU-stale"},
    }

    async def fake_health_meta(self) -> tuple[bool, dict | None]:  # noqa: ARG001
        return False, None

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health_meta",
        fake_health_meta,
        raising=True,
    )

    svc = MLBackendService(db_session)
    healthy = await svc.check_health(backend.id)

    assert healthy is False
    fresh = await svc.get(backend.id)
    assert fresh.state == "error"
    assert fresh.last_checked_at is not None
    assert fresh.health_meta is None


async def test_check_health_persists_compute_meta(db_session: AsyncSession, monkeypatch):
    backend = await _make_backend(db_session)
    compute = {
        "configured_device": "cuda",
        "effective_provider": "CPUExecutionProvider",
        "cpu_fallback_supported": True,
    }

    async def fake_health_meta(self) -> tuple[bool, dict | None]:  # noqa: ARG001
        return True, {"compute": compute}

    async def fake_setup(self):  # noqa: ARG001
        raise RuntimeError("setup unavailable")

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health_meta",
        fake_health_meta,
        raising=True,
    )
    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.setup",
        fake_setup,
        raising=True,
    )

    assert await MLBackendService(db_session).check_health(backend.id) is True
    await db_session.flush()

    fresh = await MLBackendService(db_session).get(backend.id)
    assert fresh is not None
    assert fresh.health_meta["compute"] == compute


async def test_check_health_discards_response_after_endpoint_identity_changes(
    db_session: AsyncSession, monkeypatch
):
    backend = await _make_backend(db_session, url="http://old-endpoint/")

    async def fake_health_meta(self) -> tuple[bool, dict | None]:  # noqa: ARG001
        await MLBackendService(db_session).update(
            backend.id,
            url="http://new-endpoint/",
        )
        return True, {
            "compute": {"configured_device": "cpu"},
            "gpu_info": {"device_uuid": "GPU-old"},
        }

    async def fake_setup(self):  # noqa: ARG001
        raise RuntimeError("setup unavailable")

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health_meta",
        fake_health_meta,
        raising=True,
    )
    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.setup",
        fake_setup,
        raising=True,
    )

    healthy = await MLBackendService(db_session).check_health(backend.id)

    assert healthy is False
    fresh = await MLBackendService(db_session).get(backend.id)
    assert fresh is not None
    assert fresh.url == "http://new-endpoint"
    assert fresh.state == "disconnected"
    assert fresh.health_meta is None
    assert fresh.last_checked_at is None


async def test_check_health_discards_response_after_gpu_membership_changes(
    db_session: AsyncSession, monkeypatch
):
    backend = await _make_backend(db_session, url="http://gpu-membership-old/")
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(
            gpu_resource_id="node-health/GPU-old",
            vram_budget_mb=1024,
        )
    )
    await db_session.refresh(backend)

    async def fake_health_meta(self) -> tuple[bool, dict | None]:  # noqa: ARG001
        await db_session.execute(
            update(MLBackend)
            .where(MLBackend.id == backend.id)
            .values(gpu_resource_id="node-health/GPU-new")
        )
        return True, {
            "residency": {
                "state": "resident",
                "gpu_loaded": True,
                "identity": {"gpu_resource_id": "node-health/GPU-old"},
            }
        }

    async def fake_setup(self):  # noqa: ARG001
        raise RuntimeError("setup unavailable")

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health_meta",
        fake_health_meta,
        raising=True,
    )
    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.setup",
        fake_setup,
        raising=True,
    )

    assert await MLBackendService(db_session).check_health(backend.id) is False
    fresh = await MLBackendService(db_session).get(backend.id)
    assert fresh is not None
    assert fresh.gpu_resource_id == "node-health/GPU-new"
    assert fresh.health_meta is None
    assert fresh.last_checked_at is None


async def test_check_health_discards_response_after_membership_epoch_changes(
    db_session: AsyncSession, monkeypatch
):
    backend = await _make_backend(db_session, url="http://gpu-membership-epoch/")
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(
            gpu_resource_id="node-health/GPU-epoch",
            vram_budget_mb=1024,
        )
    )
    await db_session.refresh(backend)

    async def fake_health_meta(self) -> tuple[bool, dict | None]:  # noqa: ARG001
        await db_session.execute(
            update(MLBackend)
            .where(MLBackend.id == backend.id)
            .values(vram_budget_mb=2048)
        )
        return True, {
            "residency": {
                "state": "resident",
                "gpu_loaded": True,
                "identity": {"gpu_resource_id": "node-health/GPU-epoch"},
            }
        }

    async def fake_setup(self):  # noqa: ARG001
        raise RuntimeError("setup unavailable")

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health_meta",
        fake_health_meta,
        raising=True,
    )
    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.setup",
        fake_setup,
        raising=True,
    )

    assert await MLBackendService(db_session).check_health(backend.id) is False
    fresh = await MLBackendService(db_session).get(backend.id)
    assert fresh is not None
    assert fresh.vram_budget_mb == 2048
    assert fresh.health_meta is None
    assert fresh.last_checked_at is None


async def test_check_health_rechecks_epoch_after_waiting_on_registry_lock(
    test_engine: AsyncEngine,
    monkeypatch,
) -> None:
    factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    backend_id = uuid.uuid4()
    resource_id = "node-health/GPU-independent-race"
    async with factory.begin() as db:
        db.add(
            MLBackend(
                id=backend_id,
                name="health-epoch-independent-race",
                url=f"http://health-epoch-race-{backend_id}.test",
                state="disconnected",
                gpu_resource_id=resource_id,
                vram_budget_mb=1024,
            )
        )

    health_started = asyncio.Event()
    allow_health_response = asyncio.Event()

    async def fake_health_meta(self) -> tuple[bool, dict | None]:  # noqa: ARG001
        health_started.set()
        await allow_health_response.wait()
        return True, {
            "residency": {
                "state": "resident",
                "gpu_loaded": True,
                "identity": {"gpu_resource_id": resource_id},
            }
        }

    async def fake_setup(self):  # noqa: ARG001
        raise RuntimeError("setup unavailable")

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.health_meta",
        fake_health_meta,
        raising=True,
    )
    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient.setup",
        fake_setup,
        raising=True,
    )

    async def run_health() -> bool:
        async with factory.begin() as db:
            return await MLBackendService(db).check_health(backend_id)

    health_task = asyncio.create_task(run_health())
    config_db = factory()
    try:
        await health_started.wait()
        await config_db.begin()
        await config_db.execute(
            update(MLBackend)
            .where(MLBackend.id == backend_id)
            .values(vram_budget_mb=2048)
        )
        allow_health_response.set()
        await asyncio.sleep(0.05)
        assert not health_task.done()
        await config_db.commit()

        assert await asyncio.wait_for(health_task, timeout=2) is False
        async with factory() as db:
            backend = await db.get(MLBackend, backend_id)
            assert backend is not None
            assert backend.vram_budget_mb == 2048
            assert backend.health_meta is None
            assert backend.last_checked_at is None
    finally:
        if config_db.in_transaction():
            await config_db.rollback()
        await config_db.close()
        if not health_task.done():
            health_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await health_task
        async with factory.begin() as db:
            await db.execute(delete(MLBackend).where(MLBackend.id == backend_id))
            await db.execute(
                text(
                    "ALTER TABLE gpu_backend_memberships DISABLE TRIGGER "
                    "trg_validate_gpu_backend_membership"
                )
            )
            await db.execute(
                delete(GPUBackendMembership).where(
                    GPUBackendMembership.backend_registry_id == backend_id
                )
            )
            await db.execute(
                text(
                    "ALTER TABLE gpu_backend_memberships ENABLE TRIGGER "
                    "trg_validate_gpu_backend_membership"
                )
            )
            await db.execute(
                delete(GPUBackendFence).where(
                    GPUBackendFence.backend_registry_id == backend_id
                )
            )


async def test_check_health_returns_false_for_missing_backend(
    db_session: AsyncSession,
):
    svc = MLBackendService(db_session)
    assert await svc.check_health(uuid.uuid4()) is False


def test_worker_module_imports_and_registers_task():
    """worker 模块能 import；celery_app.tasks 注册了周期任务名。"""
    from app.workers import ml_health
    from app.workers.celery_app import celery_app

    assert hasattr(ml_health, "check_ml_backends_health")
    assert "app.workers.ml_health.check_ml_backends_health" in celery_app.tasks
    assert "check-ml-backends-health" in celery_app.conf.beat_schedule


def test_build_stats_snapshot_keeps_runtime_load_state():
    """PerfHud WS 帧需保留 loaded/pool 状态, 避免 idle unloaded 时误读 VRAM."""
    from app.workers.ml_health import _build_stats_snapshot

    project_id = uuid.uuid4()
    backend = MLBackend(id=uuid.uuid4(), name="sam2", url="http://example")
    snap = _build_stats_snapshot(
        backend,
        ok=True,
        timestamp="2026-05-26T00:00:00+00:00",
        physical_key="http://example",
        url_host="example",
        bindings=[
            {
                "backend_id": str(backend.id),
                "backend_name": "sam2",
                "project_id": str(project_id),
                "project_display_id": "P-1",
                "project_name": "Project One",
            }
        ],
        meta={
            "gpu_info": {"memory_used_mb": 448},
            "model_version": "grounded-sam2-dinoT-sam2.1tiny",
            "loaded": False,
            "idle_unload_seconds": 600,
            "last_request_age_seconds": 2831.8,
            "pool": {"loaded_variants": []},
            "video_pool": {"loaded_variants": [], "active_sessions": 0},
            "compute": {
                "configured_device": "cuda",
                "effective_device": "cpu",
                "cpu_fallback_supported": True,
            },
            "residency": {
                "state": "resident",
                "gpu_loaded": True,
                "active_requests": 0,
                "builders": 1,
                "borrowers": 0,
                "evictable": False,
                "pools": {"models": {"resident": True, "device": "cuda:0"}},
            },
        },
    )

    assert snap["backend_name"] == "sam2"
    assert snap["physical_key"] == "http://example"
    assert snap["url_host"] == "example"
    assert snap["bindings"][0]["project_display_id"] == "P-1"
    assert snap["loaded"] is False
    assert snap["pool"]["loaded_variants"] == []
    assert snap["video_pool"]["active_sessions"] == 0
    assert snap["compute"]["effective_device"] == "cpu"
    assert snap["compute"]["cpu_fallback_supported"] is True
    assert snap["residency"]["gpu_loaded"] is True
    assert snap["residency"]["builders"] == 1
    assert snap["last_request_age_seconds"] == 2831.8


def test_group_backend_rows_merges_same_physical_backend_by_auth_scope():
    """PerfHud 按物理 endpoint 聚合, 但不同鉴权配置不能共用一次 health probe."""
    from app.workers.ml_health import _group_backend_rows

    backend_a = MLBackend(
        id=uuid.uuid4(),
        name="sam-a",
        url="http://ml.local:9000/api",
        auth_method="token",
        auth_token="shared",
    )
    backend_b = MLBackend(
        id=uuid.uuid4(),
        name="sam-b",
        url="http://ml.local:9000/",
        auth_method="token",
        auth_token="shared",
    )
    backend_c = MLBackend(
        id=uuid.uuid4(),
        name="sam-c",
        url="http://ml.local:9000/",
        auth_method="token",
        auth_token="other",
    )

    groups = _group_backend_rows(
        [
            (backend_a, "P-A", "Project A"),
            (backend_b, "P-B", "Project B"),
            (backend_c, "P-C", "Project C"),
        ]
    )

    assert len(groups) == 2
    merged = next(g for g in groups if len(g["bindings"]) == 2)
    assert merged["physical_key"].startswith("http://ml.local:9000|auth:")
    assert merged["url_host"] == "ml.local:9000"
    assert [b["backend_name"] for b in merged["bindings"]] == ["sam-a", "sam-b"]
    assert len({g["physical_key"] for g in groups}) == 2


@pytest.mark.parametrize("jitter", [0.0])
async def test_check_all_backends_iterates_without_jitter(monkeypatch, jitter):
    """jitter=0 时 worker 不 sleep；遍历所有 backend，逐个调用 check_health。

    用 monkeypatch 替换 task_session + service 以绕开 DB（保持快速 + 与 conftest 不耦合）。
    """
    from app.workers import ml_health

    fake_ids = [uuid.uuid4() for _ in range(3)]
    call_log: list[uuid.UUID] = []

    class _StubResult:
        def __init__(self, ids):
            self._ids = ids

        def scalars(self):
            class _Scalars:
                def __init__(self, ids):
                    self._ids = ids

                def all(self):
                    return self._ids

            return _Scalars(self._ids)

    class _FakeSession:
        async def execute(self, stmt):  # noqa: ARG002
            return _StubResult(fake_ids)

        async def commit(self):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    def _factory():
        return _FakeSession()

    class _FakeBackend:
        state = "connected"

    class _FakeService:
        def __init__(self, db):  # noqa: ARG002
            pass

        async def check_health(self, bid):
            call_log.append(bid)
            return True

        async def get(self, bid):  # noqa: ARG002
            return _FakeBackend()

    monkeypatch.setattr(ml_health, "task_session", _factory)
    monkeypatch.setattr(ml_health, "MLBackendService", _FakeService)

    result = await ml_health.check_all_backends(jitter_max_seconds=jitter)

    assert result["checked"] == 3
    assert call_log == fake_ids
    assert all(r["healthy"] is True for r in result["results"])


async def test_check_all_backends_isolates_per_backend_failure(monkeypatch):
    """单个 backend 抛错不阻断其他。"""
    from app.workers import ml_health

    fake_ids = [uuid.uuid4() for _ in range(3)]

    class _StubResult:
        def scalars(self):
            class _S:
                def all(self_inner):
                    return fake_ids

            return _S()

    class _FakeSession:
        async def execute(self, stmt):  # noqa: ARG002
            return _StubResult()

        async def commit(self):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(ml_health, "task_session", lambda: _FakeSession())

    class _FakeService:
        def __init__(self, db):  # noqa: ARG002
            pass

        async def check_health(self, bid):
            if bid == fake_ids[1]:
                raise RuntimeError("middle backend boom")
            return True

        async def get(self, bid):  # noqa: ARG002
            class _B:
                state = "connected"

            return _B()

    monkeypatch.setattr(ml_health, "MLBackendService", _FakeService)

    result = await ml_health.check_all_backends(jitter_max_seconds=0.0)

    assert result["checked"] == 3
    healthy_ids = [r["id"] for r in result["results"] if r["healthy"]]
    error_ids = [r["id"] for r in result["results"] if not r["healthy"]]
    assert len(healthy_ids) == 2
    assert len(error_ids) == 1
    assert error_ids[0] == str(fake_ids[1])
