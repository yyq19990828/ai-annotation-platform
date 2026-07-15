from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import replace
import hashlib
import json
import os
import time
import uuid

import pytest
from redis.asyncio import Redis
from redis.cluster import key_slot

from app.services import gpu_arbiter_store as gpu_arbiter_store_module
from app.config import settings
from app.services.gpu_arbiter_store import (
    GPUAllocation,
    GPUAllocationState,
    GPUArbiterStore,
    GPUArbiterStoreError,
    GPUReconcileLeaseCleanup,
    GPURequestLeaseState,
    gpu_arbiter_keys,
    normalize_gpu_backend_max_concurrency,
)


_TEST_BACKEND_DOMAIN = (
    "backend-a",
    "backend-b",
    "backend-c",
    "backend-missing",
)


def _future_reconcile_deadline_ms(window_ms: int = 120_000) -> int:
    return int(time.time() * 1000) + window_ms


def _redis_url() -> str:
    return os.environ.get("TEST_REDIS_URL", settings.redis_url)


async def _clean_namespace(redis_url: str, namespace: str) -> None:
    client = Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
        retry_on_timeout=False,
    )
    try:
        async with asyncio.timeout(5):
            batch: list[str] = []
            async for key in client.scan_iter(match=f"{namespace}:*"):
                batch.append(key)
                if len(batch) >= 100:
                    await client.unlink(*batch)
                    batch.clear()
            if batch:
                await client.unlink(*batch)
    finally:
        async with asyncio.timeout(2):
            await client.aclose()


@pytest.fixture
async def redis_stores() -> AsyncIterator[tuple[GPUArbiterStore, GPUArbiterStore]]:
    redis_url = _redis_url()
    namespace = f"gpu-arbiter-test:{uuid.uuid4().hex}"
    first = GPUArbiterStore.from_url(redis_url, namespace=namespace)
    second = GPUArbiterStore.from_url(redis_url, namespace=namespace)
    try:
        assert await first.ping() is True
        assert await second.ping() is True
        yield first, second
    finally:
        close_results = await asyncio.gather(
            first.aclose(), second.aclose(), return_exceptions=True
        )
        await _clean_namespace(redis_url, namespace)
        for result in close_results:
            if isinstance(result, BaseException):
                raise result


def _admission_kwargs(
    backend_id: str,
    lease_id: str,
    *,
    budget_mb: int = 60,
    generation: str = "1",
    max_concurrency: int = 4,
    owner_id: str = "owner-a",
) -> dict:
    return {
        "backend_id": backend_id,
        "budget_mb": budget_mb,
        "generation": generation,
        "eviction_priority": 0,
        "evictable": True,
        "max_concurrency": max_concurrency,
        "lease_id": lease_id,
        "owner_id": owner_id,
        "operation": "predict",
        "heartbeat_ttl_ms": 5_000,
        "hard_ttl_ms": 30_000,
    }


async def _admit_resident(
    store: GPUArbiterStore,
    resource_id: str,
    *,
    backend_id: str = "backend-a",
    lease_id: str = "lease-a",
    owner_id: str = "owner-a",
    generation: str = "1",
    budget_mb: int = 60,
    max_concurrency: int = 4,
) -> None:
    assert (
        await store.admit(
            resource_id,
            **_admission_kwargs(
                backend_id,
                lease_id,
                owner_id=owner_id,
                generation=generation,
                budget_mb=budget_mb,
                max_concurrency=max_concurrency,
            ),
        )
    ).admitted
    for state in (GPUAllocationState.LOADING, GPUAllocationState.RESIDENT):
        assert (
            await store.transition_allocation(
                resource_id,
                backend_id=backend_id,
                expected_generation=generation,
                target_state=state,
                request_lease_id=lease_id,
                request_owner_id=owner_id,
            )
        ).status == "transitioned"


async def _bootstrap_empty_card(
    store: GPUArbiterStore,
    resource_id: str,
    allocatable_mb: int,
) -> None:
    result = await store.reconcile_card(
        resource_id,
        allocatable_mb,
        expected_ledger_revision=None,
        expected_ledger_incarnation=None,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=(),
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id=f"test-bootstrap-{uuid.uuid4().hex}",
    )
    assert result.status == "reconciled"
    assert result.ready is True


def _reconcile_allocation(
    *,
    backend_id: str = "backend-a",
    state: GPUAllocationState = GPUAllocationState.UNKNOWN,
    generation: str = "1",
    budget_mb: int = 60,
    last_used_at_ms: int = 1,
) -> GPUAllocation:
    return GPUAllocation(
        backend_id=backend_id,
        state=state,
        budget_mb=budget_mb,
        generation=generation,
        eviction_priority=0,
        evictable=False,
        max_concurrency=4,
        reservation_lease_id=None,
        reservation_owner_id=None,
        last_used_at_ms=last_used_at_ms,
    )


def test_resource_keys_share_one_brace_safe_cluster_slot() -> None:
    keys = gpu_arbiter_keys(
        "node-{tenant-a}/index:0", namespace="gpu-arbiter-test:key-codec"
    )
    same_resource = {
        keys.card,
        keys.allocations,
        keys.queue,
        keys.transition,
        keys.backend_queue("backend-a"),
        keys.leases("backend-a"),
    }
    assert len({key_slot(key.encode()) for key in same_resource}) == 1
    assert "node-{tenant-a}" not in keys.card

    other = gpu_arbiter_keys(
        "node-{tenant-b}/index:0", namespace="gpu-arbiter-test:key-codec"
    )
    assert key_slot(other.card.encode()) != key_slot(keys.card.encode())


@pytest.mark.asyncio
async def test_reconcile_bootstrap_is_atomic_and_retry_idempotent(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    allocation = _reconcile_allocation()
    kwargs = {
        "expected_ledger_revision": None,
        "expected_ledger_incarnation": None,
        "backend_ids": ("backend-a",),
        "allocations": (allocation,),
        "lease_cleanup": None,
        "ready": True,
        "reconcile_deadline_ms": _future_reconcile_deadline_ms(),
        "repair_id": "bootstrap-1",
    }

    created = await first.reconcile_card(resource_id, 100, **kwargs)
    assert created.status == "reconciled"
    assert created.ready is True
    assert created.committed_mb == 60
    assert created.idempotent is False

    snapshot = await first.snapshot(resource_id)
    assert snapshot.ready is True
    assert snapshot.committed_mb == 60
    assert snapshot.allocations == (allocation,)

    retried = await first.reconcile_card(resource_id, 100, **kwargs)
    assert retried.status == "reconciled"
    assert retried.idempotent is True
    assert retried.ledger_revision == created.ledger_revision
    assert (await first.snapshot(resource_id)).reconcile_deadline_ms == (
        snapshot.reconcile_deadline_ms
    )


@pytest.mark.asyncio
async def test_normal_repair_exact_retry_is_read_only_and_idempotent(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-normal-repair/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    before = await first.snapshot(resource_id)
    kwargs = {
        "expected_ledger_revision": before.ledger_revision,
        "expected_ledger_incarnation": before.ledger_incarnation,
        "backend_ids": _TEST_BACKEND_DOMAIN,
        "allocations": before.allocations,
        "lease_cleanup": None,
        "ready": True,
        "reconcile_deadline_ms": _future_reconcile_deadline_ms(),
        "repair_id": "normal-repair-1",
    }

    created = await first.reconcile_card(resource_id, 100, **kwargs)
    assert created.status == "reconciled"
    assert created.idempotent is False
    committed = await first.snapshot(resource_id)

    retried = await first.reconcile_card(resource_id, 100, **kwargs)
    assert retried.status == "reconciled"
    assert retried.idempotent is True
    assert retried.ledger_revision == created.ledger_revision
    assert retried.ledger_incarnation == created.ledger_incarnation
    after = await first.snapshot(resource_id)
    assert after.ledger_revision == committed.ledger_revision
    assert after.reconcile_deadline_ms == committed.reconcile_deadline_ms


@pytest.mark.asyncio
async def test_full_flush_revision_aba_is_fenced_by_incarnation(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-full-flush-aba/index:0"
    allocation = _reconcile_allocation()
    first_bootstrap = await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=None,
        expected_ledger_incarnation=None,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=(allocation,),
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id="old-bootstrap",
    )
    old_snapshot = await first.snapshot(resource_id)
    old_target = replace(old_snapshot.allocations[0], state=GPUAllocationState.UNLOADED)
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.delete(
            keys.card,
            keys.allocations,
            keys.queue,
            keys.transition,
            *(
                key
                for backend_id in _TEST_BACKEND_DOMAIN
                for key in (
                    keys.leases(backend_id),
                    keys.backend_queue(backend_id),
                )
            ),
        )
        replacement = await first.reconcile_card(
            resource_id,
            100,
            expected_ledger_revision=None,
            expected_ledger_incarnation=None,
            backend_ids=_TEST_BACKEND_DOMAIN,
            allocations=(allocation,),
            lease_cleanup=None,
            ready=True,
            reconcile_deadline_ms=_future_reconcile_deadline_ms(),
            repair_id="new-bootstrap",
        )
        assert replacement.ledger_revision == first_bootstrap.ledger_revision
        assert replacement.ledger_incarnation != first_bootstrap.ledger_incarnation

        stale = await first.reconcile_card(
            resource_id,
            100,
            expected_ledger_revision=old_snapshot.ledger_revision,
            expected_ledger_incarnation=old_snapshot.ledger_incarnation,
            backend_ids=_TEST_BACKEND_DOMAIN,
            allocations=(old_target,),
            lease_cleanup=None,
            ready=True,
            reconcile_deadline_ms=_future_reconcile_deadline_ms(),
            repair_id="delayed-old-repair",
        )
        assert stale.status == "stale_revision"
        assert stale.reason == "ledger_incarnation_changed"
        current = await first.snapshot(resource_id)
        assert current.ledger_incarnation == replacement.ledger_incarnation
        assert current.committed_mb == 60
        assert current.allocations[0].state is GPUAllocationState.UNKNOWN
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_partial_flush_state_cannot_be_bootstrapped_over(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.hset(keys.leases("backend-a"), "orphan", "{}")
        result = await first.reconcile_card(
            resource_id,
            100,
            expected_ledger_revision=None,
            expected_ledger_incarnation=None,
            backend_ids=("backend-a",),
            allocations=(_reconcile_allocation(),),
            lease_cleanup=None,
            ready=True,
            reconcile_deadline_ms=_future_reconcile_deadline_ms(),
            repair_id="partial-flush",
        )
        assert result.status == "partial_state"
        assert await raw.exists(keys.card) == 0
        assert await raw.hget(keys.leases("backend-a"), "orphan") == "{}"
    finally:
        await raw.aclose()


@pytest.mark.parametrize(
    "corruption",
    (
        "allocations",
        "leases",
        "backend_queue",
        "transition",
        "deadline",
        "revision",
        "revision_zero",
    ),
)
@pytest.mark.parametrize("entry", ("admit", "enqueue", "transition_owner"))
@pytest.mark.asyncio
async def test_ready_card_integrity_loss_blocks_every_new_work_entry(
    redis_stores,
    corruption: str,
    entry: str,
) -> None:
    first, _ = redis_stores
    resource_id = f"node-{corruption}-{entry}/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)
    keys = first.keys(resource_id)

    if corruption == "backend_queue":
        assert (
            await first.enqueue_backend(
                resource_id,
                backend_id="backend-b",
                ticket_id="existing-ticket",
                owner_id="existing-owner",
                ttl_ms=30_000,
            )
        ).status == "queued"
    elif corruption == "transition":
        assert (
            await first.acquire_transition_owner(
                resource_id,
                backend_id="backend-a",
                owner_id="existing-transition-owner",
                generation="2",
                operation="evict",
                ttl_ms=30_000,
            )
        ).status == "acquired"

    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        if corruption == "allocations":
            await raw.delete(keys.allocations)
        elif corruption == "leases":
            await raw.delete(keys.leases("backend-a"))
        elif corruption == "backend_queue":
            await raw.delete(keys.backend_queue("backend-b"))
        elif corruption == "transition":
            await raw.delete(keys.transition)
        elif corruption == "deadline":
            await raw.hset(
                keys.card,
                "reconcile_deadline_ms",
                str(9_007_199_254_740_992),
            )
        elif corruption == "revision":
            await raw.hdel(keys.card, "ledger_revision")
        else:
            await raw.hset(keys.card, "ledger_revision", "0")

        children_before = (
            await raw.hgetall(keys.allocations),
            await raw.hgetall(keys.leases("backend-a")),
            await raw.lrange(keys.queue, 0, -1),
            await raw.lrange(keys.backend_queue("backend-b"), 0, -1),
            await raw.get(keys.transition),
        )
        if entry == "admit":
            result = await first.admit(
                resource_id,
                **_admission_kwargs(
                    "backend-b",
                    "new-lease",
                    budget_mb=40,
                    owner_id="new-owner",
                ),
            )
        elif entry == "enqueue":
            result = await first.enqueue_card(
                resource_id,
                backend_id="backend-b",
                ticket_id="new-ticket",
                owner_id="new-owner",
                ttl_ms=30_000,
            )
        else:
            result = await first.acquire_transition_owner(
                resource_id,
                backend_id="backend-a",
                owner_id="new-transition-owner",
                generation="2",
                operation="evict",
                ttl_ms=30_000,
            )

        assert result.status == "ledger_corrupt"
        assert await raw.hget(keys.card, "bootstrap_state") == "not_ready"
        assert (
            await raw.hgetall(keys.allocations),
            await raw.hgetall(keys.leases("backend-a")),
            await raw.lrange(keys.queue, 0, -1),
            await raw.lrange(keys.backend_queue("backend-b"), 0, -1),
            await raw.get(keys.transition),
        ) == children_before
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_missing_revision_blocks_cleanup_and_state_mutations(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-missing-revision-cleanup/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)
    assert (
        await first.enqueue_backend(
            resource_id,
            backend_id="backend-b",
            ticket_id="existing-ticket",
            owner_id="existing-owner",
            ttl_ms=30_000,
        )
    ).status == "queued"
    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="existing-transition-owner",
            generation="2",
            operation="evict",
            ttl_ms=30_000,
        )
    ).status == "acquired"

    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.hdel(keys.card, "ledger_revision")
        children_before = (
            await raw.hgetall(keys.allocations),
            await raw.hgetall(keys.leases("backend-a")),
            await raw.lrange(keys.backend_queue("backend-b"), 0, -1),
            await raw.get(keys.transition),
        )

        assert (
            await first.heartbeat_lease(
                resource_id,
                backend_id="backend-a",
                lease_id="lease-a",
                owner_id="owner-a",
                generation="1",
                heartbeat_ttl_ms=5_000,
            )
        ).status == "not_ready"
        assert await first.sweep_expired_leases(
            resource_id, backend_id="backend-a"
        ) == (0, 0)
        assert (
            await first.queue_position(
                resource_id,
                backend_id="backend-b",
                ticket_id="existing-ticket",
                card_queue=False,
            )
        ).status == "ledger_corrupt"
        assert (
            await first.heartbeat_transition_owner(
                resource_id,
                backend_id="backend-a",
                owner_id="existing-transition-owner",
                generation="2",
                operation="evict",
                ttl_ms=5_000,
            )
        ).status == "ledger_corrupt"
        assert (
            await first.transition_allocation(
                resource_id,
                backend_id="backend-a",
                expected_generation="1",
                target_state=GPUAllocationState.DRAINING,
                next_generation="2",
                transition_owner_id="existing-transition-owner",
                transition_operation="evict",
            )
        ).status == "ledger_corrupt"
        assert (
            await raw.hgetall(keys.allocations),
            await raw.hgetall(keys.leases("backend-a")),
            await raw.lrange(keys.backend_queue("backend-b"), 0, -1),
            await raw.get(keys.transition),
        ) == children_before
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_expired_idempotent_repair_cannot_reopen_readiness(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-expired-repair/index:0"
    kwargs = {
        "expected_ledger_revision": None,
        "expected_ledger_incarnation": None,
        "backend_ids": _TEST_BACKEND_DOMAIN,
        "allocations": (),
        "lease_cleanup": None,
        "ready": True,
        "reconcile_deadline_ms": _future_reconcile_deadline_ms(100),
        "repair_id": "expiring-repair",
    }
    created = await first.reconcile_card(resource_id, 100, **kwargs)
    assert created.status == "reconciled"
    snapshot = await first.snapshot(resource_id)

    await asyncio.sleep(0.12)
    retried = await first.reconcile_card(resource_id, 100, **kwargs)

    assert retried.status == "not_ready"
    assert retried.ready is False
    assert retried.idempotent is True
    assert retried.ledger_revision == created.ledger_revision
    expired = await first.snapshot(resource_id)
    assert expired.ready is False
    assert expired.reconcile_deadline_ms == snapshot.reconcile_deadline_ms


@pytest.mark.asyncio
async def test_expired_reconcile_deadline_stops_new_work_and_queueing(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    result = await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=None,
        expected_ledger_incarnation=None,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=(),
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(10),
        repair_id="short-readiness",
    )
    assert result.ready is True
    await asyncio.sleep(0.02)

    assert (await first.snapshot(resource_id)).ready is False
    admission = await first.admit(
        resource_id,
        **_admission_kwargs("backend-a", "lease-after-expiry"),
    )
    assert admission.status == "not_ready"
    assert admission.reason == "reconcile_expired"
    assert (
        await first.enqueue_backend(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-after-expiry",
            owner_id="owner-a",
            ttl_ms=30_000,
        )
    ).status == "not_ready"


@pytest.mark.parametrize("card_queue", (False, True))
@pytest.mark.asyncio
async def test_expired_queue_ticket_does_not_block_reconcile(
    redis_stores,
    card_queue: bool,
) -> None:
    first, _ = redis_stores
    resource_id = f"node-expired-{'card' if card_queue else 'backend'}-queue/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    enqueue = first.enqueue_card if card_queue else first.enqueue_backend
    assert (
        await enqueue(
            resource_id,
            backend_id="backend-a",
            ticket_id="expired-ticket",
            owner_id="owner-a",
            ttl_ms=10,
        )
    ).status == "queued"
    await asyncio.sleep(0.03)
    before = await first.snapshot(resource_id)

    repaired = await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=before.ledger_revision,
        expected_ledger_incarnation=before.ledger_incarnation,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=before.allocations,
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id=f"clear-expired-{'card' if card_queue else 'backend'}-queue",
    )
    assert repaired.status == "reconciled"
    assert repaired.ready is True
    assert (
        await first.queue_position(
            resource_id,
            backend_id="backend-a",
            ticket_id="expired-ticket",
            card_queue=card_queue,
        )
    ).status == "missing"


@pytest.mark.asyncio
async def test_busy_reconcile_reports_expired_card_as_not_ready(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-expired-busy/index:0"
    bootstrap = await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=None,
        expected_ledger_incarnation=None,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=(),
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(10),
        repair_id="short-busy-readiness",
    )
    assert bootstrap.ready is True
    assert (
        await first.enqueue_backend(
            resource_id,
            backend_id="backend-a",
            ticket_id="live-ticket",
            owner_id="owner-a",
            ttl_ms=30_000,
        )
    ).status == "queued"
    await asyncio.sleep(0.02)
    before = await first.snapshot(resource_id)

    busy = await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=before.ledger_revision,
        expected_ledger_incarnation=before.ledger_incarnation,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=before.allocations,
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id="busy-after-expiry",
    )
    assert busy.status == "busy"
    assert busy.ready is False


@pytest.mark.asyncio
async def test_stale_incarnation_new_work_context_does_not_latch_replacement(
    redis_stores,
    monkeypatch,
) -> None:
    first, _ = redis_stores
    resource_id = "node-stale-context/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    old_context = await first._ledger_domain(first.keys(resource_id))
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.delete(
            keys.card,
            keys.allocations,
            keys.queue,
            keys.transition,
            *(
                key
                for backend_id in _TEST_BACKEND_DOMAIN
                for key in (
                    keys.leases(backend_id),
                    keys.backend_queue(backend_id),
                )
            ),
        )
        replacement = await first.reconcile_card(
            resource_id,
            100,
            expected_ledger_revision=None,
            expected_ledger_incarnation=None,
            backend_ids=_TEST_BACKEND_DOMAIN,
            allocations=(),
            lease_cleanup=None,
            ready=True,
            reconcile_deadline_ms=_future_reconcile_deadline_ms(),
            repair_id="replacement-bootstrap",
        )

        async def stale_context(_keys):
            return old_context

        monkeypatch.setattr(first, "_ledger_domain", stale_context)
        rejected = await first.admit(
            resource_id,
            **_admission_kwargs("backend-a", "stale-context-lease"),
        )
        assert rejected.status == "not_ready"
        assert await raw.hget(keys.card, "bootstrap_state") == "ready"
        assert await raw.hget(keys.card, "ledger_incarnation") == (
            replacement.ledger_incarnation
        )
        assert await raw.hlen(keys.allocations) == 0
        assert await raw.hlen(keys.leases("backend-a")) == 0
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_reconcile_revision_cas_cannot_overwrite_a_new_admission(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    stale_snapshot = await first.snapshot(resource_id)
    assert (
        await second.admit(
            resource_id,
            **_admission_kwargs("backend-a", "lease-a"),
        )
    ).admitted

    stale_repair = await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=stale_snapshot.ledger_revision,
        expected_ledger_incarnation=stale_snapshot.ledger_incarnation,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=stale_snapshot.allocations,
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id="stale-repair",
    )
    assert stale_repair.status == "stale_revision"
    current = await second.snapshot(resource_id)
    assert len(current.allocations) == 1
    assert current.allocations[0].state is GPUAllocationState.RESERVING
    assert len(current.leases) == 1


@pytest.mark.asyncio
async def test_reconcile_only_purges_stale_lease_after_hard_deadline(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        lease_raw = await raw.hget(keys.leases("backend-a"), "lease-a")
        lease = json.loads(lease_raw)
        lease["state"] = "stale"
        await raw.hset(
            keys.leases("backend-a"),
            "lease-a",
            json.dumps(lease),
        )
        before = await first.snapshot(resource_id)
        target = replace(
            before.allocations[0],
            state=GPUAllocationState.UNLOADED,
            reservation_lease_id=None,
            reservation_owner_id=None,
        )
        redis_time = await raw.time()
        now_ms = (int(redis_time[0]) * 1000) + (int(redis_time[1]) // 1000)
        cleanup = {
            "backend-a": GPUReconcileLeaseCleanup(
                observed_idle_at_ms=now_ms,
                lease_ids=("lease-a",),
            )
        }

        rejected = await first.reconcile_card(
            resource_id,
            100,
            expected_ledger_revision=before.ledger_revision,
            expected_ledger_incarnation=before.ledger_incarnation,
            backend_ids=_TEST_BACKEND_DOMAIN,
            allocations=(target,),
            lease_cleanup=cleanup,
            ready=True,
            reconcile_deadline_ms=_future_reconcile_deadline_ms(),
            repair_id="lease-too-young",
        )
        assert rejected.status == "active_leases"
        assert len((await first.snapshot(resource_id)).leases) == 1

        lease["heartbeat_deadline_ms"] = lease["created_at_ms"]
        lease["hard_deadline_ms"] = lease["created_at_ms"]
        await raw.hset(
            keys.leases("backend-a"),
            "lease-a",
            json.dumps(lease),
        )
        redis_time = await raw.time()
        observed_idle_at_ms = (int(redis_time[0]) * 1000) + (int(redis_time[1]) // 1000)
        repaired = await first.reconcile_card(
            resource_id,
            100,
            expected_ledger_revision=before.ledger_revision,
            expected_ledger_incarnation=before.ledger_incarnation,
            backend_ids=_TEST_BACKEND_DOMAIN,
            allocations=(target,),
            lease_cleanup={
                "backend-a": GPUReconcileLeaseCleanup(
                    observed_idle_at_ms=observed_idle_at_ms,
                    lease_ids=("lease-a",),
                )
            },
            ready=True,
            reconcile_deadline_ms=_future_reconcile_deadline_ms(),
            repair_id="lease-expired",
        )
        assert repaired.status == "reconciled"
        assert repaired.purged_leases == 1
        assert repaired.committed_mb == 0
        snapshot = await first.snapshot(resource_id)
        assert snapshot.allocations[0].state is GPUAllocationState.UNLOADED
        assert snapshot.leases == ()
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_missing_or_not_ready_card_fails_closed(redis_stores) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"

    missing = await first.admit(
        resource_id, **_admission_kwargs("backend-a", "lease-missing")
    )
    assert missing.status == "not_ready"

    with pytest.raises(ValueError, match="reconcile_card"):
        await first.configure_card(resource_id, 100, ready=True)

    await first.configure_card(resource_id, 100, ready=False)
    rebuilding = await first.admit(
        resource_id, **_admission_kwargs("backend-a", "lease-rebuilding")
    )
    assert rebuilding.status == "not_ready"


@pytest.mark.asyncio
async def test_two_independent_clients_cannot_oversell_capacity(redis_stores) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)

    first_result, second_result = await asyncio.gather(
        first.admit(resource_id, **_admission_kwargs("backend-a", "lease-a")),
        second.admit(
            resource_id,
            **_admission_kwargs("backend-b", "lease-b", owner_id="owner-b"),
        ),
    )

    assert sorted([first_result.status, second_result.status]) == [
        "admitted",
        "capacity_unavailable",
    ]
    snapshot = await first.snapshot(resource_id)
    assert snapshot.committed_mb == 60
    assert len(snapshot.allocations) == 1
    assert len(snapshot.leases) == 1
    assert snapshot.committed_mb <= snapshot.allocatable_mb


@pytest.mark.asyncio
async def test_exact_capacity_is_allowed_and_cached_counter_cannot_oversell(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.admit(
            resource_id,
            **_admission_kwargs("backend-a", "lease-a", budget_mb=61),
        )
    ).admitted

    exact = await second.admit(
        resource_id,
        **_admission_kwargs("backend-b", "lease-b", budget_mb=39, owner_id="owner-b"),
    )
    assert exact.admitted
    one_mb_over = await first.admit(
        resource_id,
        **_admission_kwargs("backend-c", "lease-c", budget_mb=1, owner_id="owner-c"),
    )
    assert one_mb_over.status == "capacity_unavailable"
    assert one_mb_over.committed_mb == 100
    assert (await first.snapshot(resource_id)).committed_mb == 100

    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.hset(first.keys(resource_id).card, "committed_mb", "0")
    finally:
        await raw.aclose()
    drifted = await second.admit(
        resource_id,
        **_admission_kwargs(
            "backend-c", "lease-drift", budget_mb=1, owner_id="owner-c"
        ),
    )
    assert drifted.status == "ledger_corrupt"
    assert drifted.reason == "allocation_cache_drift"


@pytest.mark.asyncio
async def test_allocation_and_global_backend_lease_are_atomic(redis_stores) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)

    results = await asyncio.gather(
        *(
            (first if index % 2 == 0 else second).admit(
                resource_id,
                **_admission_kwargs(
                    "backend-a",
                    f"lease-{index}",
                    max_concurrency=2,
                    owner_id=f"owner-{index}",
                ),
            )
            for index in range(8)
        )
    )

    assert sum(result.admitted for result in results) == 2
    assert sum(result.status == "concurrency_saturated" for result in results) == 6
    snapshot = await first.snapshot(resource_id)
    assert snapshot.committed_mb == 60
    assert len(snapshot.allocations) == 1
    assert len(snapshot.leases) == 2

    admitted = next(result for result in results if result.admitted)
    lease_index = results.index(admitted)
    repeated = await second.admit(
        resource_id,
        **_admission_kwargs(
            "backend-a",
            f"lease-{lease_index}",
            max_concurrency=2,
            owner_id=f"owner-{lease_index}",
        ),
    )
    assert repeated.admitted is True
    assert repeated.idempotent is True
    assert repeated.lease_count == 2


@pytest.mark.asyncio
async def test_backend_fifo_prevents_new_requests_bypassing_waiters(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(
        first,
        resource_id,
        lease_id="lease-initial",
        max_concurrency=1,
    )

    ticket_one = await first.enqueue_backend(
        resource_id,
        backend_id="backend-a",
        ticket_id="ticket-1",
        owner_id="waiter-1",
        ttl_ms=30_000,
    )
    ticket_two = await second.enqueue_backend(
        resource_id,
        backend_id="backend-a",
        ticket_id="ticket-2",
        owner_id="waiter-2",
        ttl_ms=30_000,
    )
    assert (ticket_one.position, ticket_two.position) == (1, 2)

    released = await first.release_lease(
        resource_id,
        backend_id="backend-a",
        lease_id="lease-initial",
        owner_id="owner-a",
        generation="1",
    )
    assert released.status == "released"

    bypass = await second.admit(
        resource_id,
        **_admission_kwargs(
            "backend-a", "lease-bypass", max_concurrency=1, owner_id="bypass"
        ),
    )
    assert bypass.status == "concurrency_queued"

    first_waiter = await second.admit(
        resource_id,
        backend_ticket_id="ticket-1",
        **_admission_kwargs(
            "backend-a", "lease-waiter-1", max_concurrency=1, owner_id="waiter-1"
        ),
    )
    assert first_waiter.admitted
    assert (
        await first.queue_position(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-2",
            card_queue=False,
        )
    ).position == 1
    assert (
        await first.cancel_queue_ticket(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-2",
            owner_id="waiter-2",
            card_queue=False,
        )
    ).status == "cancelled"


@pytest.mark.asyncio
async def test_queue_ticket_and_transition_owner_require_exact_owner(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await first.enqueue_backend(
        resource_id,
        backend_id="backend-a",
        ticket_id="ticket-a",
        owner_id="queue-owner",
        ttl_ms=30_000,
    )
    wrong_queue_owner = await second.cancel_queue_ticket(
        resource_id,
        backend_id="backend-a",
        ticket_id="ticket-a",
        owner_id="other-owner",
        card_queue=False,
    )
    assert wrong_queue_owner.status == "owner_mismatch"
    assert (
        await first.queue_position(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-a",
            card_queue=False,
        )
    ).position == 1
    assert (
        await first.cancel_queue_ticket(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-a",
            owner_id="queue-owner",
            card_queue=False,
        )
    ).status == "cancelled"

    await first.enqueue_card(
        resource_id,
        backend_id="backend-a",
        ticket_id="card-ticket",
        owner_id="queue-owner",
        ttl_ms=30_000,
    )
    wrong_card_backend = await second.cancel_queue_ticket(
        resource_id,
        backend_id="backend-b",
        ticket_id="card-ticket",
        owner_id="queue-owner",
        card_queue=True,
    )
    assert wrong_card_backend.status == "ticket_conflict"
    assert (
        await second.queue_position(
            resource_id,
            backend_id="backend-b",
            ticket_id="card-ticket",
            card_queue=True,
        )
    ).status == "ticket_conflict"
    assert (
        await first.queue_position(
            resource_id,
            backend_id="backend-a",
            ticket_id="card-ticket",
            card_queue=True,
        )
    ).position == 1
    assert (
        await first.cancel_queue_ticket(
            resource_id,
            backend_id="backend-a",
            ticket_id="card-ticket",
            owner_id="queue-owner",
            card_queue=True,
        )
    ).status == "cancelled"

    await _admit_resident(
        first,
        resource_id,
        backend_id="backend-a",
        lease_id="lease-a",
        owner_id="owner-a",
        budget_mb=50,
    )
    await _admit_resident(
        second,
        resource_id,
        backend_id="backend-b",
        lease_id="lease-b",
        owner_id="owner-b",
        budget_mb=50,
    )
    for store, backend_id, lease_id, owner_id in (
        (first, "backend-a", "lease-a", "owner-a"),
        (second, "backend-b", "lease-b", "owner-b"),
    ):
        assert (
            await store.release_lease(
                resource_id,
                backend_id=backend_id,
                lease_id=lease_id,
                owner_id=owner_id,
                generation="1",
            )
        ).status == "released"

    acquired = await first.acquire_transition_owner(
        resource_id,
        backend_id="backend-a",
        owner_id="transition-owner",
        generation="2",
        operation="drain",
        ttl_ms=30,
    )
    assert acquired.status == "acquired"
    assert acquired.idempotent is False
    repeated = await second.acquire_transition_owner(
        resource_id,
        backend_id="backend-a",
        owner_id="transition-owner",
        generation="2",
        operation="drain",
        ttl_ms=30,
    )
    assert repeated.status == "acquired"
    assert repeated.idempotent is True
    blocked = await second.acquire_transition_owner(
        resource_id,
        backend_id="backend-b",
        owner_id="other-owner",
        generation="1",
        operation="drain",
        ttl_ms=30,
    )
    assert blocked.status == "busy"
    wrong_release = await second.release_transition_owner(
        resource_id,
        backend_id="backend-a",
        owner_id="other-owner",
        generation="2",
        operation="drain",
    )
    assert wrong_release.status == "owner_mismatch"

    deadline = asyncio.get_running_loop().time() + 1
    while True:
        takeover = await second.acquire_transition_owner(
            resource_id,
            backend_id="backend-b",
            owner_id="other-owner",
            generation="3",
            operation="drain",
            ttl_ms=30,
        )
        if takeover.status == "acquired":
            break
        assert takeover.status == "busy"
        if asyncio.get_running_loop().time() >= deadline:
            pytest.fail("transition owner did not expire")
        await asyncio.sleep(0.005)
    assert takeover.status == "acquired"
    late_release = await first.release_transition_owner(
        resource_id,
        backend_id="backend-a",
        owner_id="transition-owner",
        generation="2",
        operation="drain",
    )
    assert late_release.status == "owner_mismatch"


@pytest.mark.asyncio
async def test_uncertain_and_stale_lease_remain_counted_until_owned_release(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    kwargs = _admission_kwargs(
        "backend-a", "lease-a", max_concurrency=1, owner_id="owner-a"
    )
    kwargs["heartbeat_ttl_ms"] = 20
    kwargs["hard_ttl_ms"] = 40
    assert (await first.admit(resource_id, **kwargs)).admitted

    wrong_owner = await first.mark_lease_uncertain(
        resource_id,
        backend_id="backend-a",
        lease_id="lease-a",
        owner_id="owner-b",
        generation="1",
    )
    assert wrong_owner.status == "owner_mismatch"
    uncertain = await first.mark_lease_uncertain(
        resource_id,
        backend_id="backend-a",
        lease_id="lease-a",
        owner_id="owner-a",
        generation="1",
    )
    assert uncertain.lease_state is GPURequestLeaseState.UNCERTAIN

    deadline = asyncio.get_running_loop().time() + 1
    while True:
        changed, total = await first.sweep_expired_leases(
            resource_id, backend_id="backend-a"
        )
        if changed:
            break
        if asyncio.get_running_loop().time() >= deadline:
            pytest.fail("uncertain lease did not become stale")
        await asyncio.sleep(0.005)
    assert (changed, total) == (1, 1)
    snapshot = await first.snapshot(resource_id)
    assert snapshot.leases[0].state is GPURequestLeaseState.STALE
    assert snapshot.committed_mb == 60

    blocked = await first.admit(
        resource_id,
        **_admission_kwargs(
            "backend-a", "lease-b", max_concurrency=1, owner_id="owner-b"
        ),
    )
    assert blocked.status == "concurrency_saturated"

    reservation_guard = await first.release_lease(
        resource_id,
        backend_id="backend-a",
        lease_id="lease-a",
        owner_id="owner-a",
        generation="1",
    )
    assert reservation_guard.status == "reservation_active"
    assert (
        await first.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation="1",
            target_state=GPUAllocationState.UNKNOWN,
            request_lease_id="lease-a",
            request_owner_id="owner-a",
        )
    ).status == "transitioned"
    released = await first.release_lease(
        resource_id,
        backend_id="backend-a",
        lease_id="lease-a",
        owner_id="owner-a",
        generation="1",
    )
    assert released.status == "released"
    repeated = await first.release_lease(
        resource_id,
        backend_id="backend-a",
        lease_id="lease-a",
        owner_id="owner-a",
        generation="1",
    )
    assert repeated.status == "missing"


@pytest.mark.asyncio
async def test_generation_cas_and_active_lease_guard_transitions(redis_stores) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.admit(resource_id, **_admission_kwargs("backend-a", "lease-a"))
    ).admitted

    stale = await first.transition_allocation(
        resource_id,
        backend_id="backend-a",
        expected_generation="2",
        target_state=GPUAllocationState.LOADING,
    )
    assert stale.status == "stale_generation"
    assert (
        await first.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation="1",
            target_state=GPUAllocationState.LOADING,
            request_lease_id="lease-a",
            request_owner_id="owner-a",
        )
    ).status == "transitioned"
    assert (
        await first.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation="1",
            target_state=GPUAllocationState.RESIDENT,
            request_lease_id="lease-a",
            request_owner_id="owner-a",
        )
    ).status == "transitioned"
    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="transition-owner",
            generation="2",
            operation="evict",
            ttl_ms=30_000,
        )
    ).status == "acquired"
    assert (
        await first.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation="1",
            target_state=GPUAllocationState.DRAINING,
            next_generation="2",
            transition_owner_id="transition-owner",
            transition_operation="evict",
        )
    ).status == "transitioned"
    guarded = await first.transition_allocation(
        resource_id,
        backend_id="backend-a",
        expected_generation="2",
        target_state=GPUAllocationState.UNLOADING,
        transition_owner_id="transition-owner",
        transition_operation="evict",
    )
    assert guarded.status == "active_leases"

    # A request from the old generation may still release its own lease.
    assert (
        await first.release_lease(
            resource_id,
            backend_id="backend-a",
            lease_id="lease-a",
            owner_id="owner-a",
            generation="1",
        )
    ).status == "released"
    unloading = await first.transition_allocation(
        resource_id,
        backend_id="backend-a",
        expected_generation="2",
        target_state=GPUAllocationState.UNLOADING,
        transition_owner_id="transition-owner",
        transition_operation="evict",
    )
    assert unloading.status == "transitioned"
    unloaded = await first.transition_allocation(
        resource_id,
        backend_id="backend-a",
        expected_generation="2",
        target_state=GPUAllocationState.UNLOADED,
        transition_owner_id="transition-owner",
        transition_operation="evict",
    )
    assert unloaded.status == "transitioned"
    assert unloaded.committed_mb == 0


@pytest.mark.asyncio
async def test_expired_transition_owner_cannot_commit_after_takeover(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)

    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="old-owner",
            generation="2",
            operation="evict",
            ttl_ms=30,
        )
    ).status == "acquired"

    deadline = asyncio.get_running_loop().time() + 1
    while True:
        takeover = await second.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="new-owner",
            generation="3",
            operation="evict",
            ttl_ms=30_000,
        )
        if takeover.status == "acquired":
            break
        assert takeover.status == "busy"
        if asyncio.get_running_loop().time() >= deadline:
            pytest.fail("transition owner did not become available")
        await asyncio.sleep(0.005)

    stale_owner = await first.transition_allocation(
        resource_id,
        backend_id="backend-a",
        expected_generation="1",
        target_state=GPUAllocationState.DRAINING,
        next_generation="2",
        transition_owner_id="old-owner",
        transition_operation="evict",
    )
    assert stale_owner.status == "owner_mismatch"
    assert (
        await second.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation="1",
            target_state=GPUAllocationState.DRAINING,
            next_generation="3",
            transition_owner_id="new-owner",
            transition_operation="evict",
        )
    ).status == "transitioned"


@pytest.mark.asyncio
async def test_idle_transition_owner_closes_the_admission_window(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)

    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-missing",
            owner_id="transition-owner",
            generation="1",
            operation="evict",
            ttl_ms=30_000,
        )
    ).status == "missing"
    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="transition-owner",
            generation="1",
            operation="evict",
            ttl_ms=30_000,
        )
    ).status == "stale_generation"
    active = await first.acquire_transition_owner(
        resource_id,
        backend_id="backend-a",
        owner_id="transition-owner",
        generation="2",
        operation="evict",
        ttl_ms=30_000,
        require_idle=True,
    )
    assert active.status == "active_leases"
    assert (
        await first.release_lease(
            resource_id,
            backend_id="backend-a",
            lease_id="lease-a",
            owner_id="owner-a",
            generation="1",
        )
    ).status == "released"
    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="transition-owner",
            generation="2",
            operation="evict",
            ttl_ms=30_000,
            require_idle=True,
        )
    ).status == "acquired"

    late_admission = await second.admit(
        resource_id,
        **_admission_kwargs("backend-a", "lease-late", owner_id="owner-late"),
    )
    assert late_admission.status == "transition_in_progress"
    assert (
        await first.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation="1",
            target_state=GPUAllocationState.DRAINING,
            next_generation="2",
            transition_owner_id="transition-owner",
            transition_operation="evict",
        )
    ).status == "transitioned"
    assert len((await first.snapshot(resource_id)).leases) == 0


@pytest.mark.asyncio
async def test_generation_tombstone_is_strict_beyond_lua_safe_integer(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    initial_generation = "9007199254740992"
    drain_generation = "9007199254740993"
    next_generation = "9007199254740994"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id, generation=initial_generation)
    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="transition-owner",
            generation=drain_generation,
            operation="evict",
            ttl_ms=30_000,
        )
    ).status == "acquired"
    assert (
        await first.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation=initial_generation,
            target_state=GPUAllocationState.DRAINING,
            next_generation=drain_generation,
            transition_owner_id="transition-owner",
            transition_operation="evict",
        )
    ).status == "transitioned"
    assert (
        await first.release_lease(
            resource_id,
            backend_id="backend-a",
            lease_id="lease-a",
            owner_id="owner-a",
            generation=initial_generation,
        )
    ).status == "released"
    for state in (GPUAllocationState.UNLOADING, GPUAllocationState.UNLOADED):
        assert (
            await first.transition_allocation(
                resource_id,
                backend_id="backend-a",
                expected_generation=drain_generation,
                target_state=state,
                transition_owner_id="transition-owner",
                transition_operation="evict",
            )
        ).status == "transitioned"
    assert (
        await first.release_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="transition-owner",
            generation=drain_generation,
            operation="evict",
        )
    ).status == "released"

    for rejected_generation in (initial_generation, drain_generation):
        rejected = await first.admit(
            resource_id,
            **_admission_kwargs(
                "backend-a", "lease-rejected", generation=rejected_generation
            ),
        )
        assert rejected.status == "stale_generation"
    assert (
        await first.admit(
            resource_id,
            **_admission_kwargs("backend-a", "lease-next", generation=next_generation),
        )
    ).admitted


@pytest.mark.asyncio
async def test_allocation_configuration_is_authoritative(redis_stores) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.admit(
            resource_id,
            **_admission_kwargs("backend-a", "lease-a", max_concurrency=4),
        )
    ).admitted

    smaller_limit = await first.admit(
        resource_id,
        **_admission_kwargs(
            "backend-a",
            "lease-smaller",
            owner_id="owner-smaller",
            max_concurrency=1,
        ),
    )
    assert smaller_limit.status == "config_mismatch"
    larger_limit = await first.admit(
        resource_id,
        **_admission_kwargs(
            "backend-a",
            "lease-b",
            owner_id="owner-b",
            max_concurrency=8,
        ),
    )
    assert larger_limit.status == "config_mismatch"
    operation_retry_kwargs = _admission_kwargs(
        "backend-a", "lease-a", max_concurrency=4
    )
    operation_retry_kwargs["operation"] = "warmup"
    operation_retry = await first.admit(resource_id, **operation_retry_kwargs)
    assert operation_retry.status == "lease_conflict"
    assert operation_retry.reason == "idempotent_operation_mismatch"
    changed_retry = await first.admit(
        resource_id,
        **_admission_kwargs("backend-a", "lease-a", max_concurrency=8),
    )
    assert changed_retry.status == "lease_conflict"
    assert changed_retry.reason == "idempotent_config_mismatch"
    assert len((await first.snapshot(resource_id)).leases) == 1


@pytest.mark.asyncio
async def test_reconcile_cannot_change_counted_allocation_evictability(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-counted-config/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)
    before = await first.snapshot(resource_id)
    changed = replace(before.allocations[0], evictable=False)

    rejected = await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=before.ledger_revision,
        expected_ledger_incarnation=before.ledger_incarnation,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=(changed,),
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id="change-counted-evictability",
    )
    assert rejected.status == "config_mismatch"
    after = await first.snapshot(resource_id)
    assert after.ledger_revision == before.ledger_revision
    assert after.allocations == before.allocations


@pytest.mark.asyncio
async def test_overcommit_disables_new_resident_fast_path(redis_stores) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)

    before = await first.snapshot(resource_id)
    repair = await first.reconcile_card(
        resource_id,
        50,
        expected_ledger_revision=before.ledger_revision,
        expected_ledger_incarnation=before.ledger_incarnation,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=before.allocations,
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id="test-overcommit",
    )
    assert repair.status == "not_ready"
    assert repair.committed_mb == 60
    snapshot = await first.snapshot(resource_id)
    assert snapshot.ready is False
    assert snapshot.committed_mb == 60

    idempotent_retry = await first.admit(
        resource_id, **_admission_kwargs("backend-a", "lease-a")
    )
    assert idempotent_retry.status == "not_ready"
    blocked = await first.admit(
        resource_id,
        **_admission_kwargs("backend-a", "lease-b", owner_id="owner-b"),
    )
    assert blocked.status == "not_ready"
    assert len((await first.snapshot(resource_id)).leases) == 1


@pytest.mark.asyncio
async def test_card_fifo_and_resource_shards_are_independent(redis_stores) -> None:
    first, second = redis_stores
    resource_a = "node-a/index:0"
    resource_b = "node-a/index:1"
    await asyncio.gather(
        _bootstrap_empty_card(first, resource_a, 50),
        _bootstrap_empty_card(second, resource_b, 50),
    )
    await first.enqueue_card(
        resource_a,
        backend_id="backend-a",
        ticket_id="card-ticket-a",
        owner_id="owner-a",
        ttl_ms=30_000,
    )
    await second.enqueue_card(
        resource_a,
        backend_id="backend-b",
        ticket_id="card-ticket-b",
        owner_id="owner-b",
        ttl_ms=30_000,
    )

    out_of_order = await second.admit(
        resource_a,
        card_ticket_id="card-ticket-b",
        **_admission_kwargs("backend-b", "lease-a-b", budget_mb=50, owner_id="owner-b"),
    )
    assert out_of_order.status == "card_queued"

    # Card A and card B do not share ledger keys. The Redis service itself remains
    # a common infrastructure failure and latency domain.
    admitted_b = await second.admit(
        resource_b,
        **_admission_kwargs("backend-b", "lease-b", budget_mb=50, owner_id="owner-b"),
    )
    assert admitted_b.admitted
    admitted_a = await first.admit(
        resource_a,
        card_ticket_id="card-ticket-a",
        **_admission_kwargs("backend-a", "lease-a", budget_mb=50),
    )
    assert admitted_a.admitted


@pytest.mark.asyncio
async def test_one_card_corrupt_ledger_does_not_poison_another_card(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_a = "node-a/index:0"
    resource_b = "node-a/index:1"
    await asyncio.gather(
        _bootstrap_empty_card(first, resource_a, 100),
        _bootstrap_empty_card(second, resource_b, 100),
    )

    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.set(first.keys(resource_a).allocations, "wrong-type")
        with pytest.raises(GPUArbiterStoreError, match="gpu_arbiter_unavailable"):
            await first.admit(
                resource_a,
                **_admission_kwargs("backend-a", "lease-a"),
            )
        assert (
            await second.admit(
                resource_b,
                **_admission_kwargs("backend-b", "lease-b"),
            )
        ).admitted
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_corrupt_queue_does_not_truncate_existing_tickets(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await first.enqueue_backend(
        resource_id,
        backend_id="backend-a",
        ticket_id="ticket-a",
        owner_id="owner-a",
        ttl_ms=30_000,
    )
    queue_key = first.keys(resource_id).backend_queue("backend-a")
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.rpush(queue_key, "not-json")
        before = await raw.lrange(queue_key, 0, -1)
        result = await first.queue_position(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-a",
            card_queue=False,
        )
        assert result.status == "ledger_corrupt"
        assert await raw.lrange(queue_key, 0, -1) == before
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_corrupt_sibling_allocation_cannot_partially_transition(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.admit(resource_id, **_admission_kwargs("backend-a", "lease-a"))
    ).admitted

    allocations_key = first.keys(resource_id).allocations
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        before = await raw.hget(allocations_key, "backend-a")
        await raw.hset(
            allocations_key,
            "backend-b",
            json.dumps({"backend_id": "backend-b", "state": "resident"}),
        )
        result = await first.transition_allocation(
            resource_id,
            backend_id="backend-a",
            expected_generation="1",
            target_state=GPUAllocationState.LOADING,
            request_lease_id="lease-a",
            request_owner_id="owner-a",
        )
        assert result.status == "ledger_corrupt"
        assert await raw.hget(allocations_key, "backend-a") == before
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_snapshot_rejects_missing_authoritative_allocation_fields(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.admit(resource_id, **_admission_kwargs("backend-a", "lease-a"))
    ).admitted

    allocations_key = first.keys(resource_id).allocations
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        allocation = json.loads(await raw.hget(allocations_key, "backend-a"))
        allocation.pop("max_concurrency")
        await raw.hset(allocations_key, "backend-a", json.dumps(allocation))
        with pytest.raises(GPUArbiterStoreError, match="ledger decode"):
            await first.snapshot(resource_id)
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_reservation_lease_cannot_disappear_while_loading(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.admit(resource_id, **_admission_kwargs("backend-a", "lease-a"))
    ).admitted

    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.hdel(first.keys(resource_id).leases("backend-a"), "lease-a")
        with pytest.raises(GPUArbiterStoreError, match="ledger decode"):
            await first.snapshot(resource_id)
        result = await first.admit(
            resource_id,
            **_admission_kwargs("backend-a", "lease-b", owner_id="owner-b"),
        )
        assert result.status == "ledger_corrupt"
        assert result.reason == "lease_count_cache_drift"
        safety_latch = await first.mark_card_not_ready(
            resource_id,
            100,
            reason="ledger_corrupt",
        )
        assert safety_latch.status == "not_ready"
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_idempotent_admission_rejects_a_corrupt_sibling_lease(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)
    assert (
        await first.admit(
            resource_id,
            **_admission_kwargs("backend-a", "lease-b", owner_id="owner-b"),
        )
    ).admitted

    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.hset(keys.leases("backend-a"), "lease-b", "{broken")
        before_children = (
            await raw.hgetall(keys.allocations),
            await raw.hgetall(keys.leases("backend-a")),
        )
        result = await first.admit(
            resource_id,
            **_admission_kwargs("backend-a", "lease-a"),
        )
        assert result.status == "ledger_corrupt"
        assert result.reason == "lease_invalid"
        assert await raw.hget(keys.card, "bootstrap_state") == "not_ready"
        assert (
            await raw.hgetall(keys.allocations),
            await raw.hgetall(keys.leases("backend-a")),
        ) == before_children
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_snapshot_rejects_oversized_backend_domain_before_scanning(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-oversized-domain/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    keys = first.keys(resource_id)
    domain_raw = json.dumps(
        [f"backend-{index:02d}" for index in range(65)],
        separators=(",", ":"),
    )
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.hset(
            keys.card,
            mapping={
                "backend_domain": domain_raw,
                "backend_domain_fingerprint": hashlib.sha256(
                    domain_raw.encode("utf-8")
                ).hexdigest(),
            },
        )
        with pytest.raises(GPUArbiterStoreError, match="ledger decode"):
            await first.snapshot(resource_id)
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_snapshot_retries_when_incarnation_changes_at_same_revision(
    redis_stores,
    monkeypatch,
) -> None:
    first, second = redis_stores
    resource_id = "node-snapshot-incarnation-aba/index:0"
    old_allocation = _reconcile_allocation()
    await first.reconcile_card(
        resource_id,
        100,
        expected_ledger_revision=None,
        expected_ledger_incarnation=None,
        backend_ids=_TEST_BACKEND_DOMAIN,
        allocations=(old_allocation,),
        lease_cleanup=None,
        ready=True,
        reconcile_deadline_ms=_future_reconcile_deadline_ms(),
        repair_id="snapshot-old-bootstrap",
    )
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    original_hgetall = first._redis.hgetall
    interleaved = False

    async def hgetall_with_rebootstrap(name, *args, **kwargs):
        nonlocal interleaved
        result = await original_hgetall(name, *args, **kwargs)
        if name == keys.allocations and not interleaved:
            interleaved = True
            await raw.delete(
                keys.card,
                keys.allocations,
                keys.queue,
                keys.transition,
                *(
                    key
                    for backend_id in _TEST_BACKEND_DOMAIN
                    for key in (
                        keys.leases(backend_id),
                        keys.backend_queue(backend_id),
                    )
                ),
            )
            await second.reconcile_card(
                resource_id,
                100,
                expected_ledger_revision=None,
                expected_ledger_incarnation=None,
                backend_ids=_TEST_BACKEND_DOMAIN,
                allocations=(
                    replace(
                        old_allocation,
                        state=GPUAllocationState.UNLOADED,
                    ),
                ),
                lease_cleanup=None,
                ready=True,
                reconcile_deadline_ms=_future_reconcile_deadline_ms(),
                repair_id="snapshot-new-bootstrap",
            )
        return result

    try:
        monkeypatch.setattr(first._redis, "hgetall", hgetall_with_rebootstrap)
        snapshot = await first.snapshot(resource_id)
        assert interleaved is True
        assert snapshot.ledger_revision == 1
        assert snapshot.committed_mb == 0
        assert snapshot.allocations[0].state is GPUAllocationState.UNLOADED
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_snapshot_retries_across_concurrent_ledger_revisions(
    redis_stores,
) -> None:
    first, second = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    await _admit_resident(first, resource_id)
    assert (
        await first.release_lease(
            resource_id,
            backend_id="backend-a",
            lease_id="lease-a",
            owner_id="owner-a",
            generation="1",
        )
    ).status == "released"

    finished = asyncio.Event()

    async def rewrite_ledger() -> None:
        generation = 1
        try:
            for cycle in range(4):
                drain_generation = str(generation + 1)
                transition_owner = f"transition-{cycle}"
                assert (
                    await second.acquire_transition_owner(
                        resource_id,
                        backend_id="backend-a",
                        owner_id=transition_owner,
                        generation=drain_generation,
                        operation="evict",
                        ttl_ms=30_000,
                    )
                ).status == "acquired"
                assert (
                    await second.transition_allocation(
                        resource_id,
                        backend_id="backend-a",
                        expected_generation=str(generation),
                        target_state=GPUAllocationState.DRAINING,
                        next_generation=drain_generation,
                        transition_owner_id=transition_owner,
                        transition_operation="evict",
                    )
                ).status == "transitioned"
                for state in (
                    GPUAllocationState.UNLOADING,
                    GPUAllocationState.UNLOADED,
                ):
                    assert (
                        await second.transition_allocation(
                            resource_id,
                            backend_id="backend-a",
                            expected_generation=drain_generation,
                            target_state=state,
                            transition_owner_id=transition_owner,
                            transition_operation="evict",
                        )
                    ).status == "transitioned"
                assert (
                    await second.release_transition_owner(
                        resource_id,
                        backend_id="backend-a",
                        owner_id=transition_owner,
                        generation=drain_generation,
                        operation="evict",
                    )
                ).status == "released"

                generation += 2
                lease_id = f"lease-{cycle}"
                owner_id = f"owner-{cycle}"
                await _admit_resident(
                    second,
                    resource_id,
                    lease_id=lease_id,
                    owner_id=owner_id,
                    generation=str(generation),
                )
                assert (
                    await second.release_lease(
                        resource_id,
                        backend_id="backend-a",
                        lease_id=lease_id,
                        owner_id=owner_id,
                        generation=str(generation),
                    )
                ).status == "released"
                await asyncio.sleep(0.001)
        finally:
            finished.set()

    writer = asyncio.create_task(rewrite_ledger())
    snapshots = 0
    while not finished.is_set():
        snapshot = await first.snapshot(resource_id)
        assert snapshot.committed_mb in {0, 60}
        snapshots += 1
        await asyncio.sleep(0)
    await writer
    assert snapshots > 0
    assert (await first.snapshot(resource_id)).committed_mb == 60


@pytest.mark.asyncio
async def test_allocation_and_lease_keys_never_expire(redis_stores) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.admit(resource_id, **_admission_kwargs("backend-a", "lease-a"))
    ).admitted
    assert await first.key_ttls(resource_id, backend_id="backend-a") == (-1, -1)


@pytest.mark.asyncio
async def test_revision_headroom_rejects_new_queue_work_without_mutation(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-revision-headroom/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        new_work_limit = gpu_arbiter_store_module._LEDGER_REVISION_REBASE_THRESHOLD
        await raw.hset(keys.card, "ledger_revision", str(new_work_limit))

        rejected = await first.enqueue_backend(
            resource_id,
            backend_id="backend-a",
            ticket_id="must-not-queue",
            owner_id="owner-a",
            ttl_ms=30_000,
        )
        assert rejected.status == "not_ready"
        assert int(await raw.hget(keys.card, "ledger_revision")) == (new_work_limit)
        assert await raw.llen(keys.backend_queue("backend-a")) == 0
        assert await raw.hget(keys.card, "bootstrap_state") == "not_ready"
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_last_headroom_admission_can_finish_owned_cleanup(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-revision-cleanup-runway/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        await raw.hset(
            keys.card,
            "ledger_revision",
            str(gpu_arbiter_store_module._LEDGER_REVISION_REBASE_THRESHOLD - 1),
        )
        await _admit_resident(first, resource_id)
        heartbeat = await first.heartbeat_lease(
            resource_id,
            backend_id="backend-a",
            lease_id="lease-a",
            owner_id="owner-a",
            generation="1",
            heartbeat_ttl_ms=5_000,
        )
        assert heartbeat.status == "heartbeated"
        assert (
            await first.release_lease(
                resource_id,
                backend_id="backend-a",
                lease_id="lease-a",
                owner_id="owner-a",
                generation="1",
            )
        ).status == "released"
        assert await raw.hlen(keys.leases("backend-a")) == 0
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_cutoff_response_loss_retries_confirm_existing_ownership(
    redis_stores,
) -> None:
    first, _ = redis_stores
    cutoff = gpu_arbiter_store_module._LEDGER_REVISION_REBASE_THRESHOLD
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        admission_resource = "node-cutoff-admission-retry/index:0"
        await _bootstrap_empty_card(first, admission_resource, 100)
        admission_keys = first.keys(admission_resource)
        await raw.hset(admission_keys.card, "ledger_revision", str(cutoff - 1))
        admission_kwargs = _admission_kwargs("backend-a", "cutoff-lease")
        first_admission = await first.admit(admission_resource, **admission_kwargs)
        assert first_admission.status == "admitted"
        retried_admission = await first.admit(admission_resource, **admission_kwargs)
        assert retried_admission.status == "admitted"
        assert retried_admission.idempotent is True
        assert int(await raw.hget(admission_keys.card, "ledger_revision")) == cutoff

        queue_resource = "node-cutoff-queue-retry/index:0"
        await _bootstrap_empty_card(first, queue_resource, 100)
        queue_keys = first.keys(queue_resource)
        await raw.hset(queue_keys.card, "ledger_revision", str(cutoff - 1))
        first_ticket = await first.enqueue_backend(
            queue_resource,
            backend_id="backend-a",
            ticket_id="cutoff-ticket",
            owner_id="owner-a",
            ttl_ms=30_000,
        )
        retried_ticket = await first.enqueue_backend(
            queue_resource,
            backend_id="backend-a",
            ticket_id="cutoff-ticket",
            owner_id="owner-a",
            ttl_ms=30_000,
        )
        assert first_ticket.status == retried_ticket.status == "queued"
        assert retried_ticket.expires_at_ms == first_ticket.expires_at_ms
        assert int(await raw.hget(queue_keys.card, "ledger_revision")) == cutoff

        owner_resource = "node-cutoff-owner-retry/index:0"
        await _bootstrap_empty_card(first, owner_resource, 100)
        await _admit_resident(first, owner_resource)
        assert (
            await first.release_lease(
                owner_resource,
                backend_id="backend-a",
                lease_id="lease-a",
                owner_id="owner-a",
                generation="1",
            )
        ).status == "released"
        owner_keys = first.keys(owner_resource)
        await raw.hset(owner_keys.card, "ledger_revision", str(cutoff - 1))
        owner_kwargs = {
            "backend_id": "backend-a",
            "owner_id": "cutoff-owner",
            "generation": "2",
            "operation": "evict",
            "ttl_ms": 30_000,
        }
        first_owner = await first.acquire_transition_owner(
            owner_resource, **owner_kwargs
        )
        retried_owner = await first.acquire_transition_owner(
            owner_resource, **owner_kwargs
        )
        assert first_owner.status == retried_owner.status == "acquired"
        assert retried_owner.idempotent is True
        assert retried_owner.expires_at_ms == first_owner.expires_at_ms
        assert int(await raw.hget(owner_keys.card, "ledger_revision")) == cutoff
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_queue_position_without_pruning_is_revision_read_only(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-queue-position-read-only/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    assert (
        await first.enqueue_backend(
            resource_id,
            backend_id="backend-a",
            ticket_id="live-ticket",
            owner_id="owner-a",
            ttl_ms=30_000,
        )
    ).status == "queued"
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        revision = int(await raw.hget(keys.card, "ledger_revision"))
        for _ in range(2):
            assert (
                await first.queue_position(
                    resource_id,
                    backend_id="backend-a",
                    ticket_id="live-ticket",
                    card_queue=False,
                )
            ).position == 1
        assert int(await raw.hget(keys.card, "ledger_revision")) == revision
    finally:
        await raw.aclose()


@pytest.mark.asyncio
async def test_reconcile_rotates_incarnation_and_rebases_revision_headroom(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-revision-rebase/index:0"
    await _bootstrap_empty_card(first, resource_id, 100)
    before = await first.snapshot(resource_id)
    keys = first.keys(resource_id)
    raw = Redis.from_url(_redis_url(), decode_responses=True)
    try:
        rebase_boundary = gpu_arbiter_store_module._LEDGER_REVISION_REBASE_THRESHOLD - 1
        await raw.hset(keys.card, "ledger_revision", str(rebase_boundary))

        rebased = await first.reconcile_card(
            resource_id,
            100,
            expected_ledger_revision=rebase_boundary,
            expected_ledger_incarnation=before.ledger_incarnation,
            backend_ids=_TEST_BACKEND_DOMAIN,
            allocations=before.allocations,
            lease_cleanup=None,
            ready=True,
            reconcile_deadline_ms=_future_reconcile_deadline_ms(),
            repair_id="revision-headroom-rebase",
        )
        assert rebased.status == "reconciled"
        assert rebased.ledger_revision == 1
        assert rebased.ledger_incarnation != before.ledger_incarnation
        snapshot = await first.snapshot(resource_id)
        assert snapshot.ready is True
        assert snapshot.ledger_revision == 1
        assert snapshot.ledger_incarnation == rebased.ledger_incarnation
    finally:
        await raw.aclose()


def test_max_concurrency_requires_a_positive_integer() -> None:
    assert normalize_gpu_backend_max_concurrency(None) == 4
    assert normalize_gpu_backend_max_concurrency(2) == 2
    for invalid in (True, False, 0, -1, "2", 1.5, 10_001):
        with pytest.raises(ValueError):
            normalize_gpu_backend_max_concurrency(invalid)


@pytest.mark.asyncio
async def test_ttl_durations_cannot_write_unsafe_absolute_deadlines(
    redis_stores,
) -> None:
    first, _ = redis_stores
    resource_id = "node-a/index:0"
    maximum_ttl_ms = 2_147_483_647
    invalid_ttl_ms = maximum_ttl_ms + 1
    await _bootstrap_empty_card(first, resource_id, 100)

    kwargs = _admission_kwargs("backend-a", "lease-a")
    kwargs["heartbeat_ttl_ms"] = maximum_ttl_ms
    kwargs["hard_ttl_ms"] = maximum_ttl_ms
    assert (await first.admit(resource_id, **kwargs)).admitted
    assert len((await first.snapshot(resource_id)).leases) == 1
    assert (
        await first.enqueue_backend(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-a",
            owner_id="owner-a",
            ttl_ms=maximum_ttl_ms,
        )
    ).status == "queued"
    for state in (GPUAllocationState.LOADING, GPUAllocationState.RESIDENT):
        assert (
            await first.transition_allocation(
                resource_id,
                backend_id="backend-a",
                expected_generation="1",
                target_state=state,
                request_lease_id="lease-a",
                request_owner_id="owner-a",
            )
        ).status == "transitioned"
    assert (
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="transition-owner",
            generation="2",
            operation="evict",
            ttl_ms=maximum_ttl_ms,
        )
    ).status == "acquired"

    invalid_kwargs = _admission_kwargs("backend-b", "lease-invalid")
    invalid_kwargs["heartbeat_ttl_ms"] = invalid_ttl_ms
    invalid_kwargs["hard_ttl_ms"] = invalid_ttl_ms
    with pytest.raises(ValueError, match="at most"):
        await first.admit(resource_id, **invalid_kwargs)
    with pytest.raises(ValueError, match="at most"):
        await first.enqueue_card(
            resource_id,
            backend_id="backend-a",
            ticket_id="ticket-invalid",
            owner_id="owner-a",
            ttl_ms=invalid_ttl_ms,
        )
    with pytest.raises(ValueError, match="at most"):
        await first.acquire_transition_owner(
            resource_id,
            backend_id="backend-a",
            owner_id="invalid-owner",
            generation="2",
            operation="evict",
            ttl_ms=invalid_ttl_ms,
        )


def test_store_is_recreated_and_closed_in_each_asyncio_run() -> None:
    redis_url = _redis_url()
    namespace = f"gpu-arbiter-test:{uuid.uuid4().hex}"

    async def one_cycle(resource_id: str) -> GPUArbiterStore:
        store = GPUArbiterStore.from_url(redis_url, namespace=namespace)
        async with store:
            assert await store.ping() is True
            await store.configure_card(resource_id, 100, ready=False)
        return store

    async def assert_closed(store: GPUArbiterStore) -> None:
        with pytest.raises(GPUArbiterStoreError, match="store is closed"):
            await store.ping()

    try:
        closed = asyncio.run(one_cycle("node-a/index:0"))
        asyncio.run(assert_closed(closed))
        closed = asyncio.run(one_cycle("node-a/index:1"))
        asyncio.run(assert_closed(closed))
    finally:
        asyncio.run(_clean_namespace(redis_url, namespace))


@pytest.mark.asyncio
async def test_unavailable_redis_fails_within_client_timeout() -> None:
    transports: list[asyncio.BaseTransport] = []

    class BlackholeProtocol(asyncio.Protocol):
        def connection_made(self, transport: asyncio.BaseTransport) -> None:
            transports.append(transport)

    server = await asyncio.get_running_loop().create_server(
        BlackholeProtocol, "127.0.0.1", 0
    )
    port = server.sockets[0].getsockname()[1]
    store = GPUArbiterStore.from_url(
        f"redis://127.0.0.1:{port}/0",
        namespace=f"gpu-arbiter-test:{uuid.uuid4().hex}",
    )
    started = time.monotonic()
    try:
        with pytest.raises(GPUArbiterStoreError, match="gpu_arbiter_unavailable"):
            await store.ping()
        assert time.monotonic() - started < 3
    finally:
        await store.aclose()
        server.close()
        await server.wait_closed()
        for transport in transports:
            transport.close()


@pytest.mark.asyncio
async def test_failed_close_is_bounded_and_can_be_retried(monkeypatch) -> None:
    class HangingRedis:
        should_hang = True

        def register_script(self, _source: str) -> object:
            return object()

        async def aclose(self) -> None:
            if self.should_hang:
                await asyncio.Event().wait()

        async def ping(self) -> bool:
            return True

    monkeypatch.setattr(gpu_arbiter_store_module, "_REDIS_CALL_DEADLINE_SECONDS", 0.02)
    redis = HangingRedis()
    store = GPUArbiterStore(redis)
    with pytest.raises(GPUArbiterStoreError, match="gpu_arbiter_unavailable"):
        await store.aclose()

    redis.should_hang = False
    await store.aclose()
    with pytest.raises(GPUArbiterStoreError, match="store is closed"):
        await store.ping()
