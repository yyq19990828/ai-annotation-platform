from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
import time
import uuid

import pytest
from aap_protocol_v2.lifecycle import AdmissionScope, AdmissionTokenClaims

from app.config import Settings
from app.services import gpu_dispatch_authority as authority_module
from app.services.gpu_arbiter import (
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUColdRuntimeSubject,
    GPUColdTerminalCommitResult,
    GPUDispatchRequest,
    GPUPreparedColdRuntimeSubject,
    GPUResidentRuntimeSubject,
    GPUResidentRuntimeSubjectError,
)
from app.services.gpu_arbiter_store import (
    GPUAdmissionResult,
    GPUAllocationState,
    GPULeaseMutationResult,
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
        generation="8",
        control_epoch=subject.control_epoch,
        runtime_epoch=subject.runtime_epoch,
        token_expires_at=subject.db_now + timedelta(seconds=120),
        db_now=subject.db_now,
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

    def sign(self, claims: AdmissionTokenClaims) -> str:
        self.events.append("sign")
        self.claims = claims
        if self.fail:
            raise RuntimeError("signing failed")
        return self.token


class _RecordingStore:
    def __init__(
        self,
        events: list[str],
        *,
        admission_status: str = "admitted",
        heartbeat_status: str = "heartbeated",
        cold_owner_status: str = "acquired",
        cold_revalidate_status: str = "renewed",
    ) -> None:
        self.events = events
        self.admission_status = admission_status
        self.heartbeat_status = heartbeat_status
        self.cold_owner_status = cold_owner_status
        self.cold_revalidate_status = cold_revalidate_status
        self.admit_attempts = 0
        self.admit_kwargs: dict | None = None
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
        if self.admission_status == "error" or (
            self.admission_status == "error_once" and self.admit_attempts == 1
        ):
            raise RuntimeError("admission response lost")
        now_ms = int(time.time() * 1000)
        if self.admission_status in {"admitted", "error_once"}:
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
            status=self.admission_status,  # type: ignore[arg-type]
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
) -> GPUPreparedColdRuntimeSubject:
    prepared_subject = prepared or _prepared_cold_subject(subject)

    async def reject_resident(db, *, backend_id: str, gpu_resource_id: str):
        events.append("subject")
        assert backend_id == str(subject.backend_registry_id)
        assert gpu_resource_id == subject.gpu_resource_id
        raise GPUResidentRuntimeSubjectError("resident_runtime_not_ready")

    async def read_cold(db, *, backend_id: str, gpu_resource_id: str):
        events.append("cold_subject")
        assert backend_id == str(subject.backend_registry_id)
        assert gpu_resource_id == subject.gpu_resource_id
        return subject

    async def prepare_cold(
        session_factory,
        expected_subject,
        *,
        token_expires_at: datetime,
    ):
        events.append("prepare")
        assert expected_subject is subject
        assert token_expires_at > subject.db_now
        return replace(prepared_subject, token_expires_at=token_expires_at)

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
        assert expected_subject.generation == prepared_subject.generation
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
    assert events[-3:] == ["admit", "release", "close"]


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
    assert events[-2:] == ["cold_release", "close"]
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
    assert events[-4:] == [
        "finalize:unloaded",
        "release",
        "cold_release",
        "close",
    ]
    assert store.uncertain_kwargs == []


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
