from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
import time
import uuid

import pytest
from aap_protocol_v2.lifecycle import AdmissionScope, AdmissionTokenClaims

from app.services import gpu_dispatch_authority as authority_module
from app.services.gpu_arbiter import (
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUDispatchRequest,
    GPUResidentRuntimeSubject,
    GPUResidentRuntimeSubjectError,
)
from app.services.gpu_arbiter_store import (
    GPUAdmissionResult,
    GPUAllocationState,
    GPULeaseMutationResult,
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


def _request(
    subject: GPUResidentRuntimeSubject,
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
    def __init__(self, events: list[str], *, fail: bool = False) -> None:
        self.events = events
        self.fail = fail
        self.claims: AdmissionTokenClaims | None = None

    def sign(self, claims: AdmissionTokenClaims) -> str:
        self.events.append("sign")
        self.claims = claims
        if self.fail:
            raise RuntimeError("signing failed")
        return "signed-workload-token"


class _RecordingStore:
    def __init__(
        self,
        events: list[str],
        *,
        admission_status: str = "admitted",
        heartbeat_status: str = "heartbeated",
    ) -> None:
        self.events = events
        self.admission_status = admission_status
        self.heartbeat_status = heartbeat_status
        self.admit_kwargs: dict | None = None
        self.heartbeat_kwargs: list[dict] = []
        self.release_kwargs: list[dict] = []
        self.uncertain_kwargs: list[dict] = []
        self.hard_deadline_ms: int | None = None
        self.uncertain_entered = asyncio.Event()
        self.uncertain_release = asyncio.Event()
        self.block_uncertain = False

    async def admit(self, resource_id: str, **kwargs) -> GPUAdmissionResult:
        self.events.append("admit")
        self.admit_kwargs = {"resource_id": resource_id, **kwargs}
        if self.admission_status == "error":
            raise RuntimeError("admission response lost")
        now_ms = int(time.time() * 1000)
        if self.admission_status == "admitted":
            self.hard_deadline_ms = now_ms + 120_000
            return GPUAdmissionResult(
                status="admitted",
                reason="resident_fast_path",
                committed_mb=4096,
                lease_count=1,
                allocation_state=GPUAllocationState.RESIDENT,
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
