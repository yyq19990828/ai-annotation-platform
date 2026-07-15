from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
import json
import os
import time
import uuid

import pytest
from aap_protocol_v2.lifecycle import (
    ManagedLifecycleCapabilities,
    managed_lifecycle_capability_sha256,
)
from redis.asyncio import Redis
from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.orm.attributes import flag_modified

from app.config import Settings, settings
from app.db.models.gpu_backend_fence import GPUBackendFence
from app.db.models.gpu_backend_membership import GPUBackendMembership
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.services.gpu_arbiter import (
    _record_gpu_backend_token_expiry_in_transaction,
    activate_gpu_backend_membership,
    collect_gpu_backend_tombstone,
    commit_gpu_proof_reset_from_health,
    record_gpu_backend_token_expiry,
    repair_gpu_resource,
)
from app.services.gpu_arbiter_store import (
    GPUAllocation,
    GPUAllocationState,
    GPUArbiterStore,
    GPUBackendDomainMember,
    GPUProofResetContext,
    GPUReconcileResult,
)


_RESOURCE_A = "node-proof/GPU-a"
_RESOURCE_B = "node-proof/GPU-b"


def _proof_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _resource_config(*resource_ids: str, allocatable_mb: int = 8192) -> Settings:
    resources = {
        resource_id: {
            "node_id": resource_id.split("/", 1)[0],
            "physical_device_token": resource_id.split("/", 1)[1],
            "allocatable_mb": allocatable_mb,
            "mode": "off",
        }
        for resource_id in resource_ids
    }
    return Settings(
        _env_file=None,
        gpu_arbiter_resources_json=json.dumps(resources),
    )


def _redis_url() -> str:
    return os.environ.get("TEST_REDIS_URL", settings.redis_url)


async def _clean_redis_namespace(redis_url: str, namespace: str) -> None:
    client = Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
        retry_on_timeout=False,
    )
    try:
        async with asyncio.timeout(5):
            keys = [key async for key in client.scan_iter(match=f"{namespace}:*")]
            if keys:
                await client.unlink(*keys)
    finally:
        async with asyncio.timeout(2):
            await client.aclose()


@pytest.fixture
async def proof_store() -> AsyncIterator[GPUArbiterStore]:
    redis_url = _redis_url()
    namespace = f"gpu-proof-consumer-test:{uuid.uuid4().hex}"
    store = GPUArbiterStore.from_url(redis_url, namespace=namespace)
    try:
        assert await store.ping() is True
        yield store
    finally:
        await store.aclose()
        await _clean_redis_namespace(redis_url, namespace)


async def _create_active_backends(
    test_engine: AsyncEngine,
    *,
    resource_id: str,
    budgets: tuple[int, ...],
) -> tuple[async_sessionmaker[AsyncSession], tuple[uuid.UUID, ...]]:
    factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    backend_ids = tuple(uuid.uuid4() for _ in budgets)
    async with factory.begin() as db:
        for index, (backend_id, budget) in enumerate(
            zip(backend_ids, budgets, strict=True)
        ):
            db.add(
                MLBackendRegistry(
                    id=backend_id,
                    name=f"gpu-proof-{index}",
                    url=f"http://gpu-proof-{backend_id}.test",
                    gpu_resource_id=resource_id,
                    vram_budget_mb=budget,
                    eviction_priority=index,
                    extra_params={"max_concurrency": index + 4},
                )
            )
    for backend_id in backend_ids:
        assert (
            await activate_gpu_backend_membership(
                factory,
                backend_id,
                gpu_resource_id=resource_id,
                membership_epoch=1,
            )
            == "1"
        )
    return factory, backend_ids


async def _cleanup_backends(
    factory: async_sessionmaker[AsyncSession], backend_ids: tuple[uuid.UUID, ...]
) -> None:
    if not backend_ids:
        return
    async with factory.begin() as db:
        await db.execute(
            update(GPUBackendFence)
            .where(GPUBackendFence.backend_registry_id.in_(backend_ids))
            .values(
                generation_high_water=0,
                control_epoch_high_water=0,
                runtime_epoch_high_water=0,
                token_expiry_high_water=None,
            )
        )
        await db.execute(
            delete(MLBackendRegistry).where(MLBackendRegistry.id.in_(backend_ids))
        )
        await db.execute(
            text(
                "ALTER TABLE gpu_backend_memberships DISABLE TRIGGER "
                "trg_validate_gpu_backend_membership"
            )
        )
        await db.execute(
            delete(GPUBackendMembership).where(
                GPUBackendMembership.backend_registry_id.in_(backend_ids)
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
                GPUBackendFence.backend_registry_id.in_(backend_ids)
            )
        )


def _residency(
    backend_id: uuid.UUID,
    resource_id: str,
    *,
    resident: bool,
) -> dict:
    if resident:
        return {
            "state": "resident",
            "gpu_loaded": True,
            "active_requests": 0,
            "builders": 0,
            "borrowers": 0,
            "draining": False,
            "evictable": True,
            "generation": "1",
            "pools": {
                "models": {
                    "resident": True,
                    "device": "cuda:0",
                    "provider": None,
                }
            },
            "boot_id": f"boot-{backend_id}",
            "lifecycle_gate": "enforce",
            "control_epoch": "1",
            "identity": {
                "audience": "aap-gpu-lifecycle",
                "backend_registry_id": str(backend_id),
                "gpu_resource_id": resource_id,
            },
        }
    return {
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
                "device": "cpu",
                "provider": None,
            }
        },
        "boot_id": f"boot-{backend_id}",
        "lifecycle_gate": "legacy",
        "control_epoch": None,
        "identity": None,
    }


async def _install_live_health(
    factory: async_sessionmaker[AsyncSession],
    backend_ids: tuple[uuid.UUID, ...],
    *,
    resource_id: str,
    resident_backend_ids: frozenset[uuid.UUID] = frozenset(),
) -> dict[uuid.UUID, datetime]:
    started_by_backend: dict[uuid.UUID, datetime] = {}
    async with factory.begin() as db:
        db_now = await db.scalar(select(text("clock_timestamp()")))
        assert isinstance(db_now, datetime)
        for index, backend_id in enumerate(backend_ids):
            membership = await db.get(GPUBackendMembership, (backend_id, resource_id))
            fence = await db.get(GPUBackendFence, backend_id)
            backend = await db.get(MLBackendRegistry, backend_id)
            assert membership is not None
            assert fence is not None
            assert backend is not None
            probe_started_at = db_now - timedelta(seconds=2, milliseconds=index)
            observed_at = db_now - timedelta(seconds=1, milliseconds=index)
            started_by_backend[backend_id] = probe_started_at
            resident = backend_id in resident_backend_ids
            fence.generation_high_water = 1 if resident else 0
            fence.control_epoch_high_water = 1 if resident else 0
            fence.token_expiry_high_water = probe_started_at - timedelta(seconds=1)
            backend.state = "connected"
            backend.last_checked_at = observed_at
            backend.health_meta = {
                "gpu_arbiter_probe": {
                    "protocol_version": "1",
                    "challenge": f"{index + 1:064x}",
                    "backend_registry_id": str(backend_id),
                    "gpu_resource_id": resource_id,
                    "membership_epoch": str(membership.membership_epoch),
                    "membership_state": membership.state,
                    "managed_lifecycle_sha256": None,
                    "probe_started_at": _proof_timestamp(probe_started_at),
                    "observed_at": _proof_timestamp(observed_at),
                },
                "residency": _residency(
                    backend_id,
                    resource_id,
                    resident=resident,
                ),
            }
    return started_by_backend


async def _membership_domain(
    factory: async_sessionmaker[AsyncSession], resource_id: str
) -> tuple[GPUBackendDomainMember, ...]:
    async with factory() as db:
        rows = (
            (
                await db.execute(
                    select(GPUBackendMembership)
                    .where(GPUBackendMembership.gpu_resource_id == resource_id)
                    .order_by(GPUBackendMembership.backend_registry_id)
                )
            )
            .scalars()
            .all()
        )
    return tuple(
        GPUBackendDomainMember(
            backend_id=str(row.backend_registry_id),
            membership_epoch=row.membership_epoch,
            state=row.state,  # type: ignore[arg-type]
        )
        for row in rows
    )


def _fake_context(
    resource_id: str,
    memberships: tuple[GPUBackendDomainMember, ...],
    *,
    allocatable_mb: int = 8192,
) -> GPUProofResetContext:
    return GPUProofResetContext(
        resource_id=resource_id,
        allocatable_mb=allocatable_mb,
        reset_id=f"proof-{uuid.uuid4().hex}",
        begin_fingerprint="a" * 64,
        ledger_revision=1,
        ledger_incarnation=uuid.uuid4().hex,
        prepared_at_ms=int(time.time() * 1000),
        backend_ids=tuple(item.backend_id for item in memberships),
        active_backend_ids=tuple(
            item.backend_id for item in memberships if item.state == "active"
        ),
        backend_memberships=memberships,
    )


class _RecordingProofStore:
    def __init__(self, *, block: bool = False) -> None:
        self.calls: list[dict] = []
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        if not block:
            self.release.set()

    async def commit_proof_reset(self, resource_id: str, allocatable_mb: int, **kwargs):
        self.calls.append(
            {
                "resource_id": resource_id,
                "allocatable_mb": allocatable_mb,
                **kwargs,
            }
        )
        self.entered.set()
        await self.release.wait()
        ready = kwargs["ready"]
        return GPUReconcileResult(
            status="reconciled" if ready else "not_ready",
            ready=ready,
            ledger_revision=2,
            ledger_incarnation=kwargs["expected_reset_incarnation"],
            committed_mb=sum(item.budget_mb for item in kwargs["allocations"]),
            reason="" if ready else "proof_incomplete",
        )


@pytest.mark.asyncio
async def test_proof_recovery_commits_complete_multi_backend_snapshot_idempotently(
    test_engine: AsyncEngine,
    proof_store: GPUArbiterStore,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024, 2048),
    )
    try:
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset({backend_ids[1]}),
        )
        memberships = await _membership_domain(factory, _RESOURCE_A)
        prepared = await proof_store.begin_proof_reset(
            _RESOURCE_A,
            8192,
            expected_ledger_revision=None,
            expected_ledger_incarnation=None,
            backend_memberships=memberships,
            reset_id=f"proof-{uuid.uuid4().hex}",
        )
        assert prepared.status == "prepared"
        raw = Redis.from_url(_redis_url(), decode_responses=True)
        try:
            stale_prepared_at_ms = int(time.time() * 1000) - 600_000
            await raw.hset(
                proof_store.keys(_RESOURCE_A).card,
                mapping={
                    "proof_reset_prepared_at_ms": stale_prepared_at_ms,
                    "updated_at_ms": stale_prepared_at_ms,
                },
            )
        finally:
            await raw.aclose()
        context = await proof_store.prepared_proof_reset(_RESOURCE_A)
        assert context is not None

        first = await commit_gpu_proof_reset_from_health(
            factory,
            proof_store,
            context,
            config=_resource_config(_RESOURCE_A),
        )
        second = await commit_gpu_proof_reset_from_health(
            factory,
            proof_store,
            context,
            config=_resource_config(_RESOURCE_A),
        )

        assert first.status == "reconciled"
        assert first.ready is True
        assert second.status == "reconciled"
        assert second.ready is True
        assert second.idempotent is True
        snapshot = await proof_store.snapshot(_RESOURCE_A)
        assert snapshot.ready is True
        assert len(snapshot.allocations) == 1
        allocation = snapshot.allocations[0]
        assert allocation.backend_id == str(backend_ids[1])
        assert allocation.state is GPUAllocationState.RESIDENT
        assert allocation.generation == "1"
        assert allocation.budget_mb == 2048
        assert allocation.evictable is False
    finally:
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_proof_recovery_accepts_matching_managed_lifecycle_capability(
    test_engine: AsyncEngine,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    store = _RecordingProofStore()
    try:
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset(backend_ids),
        )
        capability = ManagedLifecycleCapabilities().model_dump(mode="json")
        async with factory.begin() as db:
            backend = await db.get(MLBackendRegistry, backend_ids[0])
            assert backend is not None
            assert backend.health_meta is not None
            health_meta = json.loads(json.dumps(backend.health_meta))
            health_meta["capabilities"] = {"managed_lifecycle": capability}
            health_meta["gpu_arbiter_probe"]["managed_lifecycle_sha256"] = (
                managed_lifecycle_capability_sha256(capability)
            )
            backend.health_meta = health_meta
            flag_modified(backend, "health_meta")
        context = _fake_context(
            _RESOURCE_A, await _membership_domain(factory, _RESOURCE_A)
        )

        result = await commit_gpu_proof_reset_from_health(
            factory,
            store,  # type: ignore[arg-type]
            context,
            config=_resource_config(_RESOURCE_A),
        )

        assert result.ready is True
        assert store.calls[-1]["ready"] is True
        allocations = store.calls[-1]["allocations"]
        assert len(allocations) == 1
        assert allocations[0].state is GPUAllocationState.RESIDENT
        assert allocations[0].evictable is False
    finally:
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_stale_prepared_context_can_still_commit_not_ready(
    test_engine: AsyncEngine,
    proof_store: GPUArbiterStore,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        memberships = await _membership_domain(factory, _RESOURCE_A)
        prepared = await proof_store.begin_proof_reset(
            _RESOURCE_A,
            8192,
            expected_ledger_revision=None,
            expected_ledger_incarnation=None,
            backend_memberships=memberships,
            reset_id=f"stale-proof-{uuid.uuid4().hex}",
        )
        assert prepared.status == "prepared"
        stale_prepared_at_ms = int(time.time() * 1000) - 600_000
        await raw.hset(
            proof_store.keys(_RESOURCE_A).card,
            mapping={
                "proof_reset_prepared_at_ms": stale_prepared_at_ms,
                "updated_at_ms": stale_prepared_at_ms,
            },
        )
        context = await proof_store.prepared_proof_reset(_RESOURCE_A)
        assert context is not None

        first = await commit_gpu_proof_reset_from_health(
            factory,
            proof_store,
            context,
            config=_resource_config(_RESOURCE_A),
        )
        second = await commit_gpu_proof_reset_from_health(
            factory,
            proof_store,
            context,
            config=_resource_config(_RESOURCE_A),
        )

        assert first.status == "not_ready"
        assert first.ready is False
        assert first.reason == "proof_incomplete"
        assert second.status == "not_ready"
        assert second.ready is False
        assert second.idempotent is True
        assert await proof_store.prepared_proof_reset(_RESOURCE_A) is None
    finally:
        await raw.aclose()
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_pending_member_is_conservative_unknown(
    test_engine: AsyncEngine,
) -> None:
    factory, active_backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    pending_backend_id = uuid.uuid4()
    backend_ids = active_backend_ids + (pending_backend_id,)
    store = _RecordingProofStore()
    try:
        async with factory.begin() as db:
            db.add(
                MLBackendRegistry(
                    id=pending_backend_id,
                    name="pending-proof",
                    url=f"http://pending-proof-{pending_backend_id}.test",
                    gpu_resource_id=_RESOURCE_A,
                    vram_budget_mb=512,
                )
            )
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
        )
        context = _fake_context(
            _RESOURCE_A, await _membership_domain(factory, _RESOURCE_A)
        )

        result = await commit_gpu_proof_reset_from_health(
            factory,
            store,  # type: ignore[arg-type]
            context,
            config=_resource_config(_RESOURCE_A),
        )

        assert result.ready is False
        pending_allocation = next(
            item
            for item in store.calls[-1]["allocations"]
            if item.backend_id == str(pending_backend_id)
        )
        assert pending_allocation.state is GPUAllocationState.UNKNOWN
        assert pending_allocation.generation is None
        assert pending_allocation.budget_mb == 512
    finally:
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid_case",
    (
        "horizon_equal",
        "horizon_missing",
        "identity_mismatch",
        "stale_probe",
        "bool_counter",
        "generation_ahead",
        "capability_hash_mismatch",
        "capability_snapshot_invalid",
        "legacy_probe_schema",
        "extra_field",
    ),
)
async def test_proof_recovery_maps_untrusted_evidence_to_unknown(
    test_engine: AsyncEngine,
    invalid_case: str,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    store = _RecordingProofStore()
    try:
        started = await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset(backend_ids),
        )
        backend_id = backend_ids[0]
        async with factory.begin() as db:
            fence = await db.get(GPUBackendFence, backend_id)
            backend = await db.get(MLBackendRegistry, backend_id)
            assert fence is not None
            assert backend is not None
            assert backend.health_meta is not None
            if invalid_case == "horizon_equal":
                fence.token_expiry_high_water = started[backend_id]
            elif invalid_case == "horizon_missing":
                fence.token_expiry_high_water = None
            else:
                health_meta = json.loads(json.dumps(backend.health_meta))
                if invalid_case == "bool_counter":
                    health_meta["residency"]["active_requests"] = False
                elif invalid_case == "generation_ahead":
                    health_meta["residency"]["generation"] = "2"
                elif invalid_case == "capability_hash_mismatch":
                    health_meta["gpu_arbiter_probe"]["managed_lifecycle_sha256"] = (
                        "a" * 64
                    )
                elif invalid_case == "capability_snapshot_invalid":
                    health_meta["capabilities"] = {
                        "managed_lifecycle": {"protocol_version": "1"}
                    }
                elif invalid_case == "legacy_probe_schema":
                    health_meta["gpu_arbiter_probe"].pop("managed_lifecycle_sha256")
                elif invalid_case == "identity_mismatch":
                    health_meta["residency"]["identity"]["backend_registry_id"] = str(
                        uuid.uuid4()
                    )
                elif invalid_case == "stale_probe":
                    stale_observed_at = started[backend_id] - timedelta(minutes=10)
                    stale_started_at = stale_observed_at - timedelta(seconds=1)
                    health_meta["gpu_arbiter_probe"]["probe_started_at"] = (
                        _proof_timestamp(stale_started_at)
                    )
                    health_meta["gpu_arbiter_probe"]["observed_at"] = _proof_timestamp(
                        stale_observed_at
                    )
                    backend.last_checked_at = stale_observed_at
                    fence.token_expiry_high_water = stale_started_at - timedelta(
                        seconds=1
                    )
                else:
                    health_meta["residency"]["unexpected"] = True
                backend.health_meta = health_meta
                flag_modified(backend, "health_meta")
        context = _fake_context(
            _RESOURCE_A, await _membership_domain(factory, _RESOURCE_A)
        )

        result = await commit_gpu_proof_reset_from_health(
            factory,
            store,  # type: ignore[arg-type]
            context,
            config=_resource_config(_RESOURCE_A),
        )

        assert result.ready is False
        assert len(store.calls) == 1
        call = store.calls[-1]
        assert call["ready"] is False
        assert len(call["allocations"]) == 1
        allocation = call["allocations"][0]
        assert allocation.state is GPUAllocationState.UNKNOWN
        assert allocation.generation is None
        assert allocation.evictable is False
        assert allocation.budget_mb == 1024
    finally:
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_busy_but_strict_residency_keeps_known_generation_unknown(
    test_engine: AsyncEngine,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    store = _RecordingProofStore()
    try:
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset(backend_ids),
        )
        async with factory.begin() as db:
            backend = await db.get(MLBackendRegistry, backend_ids[0])
            assert backend is not None
            assert backend.health_meta is not None
            health_meta = json.loads(json.dumps(backend.health_meta))
            health_meta["residency"]["active_requests"] = 1
            backend.health_meta = health_meta
            flag_modified(backend, "health_meta")
        context = _fake_context(
            _RESOURCE_A, await _membership_domain(factory, _RESOURCE_A)
        )

        result = await commit_gpu_proof_reset_from_health(
            factory,
            store,  # type: ignore[arg-type]
            context,
            config=_resource_config(_RESOURCE_A),
        )

        assert result.ready is False
        assert len(store.calls) == 1
        allocation = store.calls[0]["allocations"][0]
        assert allocation.state is GPUAllocationState.UNKNOWN
        assert allocation.generation == "1"
        assert allocation.evictable is False
    finally:
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_recovery_rechecks_horizon_after_membership_lock_wait(
    test_engine: AsyncEngine,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    store = _RecordingProofStore()
    holder_release = asyncio.Event()
    holder_locked = asyncio.Event()
    holder_task: asyncio.Task | None = None
    recovery_task: asyncio.Task | None = None
    try:
        started = await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset(backend_ids),
        )
        backend_id = backend_ids[0]
        context = _fake_context(
            _RESOURCE_A, await _membership_domain(factory, _RESOURCE_A)
        )

        async def hold_new_horizon() -> None:
            async with factory() as db:
                async with db.begin():
                    await _record_gpu_backend_token_expiry_in_transaction(
                        db,
                        backend_id,
                        gpu_resource_id=_RESOURCE_A,
                        membership_epoch=1,
                        token_expires_at=(
                            started[backend_id] + timedelta(milliseconds=1)
                        ),
                    )
                    holder_locked.set()
                    await holder_release.wait()

        holder_task = asyncio.create_task(hold_new_horizon())
        await asyncio.wait_for(holder_locked.wait(), timeout=1)
        recovery_task = asyncio.create_task(
            commit_gpu_proof_reset_from_health(
                factory,
                store,  # type: ignore[arg-type]
                context,
                config=_resource_config(_RESOURCE_A),
            )
        )
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(store.entered.wait(), timeout=0.05)
        holder_release.set()
        await holder_task
        result = await recovery_task

        assert result.ready is False
        assert len(store.calls) == 1
        allocation = store.calls[-1]["allocations"][0]
        assert allocation.state is GPUAllocationState.UNKNOWN
        assert allocation.generation is None
    finally:
        holder_release.set()
        if holder_task is not None:
            await asyncio.gather(holder_task, return_exceptions=True)
        if recovery_task is not None:
            await asyncio.gather(recovery_task, return_exceptions=True)
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_recovery_holds_same_card_locks_through_redis_commit(
    test_engine: AsyncEngine,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    store = _RecordingProofStore(block=True)
    recovery_task: asyncio.Task | None = None
    writer_task: asyncio.Task | None = None
    try:
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset(backend_ids),
        )
        context = _fake_context(
            _RESOURCE_A, await _membership_domain(factory, _RESOURCE_A)
        )
        recovery_task = asyncio.create_task(
            commit_gpu_proof_reset_from_health(
                factory,
                store,  # type: ignore[arg-type]
                context,
                config=_resource_config(_RESOURCE_A),
            )
        )
        await asyncio.wait_for(store.entered.wait(), timeout=1)
        writer_task = asyncio.create_task(
            record_gpu_backend_token_expiry(
                factory,
                backend_ids[0],
                gpu_resource_id=_RESOURCE_A,
                membership_epoch=1,
                token_expires_at=datetime.now(UTC) + timedelta(minutes=1),
            )
        )
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(asyncio.shield(writer_task), timeout=0.05)

        store.release.set()
        result, _ = await asyncio.gather(recovery_task, writer_task)
        assert result.ready is True
        assert len(store.calls) == 1
    finally:
        store.release.set()
        if recovery_task is not None:
            await asyncio.gather(recovery_task, return_exceptions=True)
        if writer_task is not None:
            await asyncio.gather(writer_task, return_exceptions=True)
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_resource_barrier_blocks_same_card_insert_but_not_other_card(
    test_engine: AsyncEngine,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    same_backend_id = uuid.uuid4()
    other_backend_id = uuid.uuid4()
    all_backend_ids = backend_ids + (same_backend_id, other_backend_id)
    store = _RecordingProofStore(block=True)
    recovery_task: asyncio.Task | None = None
    same_task: asyncio.Task | None = None
    other_task: asyncio.Task | None = None
    try:
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
        )
        context = _fake_context(
            _RESOURCE_A, await _membership_domain(factory, _RESOURCE_A)
        )
        recovery_task = asyncio.create_task(
            commit_gpu_proof_reset_from_health(
                factory,
                store,  # type: ignore[arg-type]
                context,
                config=_resource_config(_RESOURCE_A, _RESOURCE_B),
            )
        )
        await asyncio.wait_for(store.entered.wait(), timeout=1)

        async def insert_backend(backend_id: uuid.UUID, resource_id: str) -> None:
            async with factory.begin() as db:
                db.add(
                    MLBackendRegistry(
                        id=backend_id,
                        name=f"insert-{backend_id}",
                        url=f"http://insert-{backend_id}.test",
                        gpu_resource_id=resource_id,
                        vram_budget_mb=512,
                    )
                )
                await db.flush()

        same_task = asyncio.create_task(insert_backend(same_backend_id, _RESOURCE_A))
        other_task = asyncio.create_task(insert_backend(other_backend_id, _RESOURCE_B))
        await asyncio.wait_for(other_task, timeout=1)
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(asyncio.shield(same_task), timeout=0.05)

        store.release.set()
        await asyncio.gather(recovery_task, same_task)
        assert len(store.calls) == 1
    finally:
        store.release.set()
        for task in (recovery_task, same_task, other_task):
            if task is not None:
                await asyncio.gather(task, return_exceptions=True)
        await _cleanup_backends(factory, all_backend_ids)


@pytest.mark.asyncio
async def test_domain_change_clears_only_prepared_domain_not_ready(
    test_engine: AsyncEngine,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024,),
    )
    store = _RecordingProofStore()
    try:
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset(backend_ids),
        )
        original_domain = await _membership_domain(factory, _RESOURCE_A)
        context = _fake_context(_RESOURCE_A, original_domain)
        async with factory.begin() as db:
            await db.execute(
                update(GPUBackendFence)
                .where(GPUBackendFence.backend_registry_id == backend_ids[0])
                .values(runtime_epoch_high_water=0)
            )
            await db.execute(
                update(MLBackendRegistry)
                .where(MLBackendRegistry.id == backend_ids[0])
                .values(gpu_resource_id=_RESOURCE_B)
            )

        result = await commit_gpu_proof_reset_from_health(
            factory,
            store,  # type: ignore[arg-type]
            context,
            config=_resource_config(_RESOURCE_A, _RESOURCE_B),
        )

        assert result.ready is False
        assert len(store.calls) == 1
        call = store.calls[-1]
        assert call["ready"] is False
        assert call["allocations"] == ()
        assert call["backend_memberships"] == original_domain
        current_old_domain = await _membership_domain(factory, _RESOURCE_A)
        assert current_old_domain[0].state == "retiring"
        assert current_old_domain != original_domain
    finally:
        await _cleanup_backends(factory, backend_ids)


@pytest.mark.asyncio
async def test_redis_gc_receipt_resumes_db_tombstone_and_orphan_fence_finalize(
    test_engine: AsyncEngine,
    proof_store: GPUArbiterStore,
) -> None:
    factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    backend_id = uuid.uuid4()
    resource_id = "node-proof/GPU-gc-receipt"
    async with factory.begin() as db:
        db.add(
            MLBackendRegistry(
                id=backend_id,
                name="gc-receipt",
                url=f"http://gc-receipt-{backend_id}.test",
                gpu_resource_id=resource_id,
                vram_budget_mb=1024,
            )
        )
    async with factory.begin() as db:
        await db.execute(
            update(MLBackendRegistry)
            .where(MLBackendRegistry.id == backend_id)
            .values(gpu_resource_id=None, vram_budget_mb=None)
        )
    async with factory() as db:
        tombstone = await db.get(GPUBackendMembership, (backend_id, resource_id))
    assert tombstone is not None
    assert tombstone.retirement_id is not None
    retirement_id = str(tombstone.retirement_id)
    domain = (
        GPUBackendDomainMember(
            backend_id=str(backend_id),
            membership_epoch=2,
            state="retiring",
        ),
    )
    prepared = await proof_store.begin_proof_reset(
        resource_id,
        2048,
        expected_ledger_revision=None,
        expected_ledger_incarnation=None,
        backend_memberships=domain,
        reset_id="gc-receipt-bootstrap",
    )
    assert prepared.status == "prepared"
    context = await proof_store.prepared_proof_reset(resource_id)
    assert context is not None
    committed = await proof_store.commit_proof_reset(
        resource_id,
        2048,
        reset_id=context.reset_id,
        expected_reset_revision=context.ledger_revision,
        expected_reset_incarnation=context.ledger_incarnation,
        backend_memberships=domain,
        allocations=(
            GPUAllocation(
                backend_id=str(backend_id),
                state=GPUAllocationState.UNKNOWN,
                budget_mb=1024,
                generation=None,
                eviction_priority=0,
                evictable=False,
                max_concurrency=4,
                reservation_lease_id=None,
                reservation_owner_id=None,
                last_used_at_ms=1,
            ),
        ),
        ready=False,
        evidence_deadline_ms=0,
        proof_fingerprint="4" * 64,
    )
    assert committed.status == "not_ready"
    snapshot = await proof_store.snapshot(resource_id)
    staged = await proof_store.collect_retired_backend(
        resource_id,
        expected_ledger_revision=snapshot.ledger_revision,
        expected_ledger_incarnation=snapshot.ledger_incarnation,
        backend_memberships=domain,
        backend_id=str(backend_id),
        membership_epoch=2,
        retirement_id=retirement_id,
        vram_budget_mb=1024,
        evidence_deadline_ms=int(time.time() * 1000) + 120_000,
        evidence_fingerprint="5" * 64,
        collection_id="gc-receipt-stage",
    )
    assert staged.status == "collected"
    collected_snapshot = await proof_store.snapshot(resource_id)
    assert collected_snapshot.backend_ids == ()
    assert collected_snapshot.committed_mb == 0
    receipt = await proof_store.verify_tombstone_gc_receipt(
        resource_id,
        backend_memberships=domain,
        backend_id=str(backend_id),
        membership_epoch=2,
        retirement_id=retirement_id,
    )
    assert receipt is not None

    # Simulate a process crash after Redis, followed by registry deletion.  The
    # next worker must finalize from the exact Redis receipt without frozen health.
    async with factory.begin() as db:
        await db.execute(
            delete(MLBackendRegistry).where(MLBackendRegistry.id == backend_id)
        )
    receipt_after_registry_delete = await proof_store.verify_tombstone_gc_receipt(
        resource_id,
        backend_memberships=domain,
        backend_id=str(backend_id),
        membership_epoch=2,
        retirement_id=retirement_id,
    )
    assert receipt_after_registry_delete is not None
    async with factory() as db:
        locked_tombstone = await db.get(GPUBackendMembership, (backend_id, resource_id))
    assert locked_tombstone is not None
    assert str(locked_tombstone.retirement_id) == retirement_id
    finalized = await collect_gpu_backend_tombstone(
        factory,
        proof_store,
        backend_id,
        resource_id,
        2,
        proof=None,
    )
    assert finalized.status == "collected", finalized
    assert finalized.reason == "redis_receipt_finalized"
    assert finalized.redis_idempotent is True
    async with factory() as db:
        assert await db.get(GPUBackendMembership, (backend_id, resource_id)) is None
        assert await db.get(GPUBackendFence, backend_id) is None


@pytest.mark.asyncio
async def test_repair_bootstraps_missing_card_then_leaves_ready_card_read_only(
    test_engine: AsyncEngine,
    proof_store: GPUArbiterStore,
) -> None:
    factory, backend_ids = await _create_active_backends(
        test_engine,
        resource_id=_RESOURCE_A,
        budgets=(1024, 2048),
    )
    try:
        await _install_live_health(
            factory,
            backend_ids,
            resource_id=_RESOURCE_A,
            resident_backend_ids=frozenset({backend_ids[1]}),
        )
        first = await repair_gpu_resource(
            factory,
            proof_store,
            _RESOURCE_A,
            8192,
            config=_resource_config(_RESOURCE_A),
        )
        assert first.action == "bootstrap"
        assert first.ready is True
        snapshot = await proof_store.snapshot(_RESOURCE_A)
        assert snapshot.ready is True
        assert snapshot.committed_mb == 2048
        assert tuple(item.state for item in snapshot.allocations) == (
            GPUAllocationState.RESIDENT,
        )

        second = await repair_gpu_resource(
            factory,
            proof_store,
            _RESOURCE_A,
            8192,
            config=_resource_config(_RESOURCE_A),
        )
        assert second.action == "already_ready"
        assert second.ledger_revision == snapshot.ledger_revision
    finally:
        await _cleanup_backends(factory, backend_ids)
