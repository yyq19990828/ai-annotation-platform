"""v0.8.6 F2 · ML Backend 周期健康检查 worker 单测。

覆盖：
- `MLBackendService.check_health` 写入 `last_checked_at` + 更新 `state`
- worker `check_all_backends` 遍历所有 backend、单个失败不阻断其他
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

import pytest
from aap_protocol_v2.lifecycle import (
    ManagedLifecycleCapabilities,
    managed_lifecycle_capability_sha256,
)
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)

from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.ml_backend_registry import MLBackendRegistry as MLBackend
from app.services.gpu_arbiter import _activate_gpu_backend_membership_in_transaction
from app.services.ml_backend import MLBackendService
from app.services.ml_client import GPU_HEALTH_CHALLENGE_ECHO_MARKER


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


async def test_check_health_persists_compute_meta(
    db_session: AsyncSession, monkeypatch
):
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

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        await db_session.execute(
            update(MLBackend)
            .where(MLBackend.id == backend.id)
            .values(gpu_resource_id="node-health/GPU-new")
        )
        return True, {
            GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge,
            "residency": {
                "state": "resident",
                "gpu_loaded": True,
                "identity": {"gpu_resource_id": "node-health/GPU-old"},
            },
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


async def test_check_health_discards_response_after_configuration_aba(
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

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        await db_session.execute(
            update(MLBackend)
            .where(MLBackend.id == backend.id)
            .values(vram_budget_mb=2048)
        )
        await db_session.execute(
            update(MLBackend)
            .where(MLBackend.id == backend.id)
            .values(vram_budget_mb=1024)
        )
        return True, {
            GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge,
            "residency": {
                "state": "resident",
                "gpu_loaded": True,
                "identity": {"gpu_resource_id": "node-health/GPU-epoch"},
            },
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
    assert fresh.vram_budget_mb == 1024
    assert fresh.health_meta is None
    assert fresh.last_checked_at is None
    membership = await db_session.get(
        GPUBackendMembership,
        {
            "backend_registry_id": backend.id,
            "gpu_resource_id": "node-health/GPU-epoch",
        },
    )
    assert membership is not None
    assert membership.membership_epoch > 1


async def test_gpu_check_health_persists_challenge_bound_probe(
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    backend = await _make_backend(db_session, url="http://gpu-proof-health/")
    resource_id = "node-health/GPU-proof"
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(gpu_resource_id=resource_id, vram_budget_mb=1024)
    )
    await db_session.refresh(backend)
    captured_challenge: str | None = None

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        nonlocal captured_challenge
        captured_challenge = gpu_health_challenge
        await asyncio.sleep(0.01)
        return True, {
            GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge,
            "residency": {
                "state": "unloaded",
                "gpu_loaded": False,
                "active_requests": 0,
                "builders": 0,
                "borrowers": 0,
                "pools": {"models": {"resident": False}},
            },
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

    assert await MLBackendService(db_session).check_health(backend.id) is True
    fresh = await MLBackendService(db_session).get(backend.id)
    assert fresh is not None
    assert fresh.state == "connected"
    assert fresh.health_meta is not None
    assert GPU_HEALTH_CHALLENGE_ECHO_MARKER not in fresh.health_meta
    proof = fresh.health_meta["gpu_arbiter_probe"]
    assert captured_challenge is not None
    assert len(captured_challenge) == 64
    assert set(captured_challenge) <= set("0123456789abcdef")
    assert set(proof) == {
        "protocol_version",
        "challenge",
        "backend_registry_id",
        "gpu_resource_id",
        "membership_epoch",
        "membership_state",
        "managed_lifecycle_sha256",
        "probe_started_at",
        "observed_at",
    }
    assert proof["protocol_version"] == "1"
    assert proof["challenge"] == captured_challenge
    assert proof["backend_registry_id"] == str(backend.id)
    assert proof["gpu_resource_id"] == resource_id
    assert proof["membership_epoch"] == "1"
    assert proof["membership_state"] == "pending"
    assert proof["managed_lifecycle_sha256"] is None
    assert proof["probe_started_at"].endswith("Z")
    assert proof["observed_at"].endswith("Z")
    probe_started_at = datetime.fromisoformat(
        proof["probe_started_at"].replace("Z", "+00:00")
    )
    observed_at = datetime.fromisoformat(proof["observed_at"].replace("Z", "+00:00"))
    assert probe_started_at < observed_at
    assert fresh.last_checked_at == observed_at


async def test_gpu_check_health_binds_strict_capability_after_setup(
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    backend = await _make_backend(db_session, url="http://gpu-capability-health/")
    resource_id = "node-health/GPU-capability"
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(gpu_resource_id=resource_id, vram_budget_mb=1024)
    )
    await db_session.refresh(backend)
    capability = ManagedLifecycleCapabilities().model_dump(mode="json")
    setup_finished_at: datetime | None = None

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        return True, {
            GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge,
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
                "boot_id": "boot-capability",
                "lifecycle_gate": "legacy",
                "control_epoch": None,
                "identity": None,
            },
        }

    async def fake_setup(self):  # noqa: ARG001
        nonlocal setup_finished_at
        setup_finished_at = await db_session.scalar(select(func.clock_timestamp()))
        return {
            "name": "managed-backend",
            "supported_prompts": ["none"],
            "managed_lifecycle": capability,
        }

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
    fresh = await MLBackendService(db_session).get(backend.id)
    assert fresh is not None
    assert fresh.health_meta is not None
    assert fresh.health_meta["capabilities"]["managed_lifecycle"] == capability
    proof = fresh.health_meta["gpu_arbiter_probe"]
    assert proof["managed_lifecycle_sha256"] == (
        managed_lifecycle_capability_sha256(capability)
    )
    probe_started_at = datetime.fromisoformat(
        proof["probe_started_at"].replace("Z", "+00:00")
    )
    observed_at = datetime.fromisoformat(proof["observed_at"].replace("Z", "+00:00"))
    assert setup_finished_at is not None
    assert probe_started_at < setup_finished_at <= observed_at
    assert fresh.last_checked_at == observed_at


async def test_gpu_check_health_clears_stale_capability_after_invalid_setup(
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    backend = await _make_backend(db_session, url="http://gpu-invalid-capability/")
    resource_id = "node-health/GPU-invalid-capability"
    stale_capability = ManagedLifecycleCapabilities().model_dump(mode="json")
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(
            gpu_resource_id=resource_id,
            vram_budget_mb=1024,
            health_meta={
                "capabilities": {"managed_lifecycle": stale_capability},
                "gpu_arbiter_probe": {
                    "managed_lifecycle_sha256": (
                        managed_lifecycle_capability_sha256(stale_capability)
                    )
                },
            },
        )
    )
    await db_session.refresh(backend)

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        return True, {GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge}

    async def fake_setup(self):  # noqa: ARG001
        return {
            "name": "partial-managed-backend",
            "supported_prompts": ["none"],
            "managed_lifecycle": {"protocol_version": "1"},
        }

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
    fresh = await MLBackendService(db_session).get(backend.id)
    assert fresh is not None
    assert fresh.health_meta is not None
    capabilities = fresh.health_meta["capabilities"]
    assert capabilities["managed_lifecycle"] is None
    assert any(
        warning["field"] == "managed_lifecycle" for warning in capabilities["warnings"]
    )
    assert fresh.health_meta["gpu_arbiter_probe"]["managed_lifecycle_sha256"] is None


async def test_gpu_check_health_rejects_zero_length_proof_window(
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    backend = await _make_backend(db_session, url="http://gpu-zero-window/")
    resource_id = "node-health/GPU-zero-window"
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(gpu_resource_id=resource_id, vram_budget_mb=1024)
    )
    await db_session.refresh(backend)

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        return True, {GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge}

    async def fake_setup(self):  # noqa: ARG001
        return {"name": "legacy-backend", "supported_prompts": ["none"]}

    fixed_clock = datetime.now(timezone.utc)
    original_scalar = db_session.scalar

    async def scalar_with_fixed_clock(statement, *args, **kwargs):
        if "clock_timestamp" in str(statement):
            return fixed_clock
        return await original_scalar(statement, *args, **kwargs)

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
    monkeypatch.setattr(db_session, "scalar", scalar_with_fixed_clock)

    assert await MLBackendService(db_session).check_health(backend.id) is False
    await db_session.refresh(backend)
    assert backend.health_meta is None
    assert backend.last_checked_at is None


async def test_gpu_check_health_rejects_older_health_after_slow_setup(
    test_engine: AsyncEngine,
    monkeypatch,
) -> None:
    factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    backend_id = uuid.uuid4()
    resource_id = "node-health/GPU-overlapping-proof"
    async with factory.begin() as db:
        db.add(
            MLBackend(
                id=backend_id,
                name="health-overlapping-proof",
                url=f"http://health-overlapping-{backend_id}.test",
                state="disconnected",
                gpu_resource_id=resource_id,
                vram_budget_mb=1024,
            )
        )

    old_setup_started = asyncio.Event()
    allow_old_setup = asyncio.Event()
    capability = ManagedLifecycleCapabilities().model_dump(mode="json")

    def task_label() -> str:
        task = asyncio.current_task()
        assert task is not None
        return task.get_name()

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        label = task_label()
        return True, {
            GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge,
            "residency": {
                "state": "unloaded",
                "gpu_loaded": False,
                "active_requests": 0,
                "builders": 0,
                "borrowers": 0,
                "draining": False,
                "evictable": False,
                "generation": None,
                "pools": {},
                "boot_id": f"boot-{label}",
                "lifecycle_gate": "legacy",
                "control_epoch": None,
                "identity": None,
            },
        }

    async def fake_setup(self):  # noqa: ARG001
        if task_label() == "older-health":
            old_setup_started.set()
            await allow_old_setup.wait()
            return {
                "name": "older-partial-backend",
                "supported_prompts": ["none"],
                "managed_lifecycle": {"protocol_version": "1"},
            }
        return {
            "name": "newer-managed-backend",
            "supported_prompts": ["none"],
            "managed_lifecycle": capability,
        }

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

    older = asyncio.create_task(run_health(), name="older-health")
    newer: asyncio.Task[bool] | None = None
    try:
        await asyncio.wait_for(old_setup_started.wait(), timeout=2)
        newer = asyncio.create_task(run_health(), name="newer-health")
        assert await asyncio.wait_for(newer, timeout=2) is True
        allow_old_setup.set()
        assert await asyncio.wait_for(older, timeout=2) is False

        async with factory() as db:
            backend = await db.get(MLBackend, backend_id)
            assert backend is not None
            assert backend.health_meta is not None
            assert backend.health_meta["residency"]["boot_id"] == "boot-newer-health"
            assert (
                backend.health_meta["capabilities"]["managed_lifecycle"] == capability
            )
            assert backend.health_meta["gpu_arbiter_probe"][
                "managed_lifecycle_sha256"
            ] == managed_lifecycle_capability_sha256(capability)
    finally:
        allow_old_setup.set()
        for task in (older, newer):
            if task is not None and not task.done():
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
        async with factory.begin() as db:
            await db.execute(
                text(
                    "ALTER TABLE ml_backend_registry DISABLE TRIGGER "
                    "trg_sync_gpu_backend_membership"
                )
            )
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
            await db.execute(delete(MLBackend).where(MLBackend.id == backend_id))
            await db.execute(
                text(
                    "ALTER TABLE ml_backend_registry ENABLE TRIGGER "
                    "trg_sync_gpu_backend_membership"
                )
            )


async def test_gpu_check_health_rotates_challenge_and_clears_stale_probe_without_echo(
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    backend = await _make_backend(db_session, url="http://gpu-unproven-health/")
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(gpu_resource_id="node-health/GPU-unproven", vram_budget_mb=1024)
    )
    challenges: list[str] = []

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        assert gpu_health_challenge is not None
        challenges.append(gpu_health_challenge)
        meta = {"residency": {"state": "unloaded"}}
        if len(challenges) <= 2:
            meta[GPU_HEALTH_CHALLENGE_ECHO_MARKER] = gpu_health_challenge
        return True, meta

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

    service = MLBackendService(db_session)
    assert await service.check_health(backend.id) is True
    fresh = await service.get(backend.id)
    assert fresh is not None
    first_challenge = fresh.health_meta["gpu_arbiter_probe"]["challenge"]

    assert await service.check_health(backend.id) is True
    fresh = await service.get(backend.id)
    assert fresh is not None
    second_challenge = fresh.health_meta["gpu_arbiter_probe"]["challenge"]
    assert second_challenge != first_challenge

    assert await service.check_health(backend.id) is True
    fresh = await service.get(backend.id)
    assert fresh is not None
    assert fresh.state == "connected"
    assert "gpu_arbiter_probe" not in fresh.health_meta
    assert len(challenges) == 3
    assert len(set(challenges)) == 3


async def test_gpu_check_health_rejects_membership_state_change_at_same_epoch(
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    backend = await _make_backend(db_session, url="http://gpu-state-race-health/")
    resource_id = "node-health/GPU-state-race"
    await db_session.execute(
        update(MLBackend)
        .where(MLBackend.id == backend.id)
        .values(gpu_resource_id=resource_id, vram_budget_mb=1024)
    )
    await db_session.flush()

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        await _activate_gpu_backend_membership_in_transaction(
            db_session,
            backend.id,
            gpu_resource_id=resource_id,
            membership_epoch=1,
        )
        return True, {
            GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge,
            "residency": {"state": "unloaded"},
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
    assert fresh.state == "disconnected"
    assert fresh.health_meta is None
    membership = await db_session.get(
        GPUBackendMembership,
        {"backend_registry_id": backend.id, "gpu_resource_id": resource_id},
    )
    assert membership is not None
    assert (membership.membership_epoch, membership.state) == (1, "active")


async def test_gpu_check_health_holds_membership_lock_through_probe_commit(
    test_engine: AsyncEngine,
    monkeypatch,
) -> None:
    factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    backend_id = uuid.uuid4()
    resource_id = "node-health/GPU-membership-lock"
    async with factory.begin() as db:
        db.add(
            MLBackend(
                id=backend_id,
                name="health-membership-lock",
                url=f"http://health-membership-lock-{backend_id}.test",
                state="disconnected",
                gpu_resource_id=resource_id,
                vram_budget_mb=1024,
            )
        )

    final_membership_locked = asyncio.Event()
    allow_health_commit = asyncio.Event()

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
        return True, {
            GPU_HEALTH_CHALLENGE_ECHO_MARKER: gpu_health_challenge,
            "residency": {"state": "unloaded"},
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
        async with factory() as db:
            original_execute = db.execute

            async def execute_with_commit_pause(statement, *args, **kwargs):
                result = await original_execute(statement, *args, **kwargs)
                if getattr(
                    statement, "_for_update_arg", None
                ) is not None and "gpu_backend_memberships" in str(statement):
                    final_membership_locked.set()
                    await allow_health_commit.wait()
                return result

            monkeypatch.setattr(db, "execute", execute_with_commit_pause)
            async with db.begin():
                return await MLBackendService(db).check_health(backend_id)

    async def activate_membership() -> int:
        async with factory.begin() as db:
            return await _activate_gpu_backend_membership_in_transaction(
                db,
                backend_id,
                gpu_resource_id=resource_id,
                membership_epoch=1,
            )

    health_task = asyncio.create_task(run_health())
    activation_task: asyncio.Task[int] | None = None
    try:
        await asyncio.wait_for(final_membership_locked.wait(), timeout=2)
        activation_task = asyncio.create_task(activate_membership())
        await asyncio.sleep(0.05)
        assert not activation_task.done()

        allow_health_commit.set()
        assert await asyncio.wait_for(health_task, timeout=2) is True
        assert await asyncio.wait_for(activation_task, timeout=2) == 1

        async with factory() as db:
            backend = await db.get(MLBackend, backend_id)
            membership = await db.get(
                GPUBackendMembership,
                {
                    "backend_registry_id": backend_id,
                    "gpu_resource_id": resource_id,
                },
            )
            assert backend is not None
            assert backend.health_meta is not None
            assert (
                backend.health_meta["gpu_arbiter_probe"]["membership_state"]
                == "pending"
            )
            assert membership is not None
            assert (membership.membership_epoch, membership.state) == (1, "active")
    finally:
        allow_health_commit.set()
        for task in (health_task, activation_task):
            if task is not None and not task.done():
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
        async with factory.begin() as db:
            await db.execute(
                text(
                    "ALTER TABLE ml_backend_registry DISABLE TRIGGER "
                    "trg_sync_gpu_backend_membership"
                )
            )
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
            await db.execute(delete(MLBackend).where(MLBackend.id == backend_id))
            await db.execute(
                text(
                    "ALTER TABLE ml_backend_registry ENABLE TRIGGER "
                    "trg_sync_gpu_backend_membership"
                )
            )


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

    async def fake_health_meta(
        self, *, gpu_health_challenge: str | None = None
    ) -> tuple[bool, dict | None]:  # noqa: ARG001
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
    assert hasattr(ml_health, "repair_gpu_arbiter_resources")
    assert "app.workers.ml_health.check_ml_backends_health" in celery_app.tasks
    assert "app.workers.ml_health.repair_gpu_arbiter_resources" in celery_app.tasks
    assert "check-ml-backends-health" in celery_app.conf.beat_schedule
    assert (
        celery_app.conf.beat_schedule["check-ml-backends-health"]["options"]["expires"]
        == 55
    )


@pytest.mark.parametrize(
    ("global_mode", "resource_mode"),
    (("off", "enforce"), ("observe", "enforce"), ("enforce", "observe")),
)
async def test_gpu_repair_worker_does_not_touch_redis_outside_desired_enforce(
    monkeypatch,
    global_mode: str,
    resource_mode: str,
) -> None:
    from app.config import GPUArbiterMode, settings
    from app.workers import ml_health

    resource_id = "node-worker/GPU-mode-gate"
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode(global_mode))
    monkeypatch.setattr(
        settings,
        "gpu_arbiter_resources_json",
        json.dumps(
            {
                resource_id: {
                    "node_id": "node-worker",
                    "physical_device_token": "GPU-mode-gate",
                    "allocatable_mb": 8192,
                    "mode": resource_mode,
                }
            }
        ),
    )
    redis_calls = 0

    def fail_if_called(*args, **kwargs):  # noqa: ARG001
        nonlocal redis_calls
        redis_calls += 1
        raise AssertionError("off/observe must not create a GPU Redis store")

    monkeypatch.setattr(ml_health.GPUArbiterStore, "from_url", fail_if_called)

    result = await ml_health._repair_gpu_arbiter_resources()

    assert result == {
        "skipped": True,
        "reason": "no_desired_enforce_resources",
        "resources": [],
    }
    assert redis_calls == 0


async def test_gpu_repair_worker_gives_every_card_time_within_batch(
    monkeypatch,
) -> None:
    from app.config import GPUArbiterMode, settings
    from app.workers import ml_health

    resource_ids = [f"node-worker/GPU-{index}" for index in range(9)]
    monkeypatch.setattr(settings, "gpu_arbiter_mode", GPUArbiterMode.ENFORCE)
    monkeypatch.setattr(
        settings,
        "gpu_arbiter_resources_json",
        json.dumps(
            {
                resource_id: {
                    "node_id": "node-worker",
                    "physical_device_token": f"GPU-{index}",
                    "allocatable_mb": 8192,
                    "mode": "enforce",
                }
                for index, resource_id in enumerate(resource_ids)
            }
        ),
    )
    monkeypatch.setattr(ml_health, "_GPU_REPAIR_WORK_BUDGET_SECONDS", 0.03)
    monkeypatch.setattr(ml_health, "_GPU_REPAIR_BATCH_TIMEOUT_SECONDS", 0.1)

    class FakeEngine:
        async def dispose(self) -> None:
            return None

    class FakeStore:
        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        ml_health, "create_async_engine", lambda *args, **kwargs: FakeEngine()
    )
    monkeypatch.setattr(
        ml_health, "async_sessionmaker", lambda *args, **kwargs: object()
    )
    monkeypatch.setattr(
        ml_health.GPUArbiterStore,
        "from_url",
        lambda *args, **kwargs: FakeStore(),
    )
    started: list[str] = []

    async def slow_repair(factory, store, resource_id, allocatable_mb):  # noqa: ARG001
        started.append(resource_id)
        await asyncio.sleep(0.02)

    monkeypatch.setattr(ml_health, "_repair_one_gpu_resource", slow_repair)

    result = await ml_health._repair_gpu_arbiter_resources()

    assert set(started) == set(resource_ids)
    assert len(result["resources"]) == len(resource_ids)
    assert all(item["status"] == "unavailable" for item in result["resources"])


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
