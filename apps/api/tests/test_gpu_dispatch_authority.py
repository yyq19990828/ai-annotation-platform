from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
import time
import uuid

import pytest
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    AdmissionTokenClaims,
    DrainTransitionResponse,
    ManagedUnloadResponse,
)

from app.config import Settings
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.services import gpu_dispatch_authority as authority_module
from app.services.gpu_arbiter import (
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUColdRuntimeSubject,
    GPUColdTerminalCommitResult,
    GPUDispatchRequest,
    GPUEvictionCommitResult,
    GPUIdleEvictionRuntimeSubject,
    GPUPreparedColdRuntimeSubject,
    GPUPreparedIdleEvictionRuntimeSubject,
    GPUResidentRuntimeSubject,
    GPUResidentRuntimeSubjectError,
)
from app.services.gpu_arbiter_store import (
    GPUAdmissionResult,
    GPUAllocation,
    GPUAllocationState,
    GPUArbiterStoreError,
    GPUCardSnapshot,
    GPUIdleEvictionResult,
    GPULeaseMutationResult,
    GPUQueueResult,
    GPUTransitionOwnerResult,
    GPUTransitionResult,
)


_RESOURCE_ID = "node-runtime/index:0"


def _subject() -> GPUResidentRuntimeSubject:
    return GPUResidentRuntimeSubject(
        backend_registry_id=uuid.uuid4(),
        gpu_resource_id=_RESOURCE_ID,
        membership_epoch=3,
        budget_mb=4096,
        eviction_priority=2,
        max_concurrency=4,
        boot_id="boot-runtime",
        generation="7",
        control_epoch="5",
        runtime_epoch="2",
        db_now=datetime.now(UTC),
    )


def _cold_subject() -> GPUColdRuntimeSubject:
    return GPUColdRuntimeSubject(
        backend_registry_id=uuid.uuid4(),
        gpu_resource_id=_RESOURCE_ID,
        membership_epoch=3,
        budget_mb=4096,
        eviction_priority=2,
        max_concurrency=4,
        boot_id="boot-runtime",
        observed_generation="7",
        generation_high_water=7,
        control_epoch="5",
        runtime_epoch="2",
        db_now=datetime.now(UTC),
    )


def _prepared_cold_subject(
    subject: GPUColdRuntimeSubject,
) -> GPUPreparedColdRuntimeSubject:
    return GPUPreparedColdRuntimeSubject(
        backend_registry_id=subject.backend_registry_id,
        gpu_resource_id=subject.gpu_resource_id,
        membership_epoch=subject.membership_epoch,
        budget_mb=subject.budget_mb,
        eviction_priority=subject.eviction_priority,
        max_concurrency=subject.max_concurrency,
        boot_id=subject.boot_id,
        observed_generation=subject.observed_generation,
        generation=str(subject.generation_high_water + 1),
        control_epoch=subject.control_epoch,
        runtime_epoch=subject.runtime_epoch,
        token_expires_at=subject.db_now + timedelta(seconds=120),
        db_now=subject.db_now,
    )


def _allocation(
    backend_id: uuid.UUID,
    *,
    budget_mb: int,
    generation: str,
    eviction_priority: int = 1,
    last_used_at_ms: int = 1,
) -> GPUAllocation:
    return GPUAllocation(
        backend_id=str(backend_id),
        state=GPUAllocationState.RESIDENT,
        budget_mb=budget_mb,
        generation=generation,
        eviction_priority=eviction_priority,
        evictable=True,
        max_concurrency=4,
        reservation_lease_id=None,
        reservation_owner_id=None,
        last_used_at_ms=last_used_at_ms,
    )


def _card_snapshot(
    resource_id: str,
    *,
    allocatable_mb: int,
    allocations: tuple[GPUAllocation, ...],
    transition_present: bool = False,
) -> GPUCardSnapshot:
    return GPUCardSnapshot(
        resource_id=resource_id,
        allocatable_mb=allocatable_mb,
        ready=True,
        reconcile_deadline_ms=0,
        ledger_revision=1,
        ledger_incarnation="test-incarnation",
        committed_mb=sum(item.budget_mb for item in allocations if item.counted),
        backend_ids=tuple(item.backend_id for item in allocations),
        active_backend_ids=tuple(item.backend_id for item in allocations),
        backend_memberships=(),
        allocations=allocations,
        leases=(),
        not_ready_reason=None,
        card_queue_count=0,
        backend_queue_count=0,
        transition_present=transition_present,
    )


def _idle_eviction_subject(
    allocation: GPUAllocation,
    resource_id: str,
    *,
    challenge: str,
) -> GPUIdleEvictionRuntimeSubject:
    backend_id = uuid.UUID(allocation.backend_id)
    backend = MLBackendRegistry(
        id=backend_id,
        name=f"victim-{backend_id}",
        url=f"http://victim-{backend_id}.test",
        state="connected",
        auth_method="none",
        auth_token=None,
        extra_params={"gpu_max_concurrency": allocation.max_concurrency},
        gpu_resource_id=resource_id,
        vram_budget_mb=allocation.budget_mb,
        eviction_priority=allocation.eviction_priority,
    )
    assert allocation.generation is not None
    return GPUIdleEvictionRuntimeSubject(
        backend=backend,
        backend_registry_id=backend_id,
        gpu_resource_id=resource_id,
        membership_epoch=1,
        budget_mb=allocation.budget_mb,
        eviction_priority=allocation.eviction_priority,
        max_concurrency=allocation.max_concurrency,
        boot_id=f"boot-{backend_id}",
        generation=allocation.generation,
        generation_high_water=int(allocation.generation),
        control_epoch="5",
        runtime_epoch="2",
        challenge=challenge,
        db_now=datetime.now(UTC),
    )


def _prepared_idle_eviction_subject(
    subject: GPUIdleEvictionRuntimeSubject,
    *,
    token_expires_at: datetime,
) -> GPUPreparedIdleEvictionRuntimeSubject:
    return GPUPreparedIdleEvictionRuntimeSubject(
        backend=subject.backend,
        backend_registry_id=subject.backend_registry_id,
        gpu_resource_id=subject.gpu_resource_id,
        membership_epoch=subject.membership_epoch,
        budget_mb=subject.budget_mb,
        eviction_priority=subject.eviction_priority,
        max_concurrency=subject.max_concurrency,
        boot_id=subject.boot_id,
        source_generation=subject.generation,
        generation=str(int(subject.generation) + 1),
        control_epoch=subject.control_epoch,
        runtime_epoch=subject.runtime_epoch,
        token_expires_at=token_expires_at,
        db_now=subject.db_now,
    )


def _drain_response(
    subject: GPUPreparedIdleEvictionRuntimeSubject,
) -> DrainTransitionResponse:
    return DrainTransitionResponse(
        generation=subject.generation,
        draining=True,
        active_requests=0,
        ready_to_unload=True,
        residency={
            "state": "draining",
            "gpu_loaded": True,
            "active_requests": 0,
            "builders": 0,
            "borrowers": 0,
            "draining": True,
            "evictable": False,
            "generation": subject.generation,
            "pools": {
                "default": {
                    "resident": True,
                    "device": "cuda:0",
                    "provider": "CUDAExecutionProvider",
                }
            },
            "boot_id": subject.boot_id,
            "lifecycle_gate": "enforce",
            "control_epoch": subject.control_epoch,
            "identity": {
                "backend_registry_id": str(subject.backend_registry_id),
                "gpu_resource_id": subject.gpu_resource_id,
            },
        },
    )


def _unload_response(
    subject: GPUPreparedIdleEvictionRuntimeSubject,
) -> ManagedUnloadResponse:
    return ManagedUnloadResponse(
        generation=subject.generation,
        unloaded=True,
        unloaded_count=1,
        residency={
            "state": "unloaded",
            "gpu_loaded": False,
            "active_requests": 0,
            "builders": 0,
            "borrowers": 0,
            "draining": False,
            "evictable": False,
            "generation": subject.generation,
            "pools": {
                "default": {
                    "resident": False,
                    "device": None,
                    "provider": None,
                }
            },
            "boot_id": subject.boot_id,
            "lifecycle_gate": "enforce",
            "control_epoch": subject.control_epoch,
            "identity": {
                "backend_registry_id": str(subject.backend_registry_id),
                "gpu_resource_id": subject.gpu_resource_id,
            },
        },
    )


def _request(
    subject: GPUResidentRuntimeSubject | GPUColdRuntimeSubject,
    *,
    operation: str = "predict",
    scope: AdmissionScope = AdmissionScope.PREDICT,
) -> GPUDispatchRequest:
    return GPUDispatchRequest(
        backend_id=str(subject.backend_registry_id),
        gpu_resource_id=subject.gpu_resource_id,
        operation=operation,  # type: ignore[arg-type]
        scope=scope,
    )


class _RecordingSigner:
    def __init__(
        self,
        events: list[str],
        *,
        fail: bool = False,
        token: str = "signed-workload-token",
    ) -> None:
        self.events = events
        self.fail = fail
        self.token = token
        self.claims: AdmissionTokenClaims | None = None
        self.claims_history: list[AdmissionTokenClaims] = []

    def sign(self, claims: AdmissionTokenClaims) -> str:
        self.events.append("sign")
        self.claims = claims
        self.claims_history.append(claims)
        if self.fail:
            raise RuntimeError("signing failed")
        return self.token


class _ScopeSigner(_RecordingSigner):
    def sign(self, claims: AdmissionTokenClaims) -> str:
        super().sign(claims)
        return f"signed:{claims.scope.value}:{claims.jti}"


class _RecordingStore:
    def __init__(
        self,
        events: list[str],
        *,
        admission_status: str = "admitted",
        heartbeat_status: str = "heartbeated",
        cold_owner_status: str = "acquired",
        cold_revalidate_status: str = "renewed",
        admission_statuses: list[str] | None = None,
        card_queue_positions: list[int] | None = None,
    ) -> None:
        self.events = events
        self.admission_status = admission_status
        self.heartbeat_status = heartbeat_status
        self.cold_owner_status = cold_owner_status
        self.cold_revalidate_status = cold_revalidate_status
        self.admission_statuses = list(admission_statuses or [])
        self.card_queue_positions = list(card_queue_positions or [1])
        self.admit_attempts = 0
        self.admit_kwargs: dict | None = None
        self.admit_kwargs_history: list[dict] = []
        self.backend_enqueue_kwargs: list[dict] = []
        self.card_enqueue_kwargs: list[dict] = []
        self.queue_position_kwargs: list[dict] = []
        self.queue_cancel_kwargs: list[dict] = []
        self.heartbeat_kwargs: list[dict] = []
        self.release_kwargs: list[dict] = []
        self.uncertain_kwargs: list[dict] = []
        self.transition_kwargs: list[dict] = []
        self.finalize_kwargs: list[dict] = []
        self.cold_owner_kwargs: list[dict] = []
        self.cold_revalidate_kwargs: list[dict] = []
        self.cold_release_kwargs: list[dict] = []
        self.hard_deadline_ms: int | None = None
        self.uncertain_entered = asyncio.Event()
        self.uncertain_release = asyncio.Event()
        self.block_uncertain = False

    async def ping(self) -> bool:
        self.events.append("ping")
        return True

    async def enqueue_backend(self, resource_id: str, **kwargs):
        self.events.append("backend_enqueue")
        self.backend_enqueue_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUQueueResult(
            status="queued",
            ticket_id=kwargs["ticket_id"],
            position=1,
            expires_at_ms=int(time.time() * 1000) + kwargs["ttl_ms"],
        )

    async def enqueue_card(self, resource_id: str, **kwargs):
        self.events.append("card_enqueue")
        self.card_enqueue_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUQueueResult(
            status="queued",
            ticket_id=kwargs["ticket_id"],
            position=self.card_queue_positions[0],
            expires_at_ms=int(time.time() * 1000) + kwargs["ttl_ms"],
        )

    async def queue_position(self, resource_id: str, **kwargs):
        position = self.card_queue_positions[0]
        if len(self.card_queue_positions) > 1:
            self.card_queue_positions.pop(0)
        self.events.append(f"card_position:{position}")
        self.queue_position_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUQueueResult(
            status="queued",
            ticket_id=kwargs["ticket_id"],
            position=position,
            expires_at_ms=int(time.time() * 1000) + 30_000,
        )

    async def cancel_queue_ticket(self, resource_id: str, **kwargs):
        kind = "card" if kwargs["card_queue"] else "backend"
        self.events.append(f"{kind}_cancel")
        self.queue_cancel_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUQueueResult(status="cancelled", ticket_id=kwargs["ticket_id"])

    async def snapshot(self, resource_id: str) -> GPUCardSnapshot:
        return GPUCardSnapshot(
            resource_id=resource_id,
            allocatable_mb=8192,
            ready=True,
            reconcile_deadline_ms=0,
            ledger_revision=1,
            ledger_incarnation="test-incarnation",
            committed_mb=0,
            backend_ids=(),
            active_backend_ids=(),
            backend_memberships=(),
            allocations=(),
            leases=(),
            not_ready_reason=None,
            card_queue_count=0,
            backend_queue_count=0,
            transition_present=False,
        )

    async def acquire_cold_admission_owner(self, resource_id: str, **kwargs):
        self.events.append("cold_owner")
        self.cold_owner_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUTransitionOwnerResult(
            status=self.cold_owner_status,  # type: ignore[arg-type]
            owner_id=kwargs["owner_id"],
            generation=kwargs["generation"],
        )

    async def revalidate_cold_admission_owner(self, resource_id: str, **kwargs):
        self.events.append("cold_revalidate")
        self.cold_revalidate_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUTransitionOwnerResult(
            status=self.cold_revalidate_status,  # type: ignore[arg-type]
            owner_id=kwargs["owner_id"],
            generation=kwargs["generation"],
        )

    async def release_cold_admission_owner(self, resource_id: str, **kwargs):
        self.events.append("cold_release")
        self.cold_release_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUTransitionOwnerResult(status="released")

    async def admit(self, resource_id: str, **kwargs) -> GPUAdmissionResult:
        self.events.append("admit")
        self.admit_attempts += 1
        self.admit_kwargs = {"resource_id": resource_id, **kwargs}
        self.admit_kwargs_history.append(self.admit_kwargs)
        admission_status = (
            self.admission_statuses.pop(0)
            if self.admission_statuses
            else self.admission_status
        )
        if admission_status == "error" or (
            admission_status == "error_once" and self.admit_attempts == 1
        ):
            raise RuntimeError("admission response lost")
        now_ms = int(time.time() * 1000)
        if admission_status in {"admitted", "error_once"}:
            self.hard_deadline_ms = now_ms + 120_000
            return GPUAdmissionResult(
                status="admitted",
                reason=(
                    "cold_reservation"
                    if kwargs.get("require_cold_owner")
                    else "resident_fast_path"
                ),
                committed_mb=4096,
                lease_count=1,
                allocation_state=(
                    GPUAllocationState.RESERVING
                    if kwargs.get("require_cold_owner")
                    else GPUAllocationState.RESIDENT
                ),
                heartbeat_deadline_ms=now_ms + 15_000,
                hard_deadline_ms=self.hard_deadline_ms,
            )
        return GPUAdmissionResult(
            status=admission_status,  # type: ignore[arg-type]
            reason="rejected",
            committed_mb=4096,
            lease_count=4,
        )

    async def heartbeat_lease(self, resource_id: str, **kwargs):
        self.events.append("heartbeat")
        self.heartbeat_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPULeaseMutationResult(
            status=self.heartbeat_status,  # type: ignore[arg-type]
        )

    async def release_lease(self, resource_id: str, **kwargs):
        self.events.append("release")
        self.release_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPULeaseMutationResult(status="released")

    async def mark_lease_uncertain(self, resource_id: str, **kwargs):
        self.events.append("uncertain")
        self.uncertain_kwargs.append({"resource_id": resource_id, **kwargs})
        self.uncertain_entered.set()
        if self.block_uncertain:
            await self.uncertain_release.wait()
        return GPULeaseMutationResult(status="uncertain")

    async def transition_allocation(self, resource_id: str, **kwargs):
        target_state = kwargs["target_state"]
        self.events.append(f"transition:{target_state.value}")
        self.transition_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUTransitionResult(
            status="transitioned",
            state=target_state,
            generation=kwargs["expected_generation"],
            committed_mb=4096,
        )

    async def finalize_cold_allocation(self, resource_id: str, **kwargs):
        target_state = kwargs["target_state"]
        self.events.append(f"finalize:{target_state.value}")
        self.finalize_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUTransitionResult(
            status="transitioned",
            state=target_state,
            generation=kwargs["expected_generation"],
            committed_mb=(
                4096
                if target_state
                in {GPUAllocationState.RESIDENT, GPUAllocationState.UNKNOWN}
                else 0
            ),
        )

    async def aclose(self) -> None:
        self.events.append("close")


class _EvictionStore(_RecordingStore):
    def __init__(
        self,
        events: list[str],
        snapshots: list[GPUCardSnapshot],
    ) -> None:
        super().__init__(events)
        self.snapshots = snapshots
        self.victim_budgets = {
            item.backend_id: item.budget_mb
            for snapshot in snapshots
            for item in snapshot.allocations
        }
        self.begin_kwargs: list[dict] = []
        self.eviction_heartbeat_kwargs: list[dict] = []
        self.eviction_release_kwargs: list[dict] = []

    async def snapshot(self, resource_id: str) -> GPUCardSnapshot:
        self.events.append(f"snapshot:{resource_id}")
        snapshot = self.snapshots[0]
        assert snapshot.resource_id == resource_id
        if len(self.snapshots) > 1:
            self.snapshots.pop(0)
        return snapshot

    async def begin_idle_eviction(self, resource_id: str, **kwargs):
        victim_id = kwargs["victim_backend_id"]
        self.events.append(f"eviction_begin:{victim_id}")
        self.begin_kwargs.append({"resource_id": resource_id, **kwargs})
        now_ms = int(time.time() * 1000)
        return GPUIdleEvictionResult(
            status="selected",
            reason="idle_victim_selected",
            committed_mb=0,
            shortfall_mb=0,
            victim_backend_id=victim_id,
            victim_generation=kwargs["victim_next_generation"],
            victim_budget_mb=self.victim_budgets[victim_id],
            owner_id=kwargs["owner_id"],
            owner_expires_at_ms=now_ms + kwargs["ttl_ms"],
            owner_hard_deadline_ms=now_ms + kwargs["hard_ttl_ms"],
        )

    async def heartbeat_transition_owner(self, resource_id: str, **kwargs):
        backend_id = kwargs["backend_id"]
        self.events.append(f"eviction_heartbeat:{backend_id}")
        self.eviction_heartbeat_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUTransitionOwnerResult(
            status="renewed",
            owner_id=kwargs["owner_id"],
            generation=kwargs["generation"],
        )

    async def release_transition_owner(self, resource_id: str, **kwargs):
        backend_id = kwargs["backend_id"]
        self.events.append(f"eviction_release:{backend_id}")
        self.eviction_release_kwargs.append({"resource_id": resource_id, **kwargs})
        return GPUTransitionOwnerResult(status="released")


def _install_authority_fakes(
    monkeypatch,
    events: list[str],
    subject: GPUResidentRuntimeSubject,
) -> None:
    async def read_subject(db, *, backend_id: str, gpu_resource_id: str):
        events.append("subject")
        assert backend_id == str(subject.backend_registry_id)
        assert gpu_resource_id == subject.gpu_resource_id
        return subject

    async def record_horizon(
        session_factory,
        expected_subject,
        *,
        token_expires_at: datetime,
    ) -> datetime:
        events.append("horizon")
        assert expected_subject is subject
        return token_expires_at

    monkeypatch.setattr(
        authority_module,
        "read_gpu_resident_runtime_subject",
        read_subject,
    )
    monkeypatch.setattr(
        authority_module,
        "record_gpu_resident_runtime_token_expiry",
        record_horizon,
    )


def _install_cold_authority_fakes(
    monkeypatch,
    events: list[str],
    subject: GPUColdRuntimeSubject,
    *,
    prepared: GPUPreparedColdRuntimeSubject | None = None,
    terminal_state: GPUAllocationState = GPUAllocationState.RESIDENT,
    terminal_status: str = "finalized",
    cold_read_challenges: list[str | None] | None = None,
    refreshed_subject: GPUColdRuntimeSubject | None = None,
) -> GPUPreparedColdRuntimeSubject:
    prepared_subject = prepared or _prepared_cold_subject(subject)
    last_prepared_subject = prepared_subject

    async def reject_resident(db, *, backend_id: str, gpu_resource_id: str):
        events.append("subject")
        assert backend_id == str(subject.backend_registry_id)
        assert gpu_resource_id == subject.gpu_resource_id
        raise GPUResidentRuntimeSubjectError("resident_runtime_not_ready")

    async def read_cold(
        db,
        *,
        backend_id: str,
        gpu_resource_id: str,
        expected_challenge: str | None = None,
    ):
        events.append("cold_subject")
        if cold_read_challenges is not None:
            cold_read_challenges.append(expected_challenge)
        assert backend_id == str(subject.backend_registry_id)
        assert gpu_resource_id == subject.gpu_resource_id
        if expected_challenge is not None:
            assert len(expected_challenge) == 64
            return refreshed_subject or subject
        return subject

    async def prepare_cold(
        session_factory,
        expected_subject,
        *,
        token_expires_at: datetime,
    ):
        nonlocal last_prepared_subject
        events.append("prepare")
        assert expected_subject in {subject, refreshed_subject}
        assert token_expires_at > subject.db_now
        base = (
            prepared_subject
            if expected_subject is subject
            else _prepared_cold_subject(expected_subject)
        )
        last_prepared_subject = replace(
            base,
            token_expires_at=token_expires_at,
        )
        return last_prepared_subject

    async def refresh_terminal_health(session_factory, expected_subject):
        events.append("health")
        assert expected_subject.backend_registry_id == subject.backend_registry_id
        return "a" * 64

    async def commit_terminal(
        session_factory,
        store,
        expected_subject,
        *,
        challenge: str | None,
        lease_id: str,
        owner_id: str,
    ):
        committed_state = (
            terminal_state if challenge is not None else GPUAllocationState.UNKNOWN
        )
        events.append(f"terminal:{committed_state.value}")
        assert expected_subject.generation == last_prepared_subject.generation
        assert challenge in {None, "a" * 64}
        assert store.admit_kwargs is not None
        assert lease_id == store.admit_kwargs["lease_id"]
        assert owner_id == store.admit_kwargs["owner_id"]
        return GPUColdTerminalCommitResult(
            status=terminal_status,  # type: ignore[arg-type]
            state=committed_state,
            reason=committed_state.value,
        )

    monkeypatch.setattr(
        authority_module,
        "read_gpu_resident_runtime_subject",
        reject_resident,
    )
    monkeypatch.setattr(
        authority_module,
        "read_gpu_cold_runtime_subject",
        read_cold,
    )
    monkeypatch.setattr(
        authority_module,
        "prepare_gpu_cold_runtime_generation",
        prepare_cold,
    )
    monkeypatch.setattr(
        authority_module,
        "_refresh_cold_terminal_health",
        refresh_terminal_health,
    )
    monkeypatch.setattr(
        authority_module,
        "commit_gpu_cold_terminal_from_health",
        commit_terminal,
    )
    return prepared_subject


def _install_eviction_authority_fakes(
    monkeypatch,
    events: list[str],
    allocations: tuple[GPUAllocation, ...],
    resource_id: str,
    *,
    proof_challenges: dict[tuple[uuid.UUID, str], str | None] | None = None,
) -> dict[uuid.UUID, GPUPreparedIdleEvictionRuntimeSubject]:
    allocation_by_id = {
        uuid.UUID(allocation.backend_id): allocation for allocation in allocations
    }
    prepared_by_id: dict[uuid.UUID, GPUPreparedIdleEvictionRuntimeSubject] = {}

    async def read_idle(
        db,
        *,
        backend_id: str,
        gpu_resource_id: str,
        expected_generation: str,
        challenge: str,
    ) -> GPUIdleEvictionRuntimeSubject:
        victim_id = uuid.UUID(backend_id)
        allocation = allocation_by_id[victim_id]
        events.append(f"idle_subject:{backend_id}")
        assert gpu_resource_id == resource_id
        assert expected_generation == allocation.generation
        if proof_challenges is not None:
            proof_challenges[(victim_id, "initial")] = challenge
        return _idle_eviction_subject(
            allocation,
            resource_id,
            challenge=challenge,
        )

    async def prepare_idle(
        session_factory,
        expected_subject: GPUIdleEvictionRuntimeSubject,
        *,
        token_expires_at: datetime,
    ) -> GPUPreparedIdleEvictionRuntimeSubject:
        backend_id = expected_subject.backend_registry_id
        events.append(f"prepare_eviction:{backend_id}")
        prepared = _prepared_idle_eviction_subject(
            expected_subject,
            token_expires_at=token_expires_at,
        )
        prepared_by_id[backend_id] = prepared
        return prepared

    async def commit_phase(
        session_factory,
        store,
        expected_subject: GPUPreparedIdleEvictionRuntimeSubject,
        *,
        phase: str,
        challenge: str | None,
        owner_id: str,
    ) -> GPUEvictionCommitResult:
        backend_id = expected_subject.backend_registry_id
        events.append(f"commit_{phase}:{backend_id}")
        assert challenge is not None
        if proof_challenges is not None:
            proof_challenges[(backend_id, phase)] = challenge
        assert owner_id.startswith("evict:")
        state = (
            GPUAllocationState.UNLOADING
            if phase == "drain"
            else GPUAllocationState.UNLOADED
        )
        return GPUEvictionCommitResult(
            status="finalized",
            state=state,
            reason=state.value,
        )

    class SuccessfulEvictionClient:
        def __init__(self, backend: MLBackendRegistry) -> None:
            self.backend_id = backend.id

        async def lifecycle_drain(self, grant):
            events.append(f"drain:{self.backend_id}")
            grant.report_response(200)
            return _drain_response(prepared_by_id[self.backend_id])

        async def lifecycle_unload(self, grant):
            events.append(f"unload:{self.backend_id}")
            grant.report_response(200)
            return _unload_response(prepared_by_id[self.backend_id])

    monkeypatch.setattr(
        authority_module,
        "read_gpu_idle_eviction_runtime_subject",
        read_idle,
    )
    monkeypatch.setattr(
        authority_module,
        "prepare_gpu_idle_eviction_runtime_generation",
        prepare_idle,
    )
    monkeypatch.setattr(
        authority_module,
        "commit_gpu_eviction_phase_from_health",
        commit_phase,
    )
    monkeypatch.setattr(
        authority_module,
        "MLBackendClient",
        SuccessfulEvictionClient,
    )
    return prepared_by_id


def _session_factory(events: list[str]):
    @asynccontextmanager
    async def sessions():
        events.append("db")
        yield object()

    return sessions


def test_resident_authority_builder_is_lazy() -> None:
    events: list[str] = []

    def sessions():
        events.append("db")
        raise AssertionError("session factory must stay lazy")

    def open_store():
        events.append("store")
        raise AssertionError("store factory must stay lazy")

    def load_signer():
        events.append("signer")
        raise AssertionError("signer factory must stay lazy")

    authority_module.build_gpu_dispatch_context_factory(
        sessions,  # type: ignore[arg-type]
        store_factory=open_store,  # type: ignore[arg-type]
        signer_factory=load_signer,  # type: ignore[arg-type]
    )

    assert events == []


@pytest.mark.parametrize(
    "kwargs",
    (
        {"admission_timeout_seconds": 0},
        {"admission_timeout_seconds": float("nan")},
        {"admission_timeout_seconds": 3601},
        {"queue_poll_interval_seconds": 0},
        {"queue_poll_interval_seconds": float("inf")},
    ),
)
def test_resident_authority_rejects_invalid_fifo_timings(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        authority_module.build_gpu_dispatch_context_factory(
            _session_factory([]),
            **kwargs,
        )


@pytest.mark.parametrize(
    ("card_queue", "error_code"),
    (
        (False, GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED),
        (True, GPUArbiterErrorCode.CAPACITY_UNAVAILABLE),
    ),
)
def test_fifo_queue_full_maps_to_retryable_dispatch_error(
    card_queue: bool,
    error_code: GPUArbiterErrorCode,
) -> None:
    error = authority_module._map_queue_rejection(
        GPUQueueResult(status="full", ticket_id="ticket:test"),
        card_queue=card_queue,
    )

    assert error.error_code == error_code.value
    assert error.headers == {"Retry-After": "1"}


def test_expired_card_ticket_rejection_remains_retryable() -> None:
    error = authority_module._map_admission_rejection(
        GPUAdmissionResult(
            status="card_queued",
            reason="card_fifo_wait",
            committed_mb=4096,
            lease_count=0,
        )
    )

    assert error.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert error.headers == {"Retry-After": "1"}


@pytest.mark.asyncio
async def test_resident_authority_orders_horizon_signing_and_release(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)

    def load_signer():
        events.append("signer")
        return signer

    def open_store():
        events.append("store")
        return store

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=open_store,  # type: ignore[arg-type]
        signer_factory=load_signer,  # type: ignore[arg-type]
    )
    async with factory(_request(subject)) as grant:
        events.append("yield")
        assert grant.report_response(503) is True

    assert events == [
        "db",
        "subject",
        "signer",
        "store",
        "admit",
        "horizon",
        "sign",
        "heartbeat",
        "yield",
        "release",
        "close",
    ]
    assert store.admit_kwargs is not None
    assert store.admit_kwargs["require_resident"] is True
    assert store.admit_kwargs["evictable"] is False
    assert store.admit_kwargs["generation"] == subject.generation
    assert store.admit_kwargs["membership_epoch"] == subject.membership_epoch
    lease_uuid = uuid.UUID(store.admit_kwargs["lease_id"].removeprefix("workload:"))
    owner_uuid = uuid.UUID(store.admit_kwargs["owner_id"].removeprefix("dispatch:"))
    assert owner_uuid != lease_uuid
    assert store.heartbeat_kwargs[0]["owner_id"] == store.admit_kwargs["owner_id"]
    assert store.release_kwargs[0]["owner_id"] == store.admit_kwargs["owner_id"]
    assert signer.claims is not None
    assert signer.claims.jti == store.admit_kwargs["lease_id"]
    assert signer.claims.owner is None
    assert signer.claims.operation is None
    assert store.hard_deadline_ms is not None
    assert signer.claims.exp == store.hard_deadline_ms // 1000


@pytest.mark.asyncio
async def test_resident_authority_marks_missing_outcome_uncertain(monkeypatch) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    async with factory(_request(subject)):
        pass

    assert events[-2:] == ["uncertain", "close"]
    assert "release" not in events
    assert store.admit_kwargs is not None
    assert store.uncertain_kwargs[0]["owner_id"] == store.admit_kwargs["owner_id"]


@pytest.mark.asyncio
async def test_resident_authority_releases_when_horizon_revalidation_fails(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)

    async def reject_horizon(*args, **kwargs):
        events.append("horizon")
        raise GPUResidentRuntimeSubjectError("runtime_subject_changed")

    monkeypatch.setattr(
        authority_module,
        "record_gpu_resident_runtime_token_expiry",
        reject_horizon,
    )
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.NOT_READY.value
    assert "sign" not in events
    assert events[-2:] == ["release", "close"]


@pytest.mark.asyncio
async def test_resident_authority_cleans_up_same_lease_after_admit_error(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events, admission_status="error")
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert store.admit_kwargs is not None
    assert store.release_kwargs[0]["lease_id"] == store.admit_kwargs["lease_id"]
    assert store.release_kwargs[0]["owner_id"] == store.admit_kwargs["owner_id"]
    assert store.admit_attempts == 2
    assert events[-4:] == ["admit", "admit", "release", "close"]


@pytest.mark.asyncio
async def test_resident_authority_releases_when_pre_yield_heartbeat_fails(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events, heartbeat_status="stale")
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert events[-3:] == ["heartbeat", "release", "close"]


@pytest.mark.asyncio
async def test_resident_authority_releases_when_signing_fails(monkeypatch) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events, fail=True)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert events[-3:] == ["sign", "release", "close"]


@pytest.mark.asyncio
async def test_resident_authority_heartbeats_until_response(monkeypatch) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        heartbeat_ttl_ms=1_000,
        heartbeat_interval_seconds=0.001,
    )

    async with factory(_request(subject)) as grant:
        for _ in range(100):
            if events.count("heartbeat") >= 3:
                break
            await asyncio.sleep(0.001)
        assert events.count("heartbeat") >= 3
        grant.report_response(200)

    assert events[-2:] == ["release", "close"]


@pytest.mark.asyncio
async def test_resident_authority_maps_concurrency_and_rejects_unload_before_io(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events, admission_status="concurrency_saturated")
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        admission_timeout_seconds=0.001,
        queue_poll_interval_seconds=0.001,
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")
    assert caught.value.error_code == (
        GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED.value
    )
    assert caught.value.headers == {"Retry-After": "1"}
    assert events[-1] == "close"

    events.clear()
    with pytest.raises(GPUArbiterDispatchError) as unload:
        async with factory(
            _request(
                subject,
                operation="unload",
                scope=AdmissionScope.UNLOAD,
            )
        ):
            raise AssertionError("unload must not enter workload authority")
    assert unload.value.error_code == GPUArbiterErrorCode.NOT_READY.value
    assert events == []


@pytest.mark.asyncio
async def test_resident_authority_waits_in_backend_fifo_and_consumes_exact_ticket(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(
        events,
        admission_statuses=[
            "concurrency_saturated",
            "concurrency_saturated",
            "admitted",
        ],
    )
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        admission_timeout_seconds=1,
        queue_poll_interval_seconds=0.001,
    )

    async with factory(_request(subject)) as grant:
        grant.report_response(200)

    assert store.admit_attempts == 3
    assert len(store.backend_enqueue_kwargs) == 1
    queued = store.backend_enqueue_kwargs[0]
    ticket_id = queued["ticket_id"]
    assert queued["backend_id"] == str(subject.backend_registry_id)
    assert queued["membership_epoch"] == subject.membership_epoch
    assert queued["owner_id"] == store.admit_kwargs_history[0]["owner_id"]
    assert 0 < queued["ttl_ms"] <= 1_000
    assert "backend_ticket_id" not in store.admit_kwargs_history[0]
    assert [item["backend_ticket_id"] for item in store.admit_kwargs_history[1:]] == [
        ticket_id,
        ticket_id,
    ]
    assert store.queue_cancel_kwargs == []
    assert events.index("backend_enqueue") < events.index("horizon")


@pytest.mark.asyncio
async def test_fifo_enqueue_retry_keeps_original_deadline(monkeypatch) -> None:
    events: list[str] = []
    store = _RecordingStore(events)
    attempts: list[dict] = []

    async def lose_first_enqueue_response(resource_id: str, **kwargs):
        attempts.append({"resource_id": resource_id, **kwargs})
        if len(attempts) == 1:
            await asyncio.sleep(0.02)
            raise TimeoutError("enqueue response lost")
        return GPUQueueResult(
            status="queued",
            ticket_id=kwargs["ticket_id"],
            position=1,
            expires_at_ms=int(time.time() * 1000) + kwargs["ttl_ms"],
        )

    monkeypatch.setattr(store, "enqueue_backend", lose_first_enqueue_response)
    ticket = await authority_module._enqueue_fifo_ticket(
        store,  # type: ignore[arg-type]
        _RESOURCE_ID,
        backend_id="backend:test",
        membership_epoch=3,
        ticket_id="backend:ticket",
        owner_id="dispatch:owner",
        deadline=time.monotonic() + 0.2,
        card_queue=False,
    )

    assert ticket.status == "queued"
    assert len(attempts) == 2
    assert attempts[0]["ticket_id"] == attempts[1]["ticket_id"]
    assert attempts[0]["owner_id"] == attempts[1]["owner_id"]
    assert 0 < attempts[1]["ttl_ms"] < attempts[0]["ttl_ms"] <= 200


@pytest.mark.asyncio
async def test_resident_uncertain_admit_then_rejection_keeps_exact_cleanup(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(
        events,
        admission_statuses=["error", "concurrency_saturated"],
    )
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert store.admit_attempts == 2
    assert store.backend_enqueue_kwargs == []
    assert len(store.release_kwargs) == 1
    assert (
        store.release_kwargs[0]["lease_id"]
        == (store.admit_kwargs_history[0]["lease_id"])
    )
    assert (
        store.release_kwargs[0]["owner_id"]
        == (store.admit_kwargs_history[0]["owner_id"])
    )
    assert events[-2:] == ["release", "close"]


@pytest.mark.asyncio
async def test_resident_backend_fifo_timeout_cancels_ticket_before_store_close(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events, admission_status="concurrency_saturated")
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        admission_timeout_seconds=0.001,
        queue_poll_interval_seconds=0.001,
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == (
        GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED.value
    )
    assert caught.value.headers == {"Retry-After": "1"}
    assert len(store.backend_enqueue_kwargs) == 1
    assert len(store.queue_cancel_kwargs) == 1
    assert store.queue_cancel_kwargs[0]["card_queue"] is False
    assert (
        store.queue_cancel_kwargs[0]["ticket_id"]
        == (store.backend_enqueue_kwargs[0]["ticket_id"])
    )
    assert events[-2:] == ["backend_cancel", "close"]


@pytest.mark.asyncio
async def test_resident_authority_finishes_uncertain_cleanup_under_repeated_cancel(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _subject()
    store = _RecordingStore(events)
    store.block_uncertain = True
    signer = _RecordingSigner(events)
    _install_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )
    entered = asyncio.Event()

    async def dispatch() -> None:
        async with factory(_request(subject)):
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(dispatch())
    await entered.wait()
    task.cancel()
    await store.uncertain_entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert task.done() is False
    store.uncertain_release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert events[-2:] == ["uncertain", "close"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", (200, 503))
async def test_cold_authority_orders_generation_reservation_and_loading(
    monkeypatch,
    status_code: int,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)

    def load_signer():
        events.append("signer")
        return signer

    def open_store():
        events.append("store")
        return store

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=open_store,  # type: ignore[arg-type]
        signer_factory=load_signer,  # type: ignore[arg-type]
    )
    async with factory(_request(subject)) as grant:
        events.append("yield")
        assert grant.generation == "8"
        assert grant.report_response(status_code) is True

    ordered = [
        "signer",
        "store",
        "ping",
        "card_enqueue",
        "cold_owner",
        "prepare",
        "cold_revalidate",
        "admit",
        "sign",
        "heartbeat",
        "transition:loading",
        "yield",
        "health",
        "terminal:resident",
        "release",
        "close",
    ]
    assert [event for event in events if event in ordered] == ordered
    assert store.admit_kwargs is not None
    assert store.admit_kwargs["require_cold_owner"] is True
    assert store.admit_kwargs["evictable"] is False
    assert store.admit_kwargs["generation"] == "8"
    assert (
        store.admit_kwargs["card_ticket_id"]
        == (store.card_enqueue_kwargs[0]["ticket_id"])
    )
    assert store.card_enqueue_kwargs[0]["owner_id"] == (store.admit_kwargs["owner_id"])
    assert store.cold_owner_kwargs[0]["owner_id"] == store.admit_kwargs["owner_id"]
    assert store.cold_revalidate_kwargs[0]["owner_id"] == store.admit_kwargs["owner_id"]
    assert signer.claims is not None
    assert signer.claims.generation == "8"
    assert signer.claims.jti == store.admit_kwargs["lease_id"]
    assert store.hard_deadline_ms is not None
    assert signer.claims.exp == store.hard_deadline_ms // 1000
    assert len(store.release_kwargs) == 1
    assert store.uncertain_kwargs == []


@pytest.mark.asyncio
async def test_cold_authority_waits_for_card_fifo_head_before_capacity_or_owner(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events, card_queue_positions=[2, 2, 1])
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        admission_timeout_seconds=1,
        queue_poll_interval_seconds=0.001,
    )

    async with factory(_request(subject)) as grant:
        grant.report_response(200)

    assert events.index("card_position:1") < events.index("cold_owner")
    assert events.count("card_position:2") == 2
    assert len(store.card_enqueue_kwargs) == 1
    assert len(store.queue_position_kwargs) == 3
    assert all(item["card_queue"] is True for item in store.queue_position_kwargs)
    assert (store.admit_kwargs or {})["card_ticket_id"] == (
        store.card_enqueue_kwargs[0]["ticket_id"]
    )
    assert store.queue_cancel_kwargs == []


@pytest.mark.asyncio
async def test_cold_card_fifo_timeout_cancels_ticket_without_capacity_work(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events, card_queue_positions=[2])
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        admission_timeout_seconds=0.001,
        queue_poll_interval_seconds=0.001,
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert caught.value.headers == {"Retry-After": "1"}
    assert "cold_owner" not in events
    assert "prepare" not in events
    assert "admit" not in events
    assert len(store.queue_cancel_kwargs) == 1
    assert store.queue_cancel_kwargs[0]["card_queue"] is True
    assert events[-2:] == ["card_cancel", "close"]


@pytest.mark.asyncio
async def test_cold_card_fifo_cancellation_cleans_ticket_before_store_close(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events, card_queue_positions=[2])
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        admission_timeout_seconds=1,
        queue_poll_interval_seconds=1,
    )

    async def dispatch() -> None:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    task = asyncio.create_task(dispatch())
    for _ in range(100):
        if "card_enqueue" in events:
            break
        await asyncio.sleep(0)
    assert "card_enqueue" in events
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert "cold_owner" not in events
    assert len(store.queue_cancel_kwargs) == 1
    assert (
        store.queue_cancel_kwargs[0]["ticket_id"]
        == (store.card_enqueue_kwargs[0]["ticket_id"])
    )
    assert events[-2:] == ["card_cancel", "close"]


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal_status", ("finalized", "stale"))
async def test_cold_authority_keeps_unknown_or_stale_terminal_lease_uncertain(
    monkeypatch,
    terminal_status: str,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(
        monkeypatch,
        events,
        subject,
        terminal_state=GPUAllocationState.UNKNOWN,
        terminal_status=terminal_status,
    )
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    async with factory(_request(subject)) as grant:
        grant.report_response(200)

    assert events[-4:] == [
        "health",
        "terminal:unknown",
        "uncertain",
        "close",
    ]
    assert store.release_kwargs == []
    assert len(store.uncertain_kwargs) == 1


@pytest.mark.asyncio
async def test_cold_authority_heartbeats_through_terminal_commit(monkeypatch) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    prepared = _install_cold_authority_fakes(monkeypatch, events, subject)

    async def commit_after_heartbeat(
        session_factory,
        passed_store,
        expected_subject,
        *,
        challenge: str | None,
        lease_id: str,
        owner_id: str,
    ) -> GPUColdTerminalCommitResult:
        assert passed_store is store
        assert expected_subject.generation == prepared.generation
        assert challenge == "a" * 64
        heartbeat_count = events.count("heartbeat")
        for _ in range(100):
            if events.count("heartbeat") > heartbeat_count:
                break
            await asyncio.sleep(0.001)
        assert events.count("heartbeat") > heartbeat_count
        events.append("terminal:resident")
        return GPUColdTerminalCommitResult(
            status="finalized",
            state=GPUAllocationState.RESIDENT,
            reason="resident",
        )

    monkeypatch.setattr(
        authority_module,
        "commit_gpu_cold_terminal_from_health",
        commit_after_heartbeat,
    )
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        heartbeat_ttl_ms=1_000,
        heartbeat_interval_seconds=0.001,
    )

    async with factory(_request(subject)) as grant:
        grant.report_response(200)

    assert events[-2:] == ["release", "close"]


@pytest.mark.asyncio
async def test_cold_authority_releases_intent_when_revalidation_is_missing(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events, cold_revalidate_status="missing")
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.NOT_READY.value
    assert "prepare" in events
    assert "admit" not in events
    assert "sign" not in events
    assert events[-3:] == ["cold_release", "card_cancel", "close"]
    assert store.cold_release_kwargs[0]["generation"] == "8"


@pytest.mark.asyncio
async def test_cold_authority_rolls_back_unexposed_signing_failure(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events, fail=True)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert events[-3:] == ["finalize:unloaded", "release", "close"]
    assert store.uncertain_kwargs == []
    assert (
        store.finalize_kwargs[-1]["request_owner_id"]
        == (store.admit_kwargs or {})["owner_id"]
    )


@pytest.mark.asyncio
async def test_cold_authority_rolls_back_invalid_unexposed_grant(monkeypatch) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events, token=" ")
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert events[-3:] == ["finalize:unloaded", "release", "close"]
    assert store.uncertain_kwargs == []


@pytest.mark.asyncio
async def test_cold_authority_retries_exact_admission_after_response_loss(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events, admission_status="error_once")
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    async with factory(_request(subject)) as grant:
        grant.report_uncertain_if_missing("request_aborted")

    assert store.admit_attempts == 2
    assert events.count("admit") == 2
    assert "transition:loading" in events
    assert "health" not in events
    assert events[-3:] == ["terminal:unknown", "uncertain", "close"]


@pytest.mark.asyncio
async def test_cold_authority_rolls_back_when_exact_admission_retry_is_lost(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events, admission_status="error")
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert store.admit_attempts == 2
    assert events[-5:] == [
        "finalize:unloaded",
        "release",
        "cold_release",
        "card_cancel",
        "close",
    ]
    assert store.uncertain_kwargs == []


@pytest.mark.asyncio
async def test_cold_uncertain_admit_then_rejection_keeps_exact_cleanup(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(
        events,
        admission_statuses=["error", "card_queued"],
    )
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    assert store.admit_attempts == 2
    assert len(store.finalize_kwargs) == 1
    assert store.finalize_kwargs[0]["target_state"] is GPUAllocationState.UNLOADED
    assert len(store.release_kwargs) == 1
    assert (
        store.release_kwargs[0]["lease_id"]
        == (store.admit_kwargs_history[0]["lease_id"])
    )
    assert (
        store.release_kwargs[0]["owner_id"]
        == (store.admit_kwargs_history[0]["owner_id"])
    )
    assert events[-5:] == [
        "finalize:unloaded",
        "release",
        "cold_release",
        "card_cancel",
        "close",
    ]


@pytest.mark.asyncio
async def test_cold_authority_uses_durable_horizon_when_it_is_earlier(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events)
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    config = Settings(_env_file=None, ml_predict_timeout=1)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        config=config,
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )

    async with factory(_request(subject)) as grant:
        grant.report_response(200)

    assert signer.claims is not None
    assert signer.claims.exp == int(
        (subject.db_now + timedelta(seconds=31)).timestamp()
    )


@pytest.mark.asyncio
async def test_cold_authority_rejects_invalid_ttl_before_secret_redis_or_prepare(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    _install_cold_authority_fakes(monkeypatch, events, subject)

    def load_signer():
        events.append("signer")
        raise AssertionError("signer must not be loaded")

    def open_store():
        events.append("store")
        raise AssertionError("store must not be opened")

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        config=Settings(_env_file=None, ml_predict_timeout=3_000_000),
        store_factory=open_store,  # type: ignore[arg-type]
        signer_factory=load_signer,  # type: ignore[arg-type]
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.CONFIG_INVALID.value
    assert "signer" not in events
    assert "store" not in events
    assert "prepare" not in events


@pytest.mark.asyncio
async def test_cold_authority_finishes_uncertain_cleanup_under_repeated_cancel(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = _cold_subject()
    store = _RecordingStore(events)
    store.block_uncertain = True
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
    )
    entered = asyncio.Event()

    async def dispatch() -> None:
        async with factory(_request(subject)):
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(dispatch())
    await entered.wait()
    task.cancel()
    await store.uncertain_entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert task.done() is False
    store.uncertain_release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert "health" not in events
    assert events[-3:] == ["terminal:unknown", "uncertain", "close"]


@pytest.mark.asyncio
async def test_cold_authority_rejects_exhausted_generation_before_secret_or_redis(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = replace(
        _cold_subject(),
        generation_high_water=9_223_372_036_854_775_807,
    )
    _install_cold_authority_fakes(monkeypatch, events, subject)

    def load_signer():
        events.append("signer")
        raise AssertionError("signer must not be loaded")

    def open_store():
        events.append("store")
        raise AssertionError("store must not be opened")

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=open_store,  # type: ignore[arg-type]
        signer_factory=load_signer,  # type: ignore[arg-type]
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.NOT_READY.value
    assert "signer" not in events
    assert "store" not in events


def test_idle_victim_hint_uses_priority_lru_and_protects_higher_priority() -> None:
    requester = replace(
        _cold_subject(),
        budget_mb=4096,
        eviction_priority=2,
    )
    oldest_same_priority = _allocation(
        uuid.UUID(int=2),
        budget_mb=2048,
        generation="3",
        eviction_priority=1,
        last_used_at_ms=10,
    )
    newer_same_priority = _allocation(
        uuid.UUID(int=1),
        budget_mb=2048,
        generation="3",
        eviction_priority=1,
        last_used_at_ms=20,
    )
    lower_priority = _allocation(
        uuid.UUID(int=3),
        budget_mb=2048,
        generation="3",
        eviction_priority=0,
        last_used_at_ms=30,
    )
    snapshot = _card_snapshot(
        requester.gpu_resource_id,
        allocatable_mb=6144,
        allocations=(
            oldest_same_priority,
            newer_same_priority,
            lower_priority,
        ),
    )

    assert authority_module._idle_victim_hint(snapshot, requester) is lower_priority

    tied_snapshot = _card_snapshot(
        requester.gpu_resource_id,
        allocatable_mb=4096,
        allocations=(newer_same_priority, oldest_same_priority),
    )
    assert (
        authority_module._idle_victim_hint(tied_snapshot, requester)
        is oldest_same_priority
    )

    protected = _allocation(
        uuid.UUID(int=4),
        budget_mb=4096,
        generation="3",
        eviction_priority=3,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        authority_module._idle_victim_hint(
            _card_snapshot(
                requester.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(protected,),
            ),
            requester,
        )
    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert caught.value.headers == {"Retry-After": "1"}


def test_idle_victim_hint_does_not_evict_for_an_allocated_requester() -> None:
    requester = _cold_subject()
    requester_allocation = replace(
        _allocation(
            requester.backend_registry_id,
            budget_mb=requester.budget_mb,
            generation="8",
        ),
        state=GPUAllocationState.RESERVING,
        evictable=False,
        reservation_lease_id="workload:existing",
        reservation_owner_id="dispatch:existing",
    )
    victim = _allocation(
        uuid.UUID(int=6),
        budget_mb=4096,
        generation="3",
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        authority_module._idle_victim_hint(
            _card_snapshot(
                requester.gpu_resource_id,
                allocatable_mb=8192,
                allocations=(requester_allocation, victim),
            ),
            requester,
        )

    assert caught.value.error_code == GPUArbiterErrorCode.NOT_READY.value


@pytest.mark.asyncio
async def test_eviction_heartbeat_fails_at_hard_deadline() -> None:
    events: list[str] = []
    victim = _allocation(
        uuid.UUID(int=5),
        budget_mb=2048,
        generation="3",
    )
    idle = _idle_eviction_subject(
        victim,
        _RESOURCE_ID,
        challenge="a" * 64,
    )
    prepared = _prepared_idle_eviction_subject(
        idle,
        token_expires_at=datetime.now(UTC) + timedelta(seconds=30),
    )
    store = _RecordingStore(events)

    with pytest.raises(GPUArbiterStoreError, match="hard deadline"):
        await authority_module._heartbeat_eviction_owner(
            store,  # type: ignore[arg-type]
            prepared,
            owner_id="evict:test",
            heartbeat_ttl_ms=30_000,
            heartbeat_interval_seconds=1,
            hard_deadline_ms=int(time.time() * 1000) - 1,
        )

    await authority_module._heartbeat_runtime_lease(
        store,  # type: ignore[arg-type]
        _subject(),
        lease_id="workload:test",
        owner_id="dispatch:test",
        heartbeat_ttl_ms=15_000,
        heartbeat_interval_seconds=1,
        hard_deadline_ms=int(time.time() * 1000) - 1,
    )
    assert events == []


@pytest.mark.asyncio
async def test_cold_capacity_deadline_stops_before_next_victim(monkeypatch) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=10),
        budget_mb=2048,
        generation="6",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            )
        ],
    )
    signer = _RecordingSigner(events)
    eviction_attempts = 0

    async def finish_first_victim_after_deadline(*args, **kwargs) -> str:
        nonlocal eviction_attempts
        eviction_attempts += 1
        await asyncio.sleep(0.02)
        return "unloaded"

    monkeypatch.setattr(
        authority_module,
        "_evict_one_idle_victim",
        finish_first_victim_after_deadline,
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        await authority_module._ensure_cold_capacity(
            _session_factory(events),
            store,  # type: ignore[arg-type]
            signer,  # type: ignore[arg-type]
            subject,
            health_refresher=lambda backend_id, challenge: asyncio.sleep(
                0,
                result=True,
            ),
            hard_ttl_ms=120_000,
            heartbeat_interval_seconds=5,
            queue_deadline=time.monotonic()
            + authority_module._GPU_RUNTIME_EVICTION_CLEANUP_RESERVE_SECONDS
            + 0.01,
            ticket_expires_at_ms=int(time.time() * 1000)
            + int(authority_module._GPU_RUNTIME_EVICTION_CLEANUP_RESERVE_SECONDS * 1000)
            + 1_000,
            requester_card_ticket_id="card:ticket",
            requester_queue_owner_id="dispatch:owner",
        )

    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert caught.value.headers == {"Retry-After": "1"}
    assert eviction_attempts == 1
    assert events.count(f"snapshot:{subject.gpu_resource_id}") == 1


@pytest.mark.asyncio
async def test_cold_eviction_timeout_reserves_owner_for_unknown_cleanup(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=15),
        budget_mb=4096,
        generation="6",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            )
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    prepared_by_id = _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )
    owner_hard_deadline_ms: int | None = None
    original_begin = store.begin_idle_eviction

    async def record_owner_deadline(resource_id: str, **kwargs):
        nonlocal owner_hard_deadline_ms
        result = await original_begin(resource_id, **kwargs)
        owner_hard_deadline_ms = result.owner_hard_deadline_ms
        return result

    monkeypatch.setattr(store, "begin_idle_eviction", record_owner_deadline)

    class BlockingDrainClient:
        def __init__(self, backend: MLBackendRegistry) -> None:
            self.backend_id = backend.id

        async def lifecycle_drain(self, grant):
            events.append(f"drain:{self.backend_id}")
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                events.append(f"drain_cancelled:{self.backend_id}")
                raise

    monkeypatch.setattr(authority_module, "MLBackendClient", BlockingDrainClient)

    async def commit_unknown(
        session_factory,
        arbiter_store,
        expected_subject: GPUPreparedIdleEvictionRuntimeSubject,
        *,
        phase: str,
        challenge: str | None,
        owner_id: str,
    ) -> GPUEvictionCommitResult:
        events.append(f"commit_cleanup:{expected_subject.backend_registry_id}")
        assert expected_subject is prepared_by_id[expected_subject.backend_registry_id]
        assert arbiter_store is store
        assert phase == "drain"
        assert challenge is None
        assert owner_id.startswith("evict:")
        assert owner_hard_deadline_ms is not None
        assert int(time.time() * 1000) < owner_hard_deadline_ms
        return GPUEvictionCommitResult(
            status="finalized",
            state=GPUAllocationState.UNKNOWN,
            reason="eviction_response_uncertain",
        )

    monkeypatch.setattr(
        authority_module,
        "commit_gpu_eviction_phase_from_health",
        commit_unknown,
    )

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
        admission_timeout_seconds=(
            authority_module._GPU_RUNTIME_EVICTION_CLEANUP_RESERVE_SECONDS + 0.5
        ),
    )

    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert caught.value.headers == {"Retry-After": "1"}
    assert f"drain_cancelled:{victim.backend_id}" in events
    assert f"commit_cleanup:{victim.backend_id}" in events
    assert f"eviction_release:{victim.backend_id}" in events
    assert events.index(f"commit_cleanup:{victim.backend_id}") < events.index(
        f"eviction_release:{victim.backend_id}"
    )
    assert "cold_owner" not in events
    assert events[-2:] == ["card_cancel", "close"]


@pytest.mark.asyncio
async def test_cold_authority_evicts_multiple_idle_victims_before_target_owner(
    monkeypatch,
) -> None:
    events: list[str] = []
    resource_id = "node-runtime/index:1"
    subject = replace(
        _cold_subject(),
        gpu_resource_id=resource_id,
        budget_mb=4096,
        eviction_priority=2,
    )
    first_victim = _allocation(
        uuid.UUID(int=11),
        budget_mb=2048,
        generation="7",
        eviction_priority=0,
        last_used_at_ms=20,
    )
    second_victim = _allocation(
        uuid.UUID(int=12),
        budget_mb=2048,
        generation="9",
        eviction_priority=1,
        last_used_at_ms=10,
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                resource_id,
                allocatable_mb=4096,
                allocations=(second_victim, first_victim),
            ),
            _card_snapshot(
                resource_id,
                allocatable_mb=4096,
                allocations=(second_victim,),
            ),
            _card_snapshot(
                resource_id,
                allocatable_mb=4096,
                allocations=(),
            ),
        ],
    )
    signer = _ScopeSigner(events)
    refreshed_subject = replace(
        subject,
        observed_generation="8",
        generation_high_water=8,
        db_now=subject.db_now + timedelta(seconds=1),
    )
    cold_read_challenges: list[str | None] = []
    _install_cold_authority_fakes(
        monkeypatch,
        events,
        subject,
        cold_read_challenges=cold_read_challenges,
        refreshed_subject=refreshed_subject,
    )
    proof_challenges: dict[tuple[uuid.UUID, str], str | None] = {}
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (first_victim, second_victim),
        resource_id,
        proof_challenges=proof_challenges,
    )
    health_challenges: dict[uuid.UUID, list[str]] = {}

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        events.append(f"eviction_health:{backend_id}")
        assert len(challenge) == 64
        health_challenges.setdefault(backend_id, []).append(challenge)
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    async with factory(_request(subject)) as grant:
        grant.report_response(200)

    assert [item["victim_backend_id"] for item in store.begin_kwargs] == [
        first_victim.backend_id,
        second_victim.backend_id,
    ]
    assert all(item["resource_id"] == resource_id for item in store.begin_kwargs)
    card_ticket_id = store.card_enqueue_kwargs[0]["ticket_id"]
    queue_owner_id = store.card_enqueue_kwargs[0]["owner_id"]
    assert all(
        item["requester_card_ticket_id"] == card_ticket_id
        and item["requester_queue_owner_id"] == queue_owner_id
        for item in store.begin_kwargs
    )
    assert (store.admit_kwargs or {})["card_ticket_id"] == card_ticket_id
    assert all(
        item["resource_id"] == resource_id for item in store.eviction_release_kwargs
    )
    cold_owner_index = events.index("cold_owner")
    assert all(
        events.index(f"eviction_release:{victim.backend_id}") < cold_owner_index
        for victim in (first_victim, second_victim)
    )
    assert events.count("cold_subject") == 3
    assert events.count(f"eviction_health:{first_victim.backend_id}") == 3
    assert events.count(f"eviction_health:{second_victim.backend_id}") == 3
    assert events.count(f"eviction_health:{subject.backend_registry_id}") == 1
    assert cold_read_challenges == [
        None,
        None,
        health_challenges[subject.backend_registry_id][0],
    ]
    assert store.cold_owner_kwargs[0]["generation"] == "9"
    assert (store.admit_kwargs or {})["generation"] == "9"
    for victim in (first_victim, second_victim):
        backend_id = uuid.UUID(victim.backend_id)
        challenges = health_challenges[backend_id]
        assert len(challenges) == len(set(challenges)) == 3
        assert challenges == [
            proof_challenges[(backend_id, "initial")],
            proof_challenges[(backend_id, "drain")],
            proof_challenges[(backend_id, "unload")],
        ]

    eviction_claims = [
        claims for claims in signer.claims_history if claims.owner is not None
    ]
    assert len(eviction_claims) == 4
    by_backend: dict[str, list[AdmissionTokenClaims]] = {}
    for claims in eviction_claims:
        by_backend.setdefault(claims.backend_registry_id, []).append(claims)
        assert claims.operation == "evict"
        assert claims.gpu_resource_id == resource_id
    assert set(by_backend) == {first_victim.backend_id, second_victim.backend_id}
    for claims in by_backend.values():
        assert {item.scope for item in claims} == {
            AdmissionScope.DRAIN,
            AdmissionScope.UNLOAD,
        }
        assert len({item.jti for item in claims}) == 2
        assert len({item.owner for item in claims}) == 1
        assert len({item.generation for item in claims}) == 1


@pytest.mark.asyncio
async def test_cold_authority_rereads_target_after_eviction_before_issuing_owner(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=13),
        budget_mb=4096,
        generation="6",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            ),
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(),
            ),
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )
    cold_reads = 0

    async def read_cold(
        db,
        *,
        backend_id: str,
        gpu_resource_id: str,
        expected_challenge: str | None = None,
    ):
        nonlocal cold_reads
        cold_reads += 1
        events.append("cold_subject")
        if cold_reads <= 2:
            assert expected_challenge is None
            return subject
        assert expected_challenge is not None
        raise authority_module.GPUColdRuntimeSubjectError("cold_runtime_not_ready")

    monkeypatch.setattr(authority_module, "read_gpu_cold_runtime_subject", read_cold)

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        events.append(f"eviction_health:{backend_id}")
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.NOT_READY.value
    assert cold_reads == 3
    assert f"eviction_release:{victim.backend_id}" in events
    assert f"eviction_health:{subject.backend_registry_id}" in events
    assert "cold_owner" not in events
    assert "prepare" not in events


@pytest.mark.parametrize(
    ("health_failure", "expected_code"),
    (
        ("false", GPUArbiterErrorCode.NOT_READY),
        ("raise", GPUArbiterErrorCode.UNAVAILABLE),
    ),
)
@pytest.mark.asyncio
async def test_target_health_failure_after_eviction_blocks_cold_owner(
    monkeypatch,
    health_failure: str,
    expected_code: GPUArbiterErrorCode,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=14),
        budget_mb=4096,
        generation="6",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            ),
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(),
            ),
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        if backend_id == subject.backend_registry_id:
            if health_failure == "raise":
                raise TimeoutError("target health unavailable")
            return False
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == expected_code.value
    assert events.count("cold_subject") == 2
    assert f"eviction_release:{victim.backend_id}" in events
    assert "cold_owner" not in events
    assert "prepare" not in events


@pytest.mark.asyncio
async def test_cold_authority_rejects_when_only_higher_priority_victim_exists(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096, eviction_priority=2)
    protected = _allocation(
        uuid.UUID(int=21),
        budget_mb=4096,
        generation="3",
        eviction_priority=3,
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(protected,),
            )
        ],
    )
    signer = _RecordingSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    health_calls: list[uuid.UUID] = []

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        health_calls.append(backend_id)
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert caught.value.headers == {"Retry-After": "1"}
    assert health_calls == []
    assert store.begin_kwargs == []
    assert "cold_owner" not in events
    assert "prepare" not in events
    assert events[-1] == "close"


@pytest.mark.asyncio
async def test_eviction_retries_same_route_token_with_fresh_outcome_channel(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=31),
        budget_mb=4096,
        generation="4",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            ),
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(),
            ),
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    prepared_by_id = _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )
    attempts: dict[str, list] = {"drain": [], "unload": []}
    release_attempts = 0
    original_release = store.release_transition_owner

    async def lose_first_release_response(resource_id: str, **kwargs):
        nonlocal release_attempts
        release_attempts += 1
        if release_attempts == 1:
            await original_release(resource_id, **kwargs)
            raise TimeoutError("release response lost")
        return GPUTransitionOwnerResult(status="missing")

    monkeypatch.setattr(
        store,
        "release_transition_owner",
        lose_first_release_response,
    )

    class RetryClient:
        def __init__(self, backend: MLBackendRegistry) -> None:
            self.backend_id = backend.id

        async def lifecycle_drain(self, grant):
            attempts["drain"].append(grant)
            if len(attempts["drain"]) == 1:
                grant.report_uncertain_if_missing("request_aborted")
                raise RuntimeError("response lost")
            grant.report_response(200)
            return _drain_response(prepared_by_id[self.backend_id])

        async def lifecycle_unload(self, grant):
            attempts["unload"].append(grant)
            if len(attempts["unload"]) == 1:
                grant.report_uncertain_if_missing("request_aborted")
                raise RuntimeError("response lost")
            grant.report_response(200)
            return _unload_response(prepared_by_id[self.backend_id])

    monkeypatch.setattr(authority_module, "MLBackendClient", RetryClient)

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    async with factory(_request(subject)) as grant:
        grant.report_response(200)

    for route_attempts in attempts.values():
        assert len(route_attempts) == 2
        assert route_attempts[0] is not route_attempts[1]
        assert route_attempts[0].admission_token == route_attempts[1].admission_token
    assert attempts["drain"][0].admission_token != attempts["unload"][0].admission_token
    assert release_attempts == 2


@pytest.mark.parametrize("lost_phase", ("drain", "unload"))
@pytest.mark.asyncio
async def test_eviction_replays_lost_terminal_commit_before_cleanup(
    monkeypatch,
    lost_phase: str,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=32),
        budget_mb=4096,
        generation="4",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            ),
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(),
            ),
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )
    commit_calls: list[tuple[str, str | None]] = []
    lost_challenge: str | None = None

    async def lose_terminal_response(
        session_factory,
        passed_store,
        expected_subject,
        *,
        phase: str,
        challenge: str | None,
        owner_id: str,
    ) -> GPUEvictionCommitResult:
        nonlocal lost_challenge
        commit_calls.append((phase, challenge))
        if phase == lost_phase and challenge is not None:
            if lost_challenge is None:
                lost_challenge = challenge
                raise TimeoutError("terminal CAS responses lost")
            assert challenge == lost_challenge
            state = (
                GPUAllocationState.UNLOADING
                if phase == "drain"
                else GPUAllocationState.UNLOADED
            )
            return GPUEvictionCommitResult(
                status="finalized",
                state=state,
                reason=state.value,
                idempotent=True,
            )
        if phase == "drain":
            return GPUEvictionCommitResult(
                status="finalized",
                state=GPUAllocationState.UNLOADING,
                reason="ready_to_unload",
            )
        assert challenge is None
        return GPUEvictionCommitResult(
            status="finalized",
            state=GPUAllocationState.UNKNOWN,
            reason="eviction_response_uncertain",
        )

    monkeypatch.setattr(
        authority_module,
        "commit_gpu_eviction_phase_from_health",
        lose_terminal_response,
    )

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.UNAVAILABLE.value
    if lost_phase == "drain":
        assert [phase for phase, _ in commit_calls] == [
            "drain",
            "drain",
            "unload",
        ]
        assert commit_calls[0][1] == commit_calls[1][1] == lost_challenge
        assert commit_calls[2][1] is None
    else:
        assert [phase for phase, _ in commit_calls] == [
            "drain",
            "unload",
            "unload",
        ]
        assert commit_calls[1][1] == commit_calls[2][1] == lost_challenge
    assert f"eviction_release:{victim.backend_id}" in events
    assert "cold_owner" not in events


@pytest.mark.asyncio
async def test_uncertain_begin_still_runs_conservative_owner_cleanup(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=33),
        budget_mb=4096,
        generation="4",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            )
        ],
    )
    signer = _ScopeSigner(events)
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )
    begin_attempts = 0
    cleanup_calls = 0

    async def uncertain_begin(resource_id: str, **kwargs):
        nonlocal begin_attempts
        begin_attempts += 1
        if begin_attempts == 1:
            raise TimeoutError("begin response lost")
        return GPUIdleEvictionResult(
            status="capacity_available",
            reason="capacity_available",
            committed_mb=0,
            shortfall_mb=0,
        )

    async def reject_cleanup(
        session_factory,
        passed_store,
        expected_subject,
        *,
        phase: str,
        challenge: str | None,
        owner_id: str,
    ) -> GPUEvictionCommitResult:
        nonlocal cleanup_calls
        cleanup_calls += 1
        assert phase == "drain"
        assert challenge is None
        return GPUEvictionCommitResult(
            status="stale",
            state=GPUAllocationState.UNKNOWN,
            reason="redis_missing",
        )

    monkeypatch.setattr(store, "begin_idle_eviction", uncertain_begin)
    monkeypatch.setattr(
        authority_module,
        "commit_gpu_eviction_phase_from_health",
        reject_cleanup,
    )

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        return True

    outcome = await authority_module._evict_one_idle_victim(
        _session_factory(events),
        store,  # type: ignore[arg-type]
        signer,  # type: ignore[arg-type]
        subject,
        victim,
        health_refresher=refresh_health,
        hard_ttl_ms=120_000,
        heartbeat_interval_seconds=5,
        queue_deadline=time.monotonic() + 120,
        ticket_expires_at_ms=int(time.time() * 1000) + 120_000,
    )

    assert outcome == "capacity_available"
    assert begin_attempts == 2
    assert cleanup_calls == 1
    assert store.eviction_release_kwargs == []


@pytest.mark.asyncio
async def test_uncertain_victim_stops_before_evicting_another_or_target(
    monkeypatch,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    first_victim = _allocation(
        uuid.UUID(int=41),
        budget_mb=2048,
        generation="4",
        eviction_priority=0,
    )
    second_victim = _allocation(
        uuid.UUID(int=42),
        budget_mb=2048,
        generation="4",
        eviction_priority=1,
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(first_victim, second_victim),
            )
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (first_victim, second_victim),
        subject.gpu_resource_id,
    )

    class InvalidDrainClient:
        def __init__(self, backend: MLBackendRegistry) -> None:
            self.backend_id = backend.id

        async def lifecycle_drain(self, grant):
            events.append(f"invalid_drain:{self.backend_id}")
            grant.report_response(503)
            return object()

        async def lifecycle_unload(self, grant):
            raise AssertionError("unload must not be attempted")

    async def commit_unknown(
        session_factory,
        passed_store,
        expected_subject,
        *,
        phase: str,
        challenge: str | None,
        owner_id: str,
    ) -> GPUEvictionCommitResult:
        events.append(f"commit_unknown:{expected_subject.backend_registry_id}")
        assert phase == "drain"
        assert challenge is None
        return GPUEvictionCommitResult(
            status="finalized",
            state=GPUAllocationState.UNKNOWN,
            reason="eviction_response_uncertain",
        )

    monkeypatch.setattr(authority_module, "MLBackendClient", InvalidDrainClient)
    monkeypatch.setattr(
        authority_module,
        "commit_gpu_eviction_phase_from_health",
        commit_unknown,
    )

    health_calls: list[uuid.UUID] = []

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        health_calls.append(backend_id)
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert [item["victim_backend_id"] for item in store.begin_kwargs] == [
        first_victim.backend_id
    ]
    assert health_calls == [uuid.UUID(first_victim.backend_id)]
    assert "cold_owner" not in events
    assert f"idle_subject:{second_victim.backend_id}" not in events
    assert f"eviction_release:{first_victim.backend_id}" in events


@pytest.mark.parametrize("failed_phase", ("drain", "unload"))
@pytest.mark.parametrize("health_failure", ("false", "raise"))
@pytest.mark.asyncio
async def test_phase_health_failure_converges_unknown_and_stops_eviction(
    monkeypatch,
    failed_phase: str,
    health_failure: str,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=50),
        budget_mb=4096,
        generation="4",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            ),
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(),
            ),
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )
    commit_calls: list[tuple[str, str | None]] = []

    async def commit_phase(
        session_factory,
        passed_store,
        expected_subject,
        *,
        phase: str,
        challenge: str | None,
        owner_id: str,
    ) -> GPUEvictionCommitResult:
        commit_calls.append((phase, challenge))
        state = (
            GPUAllocationState.UNKNOWN
            if challenge is None
            else (
                GPUAllocationState.UNLOADING
                if phase == "drain"
                else GPUAllocationState.UNLOADED
            )
        )
        return GPUEvictionCommitResult(
            status="finalized",
            state=state,
            reason=state.value,
        )

    monkeypatch.setattr(
        authority_module,
        "commit_gpu_eviction_phase_from_health",
        commit_phase,
    )
    victim_health_calls = 0

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        nonlocal victim_health_calls
        assert backend_id == uuid.UUID(victim.backend_id)
        victim_health_calls += 1
        phase = {1: "initial", 2: "drain", 3: "unload"}[victim_health_calls]
        if phase == failed_phase:
            if health_failure == "raise":
                raise TimeoutError("health unavailable")
            return False
        return True

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert commit_calls[-1] == (failed_phase, None)
    assert f"eviction_release:{victim.backend_id}" in events
    assert "cold_owner" not in events
    if failed_phase == "drain":
        assert not any(event.startswith("unload:") for event in events)
        assert victim_health_calls == 2
    else:
        assert any(event.startswith("unload:") for event in events)
        assert victim_health_calls == 3


@pytest.mark.parametrize("health_failure", ("false", "raise"))
@pytest.mark.asyncio
async def test_unavailable_initial_victim_health_sends_no_lifecycle_request(
    monkeypatch,
    health_failure: str,
) -> None:
    events: list[str] = []
    subject = replace(_cold_subject(), budget_mb=4096)
    victim = _allocation(
        uuid.UUID(int=51),
        budget_mb=4096,
        generation="4",
    )
    store = _EvictionStore(
        events,
        [
            _card_snapshot(
                subject.gpu_resource_id,
                allocatable_mb=4096,
                allocations=(victim,),
            )
        ],
    )
    signer = _ScopeSigner(events)
    _install_cold_authority_fakes(monkeypatch, events, subject)
    _install_eviction_authority_fakes(
        monkeypatch,
        events,
        (victim,),
        subject.gpu_resource_id,
    )

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        assert backend_id == uuid.UUID(victim.backend_id)
        if health_failure == "raise":
            raise TimeoutError("health unavailable")
        return False

    factory = authority_module.build_gpu_dispatch_context_factory(
        _session_factory(events),
        store_factory=lambda: store,  # type: ignore[arg-type]
        signer_factory=lambda: signer,  # type: ignore[arg-type]
        health_refresher=refresh_health,
    )
    with pytest.raises(GPUArbiterDispatchError) as caught:
        async with factory(_request(subject)):
            raise AssertionError("grant must not be exposed")

    assert caught.value.error_code == GPUArbiterErrorCode.CAPACITY_UNAVAILABLE.value
    assert store.begin_kwargs == []
    assert not any(event.startswith("drain:") for event in events)
    assert not any(event.startswith("unload:") for event in events)
    assert "cold_owner" not in events
