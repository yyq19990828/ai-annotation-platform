"""Dormant ADR-0049 authority for Resident and cold GPU dispatch."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
import secrets
import time
import uuid

import structlog
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    AdmissionTokenClaims,
    BackendResidency,
    DrainTransitionResponse,
    ManagedUnloadResponse,
)

from app.config import Settings, settings
from app.services.gpu_admission_signer import GPUAdmissionTokenSigner
from app.services.gpu_arbiter import (
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUColdRuntimeSubject,
    GPUColdRuntimeSubjectError,
    GPUColdTerminalCommitResult,
    GPUDispatchContextFactory,
    GPUDispatchGrant,
    GPUDispatchRequest,
    GPUEvictionCommitResult,
    GPUFenceSessionFactory,
    GPUIdleEvictionRuntimeSubjectError,
    GPUPreparedColdRuntimeSubject,
    GPUPreparedIdleEvictionRuntimeSubject,
    GPUResidentRuntimeSubject,
    GPUResidentRuntimeSubjectError,
    commit_gpu_cold_terminal_from_health,
    commit_gpu_eviction_phase_from_health,
    prepare_gpu_idle_eviction_runtime_generation,
    prepare_gpu_cold_runtime_generation,
    read_gpu_cold_runtime_subject,
    read_gpu_idle_eviction_runtime_subject,
    read_gpu_resident_runtime_subject,
    record_gpu_resident_runtime_token_expiry,
)
from app.services.gpu_arbiter_store import (
    GPU_EVICTION_OPERATION,
    GPUAdmissionResult,
    GPUAllocation,
    GPUAllocationState,
    GPUArbiterStore,
    GPUArbiterStoreError,
    GPUCardSnapshot,
)
from app.services.ml_backend import MLBackendService
from app.services.ml_client import MLBackendClient


logger = structlog.get_logger(__name__)

_GPU_RUNTIME_HEARTBEAT_TTL_MS = 15_000
_GPU_RUNTIME_HEARTBEAT_INTERVAL_SECONDS = 5.0
_GPU_RUNTIME_HARD_DEADLINE_GRACE_SECONDS = 30
_GPU_RUNTIME_MIN_TOKEN_WINDOW_SECONDS = 5
_GPU_RUNTIME_RETRY_AFTER_SECONDS = 1
_GPU_RUNTIME_COLD_INTENT_TTL_MS = 30_000
_GPU_RUNTIME_MAX_EVICTION_ATTEMPTS = 128
_MAX_POSITIVE_INT64 = 9_223_372_036_854_775_807
_MAX_REDIS_TTL_MS = 2_147_483_647
_GPU_RUNTIME_SCOPES = {
    "predict": AdmissionScope.PREDICT,
    "predict_interactive": AdmissionScope.PREDICT,
    "warmup": AdmissionScope.WARMUP,
    "reload": AdmissionScope.RELOAD,
}

GPUArbiterStoreFactory = Callable[[], GPUArbiterStore]
GPUAdmissionSignerFactory = Callable[[], GPUAdmissionTokenSigner]
GPUHealthRefresher = Callable[[uuid.UUID, str], Awaitable[bool]]
GPURuntimeLeaseSubject = GPUResidentRuntimeSubject | GPUPreparedColdRuntimeSubject


def _dispatch_error(
    code: GPUArbiterErrorCode,
    message: str,
    *,
    retry_after_s: int | None = None,
) -> GPUArbiterDispatchError:
    return GPUArbiterDispatchError(
        code,
        message=message,
        retry_after_s=retry_after_s,
    )


def _validate_runtime_request(request: GPUDispatchRequest) -> None:
    expected_scope = _GPU_RUNTIME_SCOPES.get(request.operation)
    if expected_scope is None:
        raise _dispatch_error(
            GPUArbiterErrorCode.NOT_READY,
            "GPU control dispatch authority is not ready",
        )
    if request.scope is not expected_scope:
        raise _dispatch_error(
            GPUArbiterErrorCode.CONFIG_INVALID,
            "GPU dispatch operation and admission scope do not match",
        )


def _map_admission_rejection(result: GPUAdmissionResult) -> GPUArbiterDispatchError:
    if result.status in {"concurrency_saturated", "concurrency_queued"}:
        return _dispatch_error(
            GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED,
            "GPU backend concurrency is saturated",
            retry_after_s=_GPU_RUNTIME_RETRY_AFTER_SECONDS,
        )
    if result.status in {"capacity_unavailable", "card_queued"}:
        return _dispatch_error(
            GPUArbiterErrorCode.CAPACITY_UNAVAILABLE,
            "GPU resident capacity is unavailable",
        )
    if result.status in {
        "not_ready",
        "transition_in_progress",
        "stale_generation",
        "config_mismatch",
    }:
        return _dispatch_error(
            GPUArbiterErrorCode.NOT_READY,
            "GPU resident runtime is not ready",
        )
    return _dispatch_error(
        GPUArbiterErrorCode.UNAVAILABLE,
        "GPU arbiter admission failed",
    )


async def _read_runtime_subject(
    session_factory: GPUFenceSessionFactory,
    request: GPUDispatchRequest,
) -> GPUResidentRuntimeSubject:
    async with session_factory() as db:
        return await read_gpu_resident_runtime_subject(
            db,
            backend_id=request.backend_id,
            gpu_resource_id=request.gpu_resource_id,
        )


async def _read_cold_runtime_subject(
    session_factory: GPUFenceSessionFactory,
    request: GPUDispatchRequest,
    *,
    expected_challenge: str | None = None,
) -> GPUColdRuntimeSubject:
    async with session_factory() as db:
        return await read_gpu_cold_runtime_subject(
            db,
            backend_id=request.backend_id,
            gpu_resource_id=request.gpu_resource_id,
            expected_challenge=expected_challenge,
        )


async def _heartbeat_runtime_lease(
    store: GPUArbiterStore,
    subject: GPURuntimeLeaseSubject,
    *,
    lease_id: str,
    owner_id: str,
    heartbeat_ttl_ms: int,
    heartbeat_interval_seconds: float,
    hard_deadline_ms: int,
) -> None:
    while True:
        remaining_ms = hard_deadline_ms - int(time.time() * 1000)
        if remaining_ms <= 0:
            return
        await asyncio.sleep(min(heartbeat_interval_seconds, remaining_ms / 1000))
        if int(time.time() * 1000) >= hard_deadline_ms:
            return
        result = await store.heartbeat_lease(
            subject.gpu_resource_id,
            backend_id=str(subject.backend_registry_id),
            lease_id=lease_id,
            owner_id=owner_id,
            generation=subject.generation,
            heartbeat_ttl_ms=heartbeat_ttl_ms,
        )
        if result.status != "heartbeated":
            raise GPUArbiterStoreError(
                f"GPU runtime lease heartbeat failed: {result.status}"
            )


async def _stop_heartbeat(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001 - cleanup remains conservative
        logger.warning("gpu_runtime_lease_heartbeat_failed", exc_info=True)


async def _cleanup_runtime_lease(
    store: GPUArbiterStore,
    subject: GPURuntimeLeaseSubject,
    *,
    lease_id: str,
    owner_id: str,
    action: str | None,
    heartbeat_task: asyncio.Task[None] | None,
) -> None:
    await _stop_heartbeat(heartbeat_task)
    if action is not None:
        try:
            if action == "release":
                result = await store.release_lease(
                    subject.gpu_resource_id,
                    backend_id=str(subject.backend_registry_id),
                    lease_id=lease_id,
                    owner_id=owner_id,
                    generation=subject.generation,
                )
                expected_status = "released"
            else:
                result = await store.mark_lease_uncertain(
                    subject.gpu_resource_id,
                    backend_id=str(subject.backend_registry_id),
                    lease_id=lease_id,
                    owner_id=owner_id,
                    generation=subject.generation,
                )
                expected_status = "uncertain"
            if result.status not in {expected_status, "missing"}:
                logger.warning(
                    "gpu_runtime_lease_cleanup_rejected",
                    gpu_arbiter={
                        "backend_id": str(subject.backend_registry_id),
                        "resource_id": subject.gpu_resource_id,
                        "lease_id": lease_id,
                        "action": action,
                        "status": result.status,
                    },
                )
        except Exception:  # noqa: BLE001 - stale lease is the conservative fallback
            logger.warning(
                "gpu_runtime_lease_cleanup_failed",
                gpu_arbiter={
                    "backend_id": str(subject.backend_registry_id),
                    "resource_id": subject.gpu_resource_id,
                    "lease_id": lease_id,
                    "action": action,
                },
                exc_info=True,
            )
    try:
        await store.aclose()
    except Exception:  # noqa: BLE001 - do not replace the business outcome
        logger.warning("gpu_runtime_store_close_failed", exc_info=True)


async def _await_cancellation_safe(cleanup: Awaitable[None]) -> None:
    """Finish cleanup even if the caller is cancelled repeatedly."""

    task = asyncio.create_task(cleanup)
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    if not task.cancelled():
        task.result()
    if cancelled:
        raise asyncio.CancelledError


def _cold_generation_candidate(subject: GPUColdRuntimeSubject) -> str:
    if subject.generation_high_water >= _MAX_POSITIVE_INT64:
        raise _dispatch_error(
            GPUArbiterErrorCode.NOT_READY,
            "GPU runtime generation is exhausted",
        )
    return str(subject.generation_high_water + 1)


def _runtime_hard_ttl_ms(
    config: Settings,
    *,
    heartbeat_ttl_ms: int,
) -> int:
    timeout = config.ml_predict_timeout
    if not isinstance(timeout, int) or isinstance(timeout, bool):
        raise _dispatch_error(
            GPUArbiterErrorCode.CONFIG_INVALID,
            "GPU runtime timeout is invalid",
        )
    hard_ttl_ms = (timeout + _GPU_RUNTIME_HARD_DEADLINE_GRACE_SECONDS) * 1000
    if (
        hard_ttl_ms <= 0
        or hard_ttl_ms > _MAX_REDIS_TTL_MS
        or hard_ttl_ms < heartbeat_ttl_ms
    ):
        raise _dispatch_error(
            GPUArbiterErrorCode.CONFIG_INVALID,
            "GPU runtime hard TTL is invalid",
        )
    return hard_ttl_ms


def _map_cold_owner_rejection(status: str) -> GPUArbiterDispatchError:
    if status in {"busy", "active_leases"}:
        return _dispatch_error(
            GPUArbiterErrorCode.CAPACITY_UNAVAILABLE,
            "GPU cold admission is busy",
        )
    if status in {
        "missing",
        "owner_mismatch",
        "operation_mismatch",
        "not_ready",
        "config_mismatch",
        "stale_generation",
        "invalid_transition",
    }:
        return _dispatch_error(
            GPUArbiterErrorCode.NOT_READY,
            "GPU cold runtime is not ready",
        )
    return _dispatch_error(
        GPUArbiterErrorCode.UNAVAILABLE,
        "GPU cold admission owner failed",
    )


async def _release_cold_intent(
    store: GPUArbiterStore,
    subject: GPUColdRuntimeSubject,
    *,
    owner_id: str,
    generation: str,
) -> None:
    try:
        result = await store.release_cold_admission_owner(
            subject.gpu_resource_id,
            backend_id=str(subject.backend_registry_id),
            owner_id=owner_id,
            generation=generation,
        )
        if result.status not in {"released", "missing"}:
            logger.warning(
                "gpu_cold_intent_cleanup_rejected",
                gpu_arbiter={
                    "backend_id": str(subject.backend_registry_id),
                    "resource_id": subject.gpu_resource_id,
                    "owner_id": owner_id,
                    "generation": generation,
                    "status": result.status,
                },
            )
    except Exception:  # noqa: BLE001 - TTL remains the conservative fallback
        logger.warning(
            "gpu_cold_intent_cleanup_failed",
            gpu_arbiter={
                "backend_id": str(subject.backend_registry_id),
                "resource_id": subject.gpu_resource_id,
                "owner_id": owner_id,
                "generation": generation,
            },
            exc_info=True,
        )


async def _refresh_gpu_health(
    session_factory: GPUFenceSessionFactory,
    backend_id: uuid.UUID,
    challenge: str,
) -> bool:
    async with session_factory() as db:
        healthy = await MLBackendService(db).check_health(
            backend_id,
            gpu_health_challenge=challenge,
        )
        await db.commit()
    return healthy


async def _refresh_cold_terminal_health(
    session_factory: GPUFenceSessionFactory,
    subject: GPUPreparedColdRuntimeSubject,
) -> str:
    challenge = secrets.token_hex(32)
    try:
        await _refresh_gpu_health(
            session_factory,
            subject.backend_registry_id,
            challenge,
        )
    except Exception:  # noqa: BLE001 - the locked classifier falls back to Unknown
        logger.warning(
            "gpu_cold_terminal_health_failed",
            gpu_arbiter={
                "backend_id": str(subject.backend_registry_id),
                "resource_id": subject.gpu_resource_id,
                "generation": subject.generation,
            },
            exc_info=True,
        )
    return challenge


async def _finalize_cold_runtime(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    subject: GPUColdRuntimeSubject,
    *,
    generation: str,
    lease_id: str,
    owner_id: str,
    intent_may_exist: bool,
    lease_may_exist: bool,
    grant_exposed: bool,
    response_received: bool,
    prepared_subject: GPUPreparedColdRuntimeSubject | None,
    heartbeat_task: asyncio.Task[None] | None,
) -> None:
    if lease_may_exist:
        target_state = GPUAllocationState.UNLOADED
        terminal_confirmed = False
        terminal_result: GPUColdTerminalCommitResult | None = None
        if grant_exposed and prepared_subject is not None:
            challenge = None
            if response_received:
                challenge = await _refresh_cold_terminal_health(
                    session_factory,
                    prepared_subject,
                )
            try:
                terminal_result = await commit_gpu_cold_terminal_from_health(
                    session_factory,
                    store,
                    prepared_subject,
                    challenge=challenge,
                    lease_id=lease_id,
                    owner_id=owner_id,
                )
                target_state = terminal_result.state
                terminal_confirmed = terminal_result.status == "finalized"
                if not terminal_confirmed:
                    logger.warning(
                        "gpu_cold_terminal_commit_rejected",
                        gpu_arbiter={
                            "backend_id": str(subject.backend_registry_id),
                            "resource_id": subject.gpu_resource_id,
                            "lease_id": lease_id,
                            "generation": generation,
                            "status": terminal_result.status,
                            "reason": terminal_result.reason,
                        },
                    )
            except Exception:  # noqa: BLE001 - uncertain lease remains conservative
                logger.warning(
                    "gpu_cold_terminal_commit_failed",
                    gpu_arbiter={
                        "backend_id": str(subject.backend_registry_id),
                        "resource_id": subject.gpu_resource_id,
                        "lease_id": lease_id,
                        "generation": generation,
                    },
                    exc_info=True,
                )
        else:
            target_state = (
                GPUAllocationState.UNKNOWN
                if grant_exposed
                else GPUAllocationState.UNLOADED
            )
            try:
                transition = await store.finalize_cold_allocation(
                    subject.gpu_resource_id,
                    backend_id=str(subject.backend_registry_id),
                    expected_generation=generation,
                    request_lease_id=lease_id,
                    request_owner_id=owner_id,
                    target_state=target_state,
                    target_evictable=False,
                )
                terminal_confirmed = transition.status == "transitioned"
                if not terminal_confirmed:
                    logger.warning(
                        "gpu_cold_allocation_cleanup_rejected",
                        gpu_arbiter={
                            "backend_id": str(subject.backend_registry_id),
                            "resource_id": subject.gpu_resource_id,
                            "lease_id": lease_id,
                            "generation": generation,
                            "target_state": target_state.value,
                            "status": transition.status,
                        },
                    )
            except Exception:  # noqa: BLE001 - uncertain lease remains conservative
                logger.warning(
                    "gpu_cold_allocation_cleanup_failed",
                    gpu_arbiter={
                        "backend_id": str(subject.backend_registry_id),
                        "resource_id": subject.gpu_resource_id,
                        "lease_id": lease_id,
                        "generation": generation,
                        "target_state": target_state.value,
                    },
                    exc_info=True,
                )
        await _stop_heartbeat(heartbeat_task)
        try:
            if terminal_confirmed and target_state is not GPUAllocationState.UNKNOWN:
                cleanup = await store.release_lease(
                    subject.gpu_resource_id,
                    backend_id=str(subject.backend_registry_id),
                    lease_id=lease_id,
                    owner_id=owner_id,
                    generation=generation,
                )
                expected_status = "released"
            else:
                cleanup = await store.mark_lease_uncertain(
                    subject.gpu_resource_id,
                    backend_id=str(subject.backend_registry_id),
                    lease_id=lease_id,
                    owner_id=owner_id,
                    generation=generation,
                )
                expected_status = "uncertain"
            if cleanup.status not in {expected_status, "missing"}:
                logger.warning(
                    "gpu_cold_lease_cleanup_rejected",
                    gpu_arbiter={
                        "backend_id": str(subject.backend_registry_id),
                        "resource_id": subject.gpu_resource_id,
                        "lease_id": lease_id,
                        "generation": generation,
                        "status": cleanup.status,
                    },
                )
        except Exception:  # noqa: BLE001 - repair owns conservative residue
            logger.warning(
                "gpu_cold_lease_cleanup_failed",
                gpu_arbiter={
                    "backend_id": str(subject.backend_registry_id),
                    "resource_id": subject.gpu_resource_id,
                    "lease_id": lease_id,
                    "generation": generation,
                },
                exc_info=True,
            )
    if intent_may_exist:
        await _release_cold_intent(
            store,
            subject,
            owner_id=owner_id,
            generation=generation,
        )
    try:
        await store.aclose()
    except Exception:  # noqa: BLE001 - do not replace the business outcome
        logger.warning("gpu_runtime_store_close_failed", exc_info=True)


def _capacity_unavailable(message: str) -> GPUArbiterDispatchError:
    return _dispatch_error(
        GPUArbiterErrorCode.CAPACITY_UNAVAILABLE,
        message,
        retry_after_s=_GPU_RUNTIME_RETRY_AFTER_SECONDS,
    )


def _idle_victim_hint(
    snapshot: GPUCardSnapshot,
    requester: GPUColdRuntimeSubject,
) -> GPUAllocation | None:
    if not snapshot.ready:
        raise _dispatch_error(
            GPUArbiterErrorCode.NOT_READY,
            "GPU card ledger is not ready",
        )
    free_mb = snapshot.allocatable_mb - snapshot.committed_mb
    if requester.budget_mb <= free_mb:
        return None
    if requester.budget_mb > snapshot.allocatable_mb:
        raise _capacity_unavailable("GPU request exceeds allocatable card memory")
    if snapshot.transition_present:
        raise _capacity_unavailable("GPU card transition is already in progress")

    leased_backends = {lease.backend_id for lease in snapshot.leases}
    candidates = sorted(
        (
            allocation
            for allocation in snapshot.allocations
            if allocation.backend_id != str(requester.backend_registry_id)
            and allocation.backend_id in snapshot.active_backend_ids
            and allocation.state is GPUAllocationState.RESIDENT
            and allocation.evictable
            and allocation.generation is not None
            and allocation.eviction_priority <= requester.eviction_priority
            and allocation.backend_id not in leased_backends
        ),
        key=lambda allocation: (
            allocation.eviction_priority,
            allocation.last_used_at_ms,
            allocation.backend_id,
        ),
    )
    shortfall_mb = requester.budget_mb - free_mb
    if sum(item.budget_mb for item in candidates) < shortfall_mb:
        raise _capacity_unavailable("No safe idle GPU victim can satisfy capacity")
    return candidates[0]


async def _heartbeat_eviction_owner(
    store: GPUArbiterStore,
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    owner_id: str,
    heartbeat_ttl_ms: int,
    heartbeat_interval_seconds: float,
    hard_deadline_ms: int,
) -> None:
    while True:
        remaining_ms = hard_deadline_ms - int(time.time() * 1000)
        if remaining_ms <= 0:
            raise GPUArbiterStoreError("GPU eviction owner hard deadline reached")
        await asyncio.sleep(min(heartbeat_interval_seconds, remaining_ms / 1000))
        if int(time.time() * 1000) >= hard_deadline_ms:
            raise GPUArbiterStoreError("GPU eviction owner hard deadline reached")
        result = await store.heartbeat_transition_owner(
            subject.gpu_resource_id,
            backend_id=str(subject.backend_registry_id),
            owner_id=owner_id,
            generation=subject.generation,
            operation=GPU_EVICTION_OPERATION,
            ttl_ms=heartbeat_ttl_ms,
        )
        if result.status != "renewed":
            raise GPUArbiterStoreError(
                f"GPU eviction owner heartbeat failed: {result.status}"
            )


def _raise_if_heartbeat_failed(task: asyncio.Task[None] | None) -> None:
    if task is not None and task.done():
        task.result()


async def _stop_eviction_heartbeat(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001 - terminal CAS remains authoritative
        logger.warning("gpu_eviction_owner_heartbeat_failed", exc_info=True)


async def _release_eviction_owner(
    store: GPUArbiterStore,
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    owner_id: str,
) -> None:
    try:
        release_kwargs = {
            "backend_id": str(subject.backend_registry_id),
            "owner_id": owner_id,
            "generation": subject.generation,
            "operation": GPU_EVICTION_OPERATION,
        }
        try:
            released = await store.release_transition_owner(
                subject.gpu_resource_id,
                **release_kwargs,
            )
        except Exception:
            released = await store.release_transition_owner(
                subject.gpu_resource_id,
                **release_kwargs,
            )
        if released.status not in {"released", "missing"}:
            logger.warning(
                "gpu_eviction_owner_release_rejected",
                gpu_arbiter={
                    "backend_id": str(subject.backend_registry_id),
                    "resource_id": subject.gpu_resource_id,
                    "generation": subject.generation,
                    "owner_id": owner_id,
                    "status": released.status,
                },
            )
    except Exception:  # noqa: BLE001 - owner TTL is the conservative fallback
        logger.warning(
            "gpu_eviction_owner_release_failed",
            gpu_arbiter={
                "backend_id": str(subject.backend_registry_id),
                "resource_id": subject.gpu_resource_id,
                "generation": subject.generation,
                "owner_id": owner_id,
            },
            exc_info=True,
        )


async def _refresh_eviction_health(
    health_refresher: GPUHealthRefresher,
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    phase: str,
) -> str | None:
    challenge = secrets.token_hex(32)
    try:
        if await health_refresher(subject.backend_registry_id, challenge):
            return challenge
    except Exception:  # noqa: BLE001 - phase commit converges to Unknown
        logger.warning(
            "gpu_eviction_health_refresh_failed",
            gpu_arbiter={
                "backend_id": str(subject.backend_registry_id),
                "resource_id": subject.gpu_resource_id,
                "generation": subject.generation,
                "phase": phase,
            },
            exc_info=True,
        )
    return None


def _eviction_ack_identity_matches(
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    generation: str,
    residency: BackendResidency,
) -> bool:
    identity = residency.identity
    return bool(
        generation == subject.generation
        and residency.generation == subject.generation
        and residency.boot_id == subject.boot_id
        and residency.control_epoch == subject.control_epoch
        and identity is not None
        and identity.backend_registry_id == str(subject.backend_registry_id)
        and identity.gpu_resource_id == subject.gpu_resource_id
    )


def _drain_ack_ready(
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    response: DrainTransitionResponse,
) -> bool:
    return bool(
        response.draining
        and response.ready_to_unload
        and response.active_requests == 0
        and _eviction_ack_identity_matches(
            subject,
            generation=response.generation,
            residency=response.residency,
        )
    )


def _unload_ack_matches(
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    response: ManagedUnloadResponse,
) -> bool:
    return bool(
        response.unloaded
        and _eviction_ack_identity_matches(
            subject,
            generation=response.generation,
            residency=response.residency,
        )
    )


async def _call_eviction_lifecycle(
    call: Callable[[GPUDispatchGrant], Awaitable[object]],
    *,
    generation: str,
    admission_token: str,
    hard_deadline_ms: int,
) -> tuple[object | None, bool]:
    for attempt in range(2):
        remaining_seconds = (hard_deadline_ms - int(time.time() * 1000)) / 1000
        if remaining_seconds <= 0:
            return None, False
        grant = GPUDispatchGrant(
            generation=generation,
            admission_token=admission_token,
        )
        try:
            async with asyncio.timeout(remaining_seconds):
                return await call(grant), True
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - outcome decides exact retry eligibility
            response_received = (
                grant.outcome is not None and grant.outcome.kind == "response_received"
            )
            if response_received:
                return None, True
            if attempt == 0:
                continue
    return None, False


def _sign_eviction_grants(
    signer: GPUAdmissionTokenSigner,
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    owner_id: str,
    owner_hard_deadline_ms: int,
) -> tuple[str, str]:
    token_exp = min(
        int(subject.token_expires_at.timestamp()),
        owner_hard_deadline_ms // 1000,
    )
    if (
        token_exp - max(int(time.time()), int(subject.db_now.timestamp()))
        < _GPU_RUNTIME_MIN_TOKEN_WINDOW_SECONDS
    ):
        raise _dispatch_error(
            GPUArbiterErrorCode.UNAVAILABLE,
            "GPU eviction owner has no safe token delivery window",
        )
    common = {
        "backend_registry_id": str(subject.backend_registry_id),
        "gpu_resource_id": subject.gpu_resource_id,
        "boot_id": subject.boot_id,
        "generation": subject.generation,
        "control_epoch": subject.control_epoch,
        "exp": token_exp,
        "owner": owner_id,
        "operation": GPU_EVICTION_OPERATION,
    }
    drain_token = signer.sign(
        AdmissionTokenClaims(
            **common,
            scope=AdmissionScope.DRAIN,
            jti=f"transition:{uuid.uuid4()}",
        )
    )
    unload_token = signer.sign(
        AdmissionTokenClaims(
            **common,
            scope=AdmissionScope.UNLOAD,
            jti=f"transition:{uuid.uuid4()}",
        )
    )
    return drain_token, unload_token


async def _finish_eviction_transition(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    subject: GPUPreparedIdleEvictionRuntimeSubject,
    *,
    owner_id: str,
    phase: str,
    terminal_result: GPUEvictionCommitResult | None,
    replay_challenge: str | None,
    heartbeat_task: asyncio.Task[None] | None,
) -> None:
    confirmed_terminal = bool(
        terminal_result is not None
        and terminal_result.status == "finalized"
        and terminal_result.state
        in {GPUAllocationState.UNLOADED, GPUAllocationState.UNKNOWN}
    )
    cleanup_phase = phase
    if terminal_result is None and replay_challenge is not None:
        try:
            terminal_result = await commit_gpu_eviction_phase_from_health(
                session_factory,
                store,
                subject,
                phase="unload" if phase == "unload" else "drain",
                challenge=replay_challenge,
                owner_id=owner_id,
            )
            confirmed_terminal = bool(
                terminal_result.status == "finalized"
                and terminal_result.state
                in {GPUAllocationState.UNLOADED, GPUAllocationState.UNKNOWN}
            )
            if (
                terminal_result.status == "finalized"
                and terminal_result.state is GPUAllocationState.UNLOADING
            ):
                cleanup_phase = "unload"
        except Exception:  # noqa: BLE001 - fall back to conservative Unknown
            logger.warning(
                "gpu_eviction_terminal_replay_failed",
                gpu_arbiter={
                    "backend_id": str(subject.backend_registry_id),
                    "resource_id": subject.gpu_resource_id,
                    "generation": subject.generation,
                    "phase": phase,
                },
                exc_info=True,
            )
    if not confirmed_terminal:
        try:
            terminal_result = await commit_gpu_eviction_phase_from_health(
                session_factory,
                store,
                subject,
                phase="unload" if cleanup_phase == "unload" else "drain",
                challenge=None,
                owner_id=owner_id,
            )
            confirmed_terminal = bool(
                terminal_result.status == "finalized"
                and terminal_result.state is GPUAllocationState.UNKNOWN
            )
        except Exception:  # noqa: BLE001 - repair owns conservative residue
            logger.warning(
                "gpu_eviction_terminal_cleanup_failed",
                gpu_arbiter={
                    "backend_id": str(subject.backend_registry_id),
                    "resource_id": subject.gpu_resource_id,
                    "generation": subject.generation,
                    "phase": phase,
                },
                exc_info=True,
            )
    await _stop_eviction_heartbeat(heartbeat_task)
    if confirmed_terminal:
        await _release_eviction_owner(
            store,
            subject,
            owner_id=owner_id,
        )


async def _evict_one_idle_victim(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    signer: GPUAdmissionTokenSigner,
    requester: GPUColdRuntimeSubject,
    victim: GPUAllocation,
    *,
    health_refresher: GPUHealthRefresher,
    hard_ttl_ms: int,
    heartbeat_interval_seconds: float,
) -> str:
    challenge = secrets.token_hex(32)
    try:
        victim_id = uuid.UUID(victim.backend_id)
        refreshed = await health_refresher(victim_id, challenge)
    except Exception as exc:
        raise _capacity_unavailable("GPU idle victim health is unavailable") from exc
    if not refreshed:
        raise _capacity_unavailable("GPU idle victim health is unavailable")
    try:
        async with session_factory() as db:
            idle_subject = await read_gpu_idle_eviction_runtime_subject(
                db,
                backend_id=victim.backend_id,
                gpu_resource_id=requester.gpu_resource_id,
                expected_generation=victim.generation or "",
                challenge=challenge,
            )
        prepared = await prepare_gpu_idle_eviction_runtime_generation(
            session_factory,
            idle_subject,
            token_expires_at=idle_subject.db_now + timedelta(milliseconds=hard_ttl_ms),
        )
    except GPUIdleEvictionRuntimeSubjectError as exc:
        raise _capacity_unavailable("GPU idle victim changed before eviction") from exc
    except Exception as exc:
        raise _dispatch_error(
            GPUArbiterErrorCode.UNAVAILABLE,
            "GPU idle victim generation is unavailable",
        ) from exc

    owner_id = f"evict:{uuid.uuid4()}"
    owner_may_exist = True
    heartbeat_task: asyncio.Task[None] | None = None
    terminal_result: GPUEvictionCommitResult | None = None
    replay_challenge: str | None = None
    phase = "drain"
    try:
        begin_kwargs = {
            "requester_backend_id": str(requester.backend_registry_id),
            "requester_membership_epoch": requester.membership_epoch,
            "requester_budget_mb": requester.budget_mb,
            "requester_eviction_priority": requester.eviction_priority,
            "victim_backend_id": str(prepared.backend_registry_id),
            "victim_membership_epoch": prepared.membership_epoch,
            "victim_expected_generation": prepared.source_generation,
            "victim_next_generation": prepared.generation,
            "owner_id": owner_id,
            "ttl_ms": _GPU_RUNTIME_COLD_INTENT_TTL_MS,
            "hard_ttl_ms": hard_ttl_ms,
        }
        begin_uncertain = False
        try:
            selected = await store.begin_idle_eviction(
                requester.gpu_resource_id,
                **begin_kwargs,
            )
        except Exception:
            begin_uncertain = True
            selected = await store.begin_idle_eviction(
                requester.gpu_resource_id,
                **begin_kwargs,
            )
        if selected.status != "selected":
            owner_may_exist = begin_uncertain
            if selected.status == "capacity_available":
                return "capacity_available"
            if selected.status == "stale_selection":
                return "stale"
            if selected.status in {
                "capacity_unavailable",
                "victim_busy",
                "transition_in_progress",
            }:
                raise _capacity_unavailable("GPU idle victim is no longer available")
            if selected.status in {"not_ready", "config_mismatch"}:
                raise _dispatch_error(
                    GPUArbiterErrorCode.NOT_READY,
                    "GPU eviction selection is not ready",
                )
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU eviction selection failed",
            )
        if (
            selected.victim_backend_id != str(prepared.backend_registry_id)
            or selected.victim_generation != prepared.generation
            or selected.victim_budget_mb != prepared.budget_mb
            or selected.owner_id != owner_id
            or selected.owner_expires_at_ms is None
            or selected.owner_hard_deadline_ms is None
            or selected.owner_expires_at_ms > selected.owner_hard_deadline_ms
        ):
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU eviction selection receipt is invalid",
            )

        try:
            drain_token, unload_token = _sign_eviction_grants(
                signer,
                prepared,
                owner_id=owner_id,
                owner_hard_deadline_ms=selected.owner_hard_deadline_ms,
            )
        except GPUArbiterDispatchError:
            raise
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU eviction token signing failed",
            ) from exc
        first_heartbeat = await store.heartbeat_transition_owner(
            prepared.gpu_resource_id,
            backend_id=str(prepared.backend_registry_id),
            owner_id=owner_id,
            generation=prepared.generation,
            operation=GPU_EVICTION_OPERATION,
            ttl_ms=_GPU_RUNTIME_COLD_INTENT_TTL_MS,
        )
        if first_heartbeat.status != "renewed":
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU eviction owner heartbeat failed",
            )
        heartbeat_task = asyncio.create_task(
            _heartbeat_eviction_owner(
                store,
                prepared,
                owner_id=owner_id,
                heartbeat_ttl_ms=_GPU_RUNTIME_COLD_INTENT_TTL_MS,
                heartbeat_interval_seconds=heartbeat_interval_seconds,
                hard_deadline_ms=selected.owner_hard_deadline_ms,
            ),
            name=f"gpu-eviction-heartbeat:{owner_id}",
        )
        client = MLBackendClient(prepared.backend)
        drain_response, _ = await _call_eviction_lifecycle(
            client.lifecycle_drain,
            generation=prepared.generation,
            admission_token=drain_token,
            hard_deadline_ms=selected.owner_hard_deadline_ms,
        )
        if not isinstance(
            drain_response, DrainTransitionResponse
        ) or not _drain_ack_ready(
            prepared,
            drain_response,
        ):
            terminal_result = await commit_gpu_eviction_phase_from_health(
                session_factory,
                store,
                prepared,
                phase="drain",
                challenge=None,
                owner_id=owner_id,
            )
            raise _capacity_unavailable("GPU idle victim did not acknowledge drain")

        drain_challenge = await _refresh_eviction_health(
            health_refresher,
            prepared,
            phase="drain",
        )
        replay_challenge = drain_challenge
        terminal_result = await commit_gpu_eviction_phase_from_health(
            session_factory,
            store,
            prepared,
            phase="drain",
            challenge=drain_challenge,
            owner_id=owner_id,
        )
        if (
            terminal_result.status != "finalized"
            or terminal_result.state is not GPUAllocationState.UNLOADING
        ):
            raise _capacity_unavailable("GPU idle victim drain proof was rejected")

        phase = "unload"
        terminal_result = None
        replay_challenge = None
        _raise_if_heartbeat_failed(heartbeat_task)
        unload_response, unload_response_received = await _call_eviction_lifecycle(
            client.lifecycle_unload,
            generation=prepared.generation,
            admission_token=unload_token,
            hard_deadline_ms=selected.owner_hard_deadline_ms,
        )
        unload_ack_matches = isinstance(
            unload_response,
            ManagedUnloadResponse,
        ) and _unload_ack_matches(prepared, unload_response)
        unload_challenge = None
        if unload_response_received:
            unload_challenge = await _refresh_eviction_health(
                health_refresher,
                prepared,
                phase="unload",
            )
        replay_challenge = unload_challenge
        terminal_result = await commit_gpu_eviction_phase_from_health(
            session_factory,
            store,
            prepared,
            phase="unload",
            challenge=unload_challenge,
            owner_id=owner_id,
        )
        if (
            terminal_result.status != "finalized"
            or terminal_result.state is not GPUAllocationState.UNLOADED
        ):
            raise _capacity_unavailable("GPU idle victim unload proof was rejected")
        if not unload_ack_matches:
            logger.info(
                "gpu_eviction_unload_confirmed_by_health",
                gpu_arbiter={
                    "backend_id": str(prepared.backend_registry_id),
                    "resource_id": prepared.gpu_resource_id,
                    "generation": prepared.generation,
                },
            )
        return "unloaded"
    except GPUArbiterDispatchError:
        raise
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        raise _dispatch_error(
            GPUArbiterErrorCode.UNAVAILABLE,
            "GPU idle victim eviction is unavailable",
        ) from exc
    finally:
        if owner_may_exist:
            await _await_cancellation_safe(
                _finish_eviction_transition(
                    session_factory,
                    store,
                    prepared,
                    owner_id=owner_id,
                    phase=phase,
                    terminal_result=terminal_result,
                    replay_challenge=replay_challenge,
                    heartbeat_task=heartbeat_task,
                )
            )


async def _ensure_cold_capacity(
    session_factory: GPUFenceSessionFactory,
    store: GPUArbiterStore,
    signer: GPUAdmissionTokenSigner,
    requester: GPUColdRuntimeSubject,
    *,
    health_refresher: GPUHealthRefresher,
    hard_ttl_ms: int,
    heartbeat_interval_seconds: float,
) -> bool:
    changed = False
    for _ in range(_GPU_RUNTIME_MAX_EVICTION_ATTEMPTS):
        try:
            snapshot = await store.snapshot(requester.gpu_resource_id)
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU card snapshot is unavailable",
            ) from exc
        victim = _idle_victim_hint(snapshot, requester)
        if victim is None:
            return changed
        outcome = await _evict_one_idle_victim(
            session_factory,
            store,
            signer,
            requester,
            victim,
            health_refresher=health_refresher,
            hard_ttl_ms=hard_ttl_ms,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
        )
        if outcome == "unloaded":
            changed = True
        elif outcome == "capacity_available":
            return changed
    raise _dispatch_error(
        GPUArbiterErrorCode.NOT_READY,
        "GPU eviction selection did not converge",
    )


@asynccontextmanager
async def _dispatch_cold_runtime(
    session_factory: GPUFenceSessionFactory,
    request: GPUDispatchRequest,
    subject: GPUColdRuntimeSubject,
    *,
    config: Settings,
    store_factory: GPUArbiterStoreFactory | None,
    signer_factory: GPUAdmissionSignerFactory | None,
    health_refresher: GPUHealthRefresher,
    heartbeat_ttl_ms: int,
    heartbeat_interval_seconds: float,
):
    generation = _cold_generation_candidate(subject)
    hard_ttl_ms = _runtime_hard_ttl_ms(
        config,
        heartbeat_ttl_ms=heartbeat_ttl_ms,
    )
    signer_builder = signer_factory or (
        lambda: GPUAdmissionTokenSigner.from_settings(config)
    )
    try:
        signer = signer_builder()
    except Exception as exc:
        raise _dispatch_error(
            GPUArbiterErrorCode.NOT_READY,
            "GPU admission signer is not ready",
        ) from exc

    store_builder = store_factory or (
        lambda: GPUArbiterStore.from_url(config.redis_url)
    )
    try:
        store = store_builder()
    except Exception as exc:
        raise _dispatch_error(
            GPUArbiterErrorCode.UNAVAILABLE,
            "GPU arbiter store is unavailable",
        ) from exc

    lease_id = f"workload:{uuid.uuid4()}"
    owner_id = f"dispatch:{uuid.uuid4()}"
    intent_may_exist = False
    lease_may_exist = False
    grant_exposed = False
    grant: GPUDispatchGrant | None = None
    prepared_subject: GPUPreparedColdRuntimeSubject | None = None
    heartbeat_task: asyncio.Task[None] | None = None
    try:
        try:
            if not await store.ping():
                raise GPUArbiterStoreError("GPU arbiter ping failed")
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU arbiter store is unavailable",
            ) from exc

        capacity_changed = await _ensure_cold_capacity(
            session_factory,
            store,
            signer,
            subject,
            health_refresher=health_refresher,
            hard_ttl_ms=hard_ttl_ms,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
        )
        if capacity_changed:
            challenge = secrets.token_hex(32)
            try:
                refreshed = await health_refresher(
                    subject.backend_registry_id,
                    challenge,
                )
            except Exception as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU cold runtime health is unavailable after eviction",
                ) from exc
            if not refreshed:
                raise _dispatch_error(
                    GPUArbiterErrorCode.NOT_READY,
                    "GPU cold runtime is not ready after eviction",
                )
            try:
                subject = await _read_cold_runtime_subject(
                    session_factory,
                    request,
                    expected_challenge=challenge,
                )
            except GPUColdRuntimeSubjectError as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.NOT_READY,
                    "GPU cold runtime changed during eviction",
                ) from exc
            except Exception as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU cold runtime is unavailable after eviction",
                ) from exc
            generation = _cold_generation_candidate(subject)

        intent_may_exist = True
        try:
            owner = await store.acquire_cold_admission_owner(
                subject.gpu_resource_id,
                backend_id=str(subject.backend_registry_id),
                membership_epoch=subject.membership_epoch,
                owner_id=owner_id,
                generation=generation,
                ttl_ms=_GPU_RUNTIME_COLD_INTENT_TTL_MS,
            )
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU cold admission owner is unavailable",
            ) from exc
        if owner.status != "acquired":
            intent_may_exist = False
            raise _map_cold_owner_rejection(owner.status)

        try:
            prepared = await prepare_gpu_cold_runtime_generation(
                session_factory,
                subject,
                token_expires_at=subject.db_now + timedelta(milliseconds=hard_ttl_ms),
            )
            prepared_subject = prepared
        except GPUColdRuntimeSubjectError as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.NOT_READY,
                "GPU cold runtime changed before generation issuance",
            ) from exc
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU cold runtime generation is unavailable",
            ) from exc
        if prepared.generation != generation:
            raise _dispatch_error(
                GPUArbiterErrorCode.NOT_READY,
                "GPU cold runtime generation changed",
            )

        try:
            revalidated = await store.revalidate_cold_admission_owner(
                subject.gpu_resource_id,
                backend_id=str(subject.backend_registry_id),
                membership_epoch=subject.membership_epoch,
                owner_id=owner_id,
                generation=generation,
                ttl_ms=_GPU_RUNTIME_COLD_INTENT_TTL_MS,
            )
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU cold admission owner revalidation is unavailable",
            ) from exc
        if revalidated.status != "renewed":
            raise _map_cold_owner_rejection(revalidated.status)

        lease_may_exist = True
        admission_kwargs = {
            "backend_id": str(subject.backend_registry_id),
            "membership_epoch": subject.membership_epoch,
            "budget_mb": subject.budget_mb,
            "generation": generation,
            "eviction_priority": subject.eviction_priority,
            "evictable": False,
            "max_concurrency": subject.max_concurrency,
            "lease_id": lease_id,
            "owner_id": owner_id,
            "operation": request.operation,
            "heartbeat_ttl_ms": heartbeat_ttl_ms,
            "hard_ttl_ms": hard_ttl_ms,
            "require_cold_owner": True,
        }
        try:
            admission = await store.admit(
                subject.gpu_resource_id,
                **admission_kwargs,
            )
        except Exception:
            try:
                admission = await store.admit(
                    subject.gpu_resource_id,
                    **admission_kwargs,
                )
            except Exception as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU cold admission result is uncertain",
                ) from exc
        if not admission.admitted:
            lease_may_exist = False
            raise _map_admission_rejection(admission)
        intent_may_exist = False
        if (
            admission.allocation_state is not GPUAllocationState.RESERVING
            or admission.lease_count != 1
            or admission.heartbeat_deadline_ms is None
            or admission.hard_deadline_ms is None
            or admission.heartbeat_deadline_ms > admission.hard_deadline_ms
        ):
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU arbiter returned an invalid cold reservation",
            )

        token_exp = min(
            int(prepared.token_expires_at.timestamp()),
            admission.hard_deadline_ms // 1000,
        )
        if (
            token_exp - max(int(time.time()), int(prepared.db_now.timestamp()))
            < _GPU_RUNTIME_MIN_TOKEN_WINDOW_SECONDS
        ):
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU runtime lease has no safe token delivery window",
            )
        try:
            admission_token = signer.sign(
                AdmissionTokenClaims(
                    backend_registry_id=str(prepared.backend_registry_id),
                    gpu_resource_id=prepared.gpu_resource_id,
                    boot_id=prepared.boot_id,
                    generation=prepared.generation,
                    control_epoch=prepared.control_epoch,
                    scope=request.scope,
                    jti=lease_id,
                    exp=token_exp,
                )
            )
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU admission token signing failed",
            ) from exc
        try:
            grant = GPUDispatchGrant(
                generation=prepared.generation,
                admission_token=admission_token,
            )
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU dispatch grant is invalid",
            ) from exc
        try:
            first_heartbeat = await store.heartbeat_lease(
                prepared.gpu_resource_id,
                backend_id=str(prepared.backend_registry_id),
                lease_id=lease_id,
                owner_id=owner_id,
                generation=prepared.generation,
                heartbeat_ttl_ms=heartbeat_ttl_ms,
            )
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU runtime lease heartbeat is unavailable",
            ) from exc
        if first_heartbeat.status != "heartbeated":
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU runtime lease heartbeat failed",
            )
        try:
            loading = await store.transition_allocation(
                prepared.gpu_resource_id,
                backend_id=str(prepared.backend_registry_id),
                expected_generation=prepared.generation,
                target_state=GPUAllocationState.LOADING,
                request_lease_id=lease_id,
                request_owner_id=owner_id,
            )
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU cold loading transition is unavailable",
            ) from exc
        if loading.status != "transitioned":
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU cold loading transition failed",
            )
        heartbeat_task = asyncio.create_task(
            _heartbeat_runtime_lease(
                store,
                prepared,
                lease_id=lease_id,
                owner_id=owner_id,
                heartbeat_ttl_ms=heartbeat_ttl_ms,
                heartbeat_interval_seconds=float(heartbeat_interval_seconds),
                hard_deadline_ms=admission.hard_deadline_ms,
            ),
            name=f"gpu-runtime-heartbeat:{lease_id}",
        )
        grant_exposed = True
        yield grant
    finally:
        await _await_cancellation_safe(
            _finalize_cold_runtime(
                session_factory,
                store,
                subject,
                generation=generation,
                lease_id=lease_id,
                owner_id=owner_id,
                intent_may_exist=intent_may_exist,
                lease_may_exist=lease_may_exist,
                grant_exposed=grant_exposed,
                response_received=(
                    grant is not None
                    and grant.outcome is not None
                    and grant.outcome.kind == "response_received"
                ),
                prepared_subject=prepared_subject,
                heartbeat_task=heartbeat_task,
            )
        )


def build_gpu_dispatch_context_factory(
    session_factory: GPUFenceSessionFactory,
    *,
    config: Settings = settings,
    store_factory: GPUArbiterStoreFactory | None = None,
    signer_factory: GPUAdmissionSignerFactory | None = None,
    health_refresher: GPUHealthRefresher | None = None,
    heartbeat_ttl_ms: int = _GPU_RUNTIME_HEARTBEAT_TTL_MS,
    heartbeat_interval_seconds: float = _GPU_RUNTIME_HEARTBEAT_INTERVAL_SECONDS,
) -> GPUDispatchContextFactory:
    """Build a lazy per-dispatch authority without opening DB, Redis, or secrets."""

    if (
        not isinstance(heartbeat_ttl_ms, int)
        or isinstance(heartbeat_ttl_ms, bool)
        or heartbeat_ttl_ms <= 0
    ):
        raise ValueError("heartbeat_ttl_ms must be a positive integer")
    if (
        not isinstance(heartbeat_interval_seconds, (int, float))
        or isinstance(heartbeat_interval_seconds, bool)
        or heartbeat_interval_seconds <= 0
        or heartbeat_interval_seconds * 1000 >= heartbeat_ttl_ms
    ):
        raise ValueError("heartbeat interval must be positive and shorter than TTL")

    async def refresh_health(backend_id: uuid.UUID, challenge: str) -> bool:
        if health_refresher is not None:
            return await health_refresher(backend_id, challenge)
        return await _refresh_gpu_health(session_factory, backend_id, challenge)

    @asynccontextmanager
    async def dispatch(request: GPUDispatchRequest):
        _validate_runtime_request(request)
        try:
            subject = await _read_runtime_subject(session_factory, request)
        except GPUResidentRuntimeSubjectError as exc:
            logger.info(
                "gpu_runtime_subject_not_ready",
                gpu_arbiter={
                    "backend_id": request.backend_id,
                    "resource_id": request.gpu_resource_id,
                    "reason": exc.reason,
                },
            )
            try:
                cold_subject = await _read_cold_runtime_subject(
                    session_factory,
                    request,
                )
            except GPUColdRuntimeSubjectError as cold_exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.NOT_READY,
                    "GPU runtime subject is not ready",
                ) from cold_exc
            except Exception as cold_exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU cold runtime subject is unavailable",
                ) from cold_exc
            async with _dispatch_cold_runtime(
                session_factory,
                request,
                cold_subject,
                config=config,
                store_factory=store_factory,
                signer_factory=signer_factory,
                health_refresher=refresh_health,
                heartbeat_ttl_ms=heartbeat_ttl_ms,
                heartbeat_interval_seconds=float(heartbeat_interval_seconds),
            ) as grant:
                yield grant
            return
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU runtime subject is unavailable",
            ) from exc

        signer_builder = signer_factory or (
            lambda: GPUAdmissionTokenSigner.from_settings(config)
        )
        try:
            signer = signer_builder()
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.NOT_READY,
                "GPU admission signer is not ready",
            ) from exc

        store_builder = store_factory or (
            lambda: GPUArbiterStore.from_url(config.redis_url)
        )
        try:
            store = store_builder()
        except Exception as exc:
            raise _dispatch_error(
                GPUArbiterErrorCode.UNAVAILABLE,
                "GPU arbiter store is unavailable",
            ) from exc

        lease_id = f"workload:{uuid.uuid4()}"
        owner_id = f"dispatch:{uuid.uuid4()}"
        lease_may_exist = False
        grant_exposed = False
        grant: GPUDispatchGrant | None = None
        heartbeat_task: asyncio.Task[None] | None = None
        try:
            hard_ttl_ms = _runtime_hard_ttl_ms(
                config,
                heartbeat_ttl_ms=heartbeat_ttl_ms,
            )
            lease_may_exist = True
            try:
                admission = await store.admit(
                    subject.gpu_resource_id,
                    backend_id=str(subject.backend_registry_id),
                    membership_epoch=subject.membership_epoch,
                    budget_mb=subject.budget_mb,
                    generation=subject.generation,
                    eviction_priority=subject.eviction_priority,
                    evictable=False,
                    max_concurrency=subject.max_concurrency,
                    lease_id=lease_id,
                    owner_id=owner_id,
                    operation=request.operation,
                    heartbeat_ttl_ms=heartbeat_ttl_ms,
                    hard_ttl_ms=hard_ttl_ms,
                    require_resident=True,
                )
            except Exception as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU arbiter admission is unavailable",
                ) from exc
            if not admission.admitted:
                lease_may_exist = False
                raise _map_admission_rejection(admission)
            if (
                admission.allocation_state is not GPUAllocationState.RESIDENT
                or admission.heartbeat_deadline_ms is None
                or admission.hard_deadline_ms is None
                or admission.heartbeat_deadline_ms > admission.hard_deadline_ms
            ):
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU arbiter returned an invalid Resident grant",
                )

            token_exp = admission.hard_deadline_ms // 1000
            if (
                token_exp - int(subject.db_now.timestamp())
                < _GPU_RUNTIME_MIN_TOKEN_WINDOW_SECONDS
            ):
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU runtime lease has no safe token delivery window",
                )
            token_expires_at = datetime.fromtimestamp(token_exp, tz=UTC)
            try:
                await record_gpu_resident_runtime_token_expiry(
                    session_factory,
                    subject,
                    token_expires_at=token_expires_at,
                )
            except GPUResidentRuntimeSubjectError as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.NOT_READY,
                    "GPU resident runtime changed before token issuance",
                ) from exc
            except Exception as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU token horizon is unavailable",
                ) from exc

            try:
                claims = AdmissionTokenClaims(
                    backend_registry_id=str(subject.backend_registry_id),
                    gpu_resource_id=subject.gpu_resource_id,
                    boot_id=subject.boot_id,
                    generation=subject.generation,
                    control_epoch=subject.control_epoch,
                    scope=request.scope,
                    jti=lease_id,
                    exp=token_exp,
                )
                admission_token = signer.sign(claims)
            except Exception as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU admission token signing failed",
                ) from exc
            try:
                first_heartbeat = await store.heartbeat_lease(
                    subject.gpu_resource_id,
                    backend_id=str(subject.backend_registry_id),
                    lease_id=lease_id,
                    owner_id=owner_id,
                    generation=subject.generation,
                    heartbeat_ttl_ms=heartbeat_ttl_ms,
                )
            except Exception as exc:
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU runtime lease heartbeat is unavailable",
                ) from exc
            if first_heartbeat.status != "heartbeated":
                raise _dispatch_error(
                    GPUArbiterErrorCode.UNAVAILABLE,
                    "GPU runtime lease heartbeat failed",
                )
            heartbeat_task = asyncio.create_task(
                _heartbeat_runtime_lease(
                    store,
                    subject,
                    lease_id=lease_id,
                    owner_id=owner_id,
                    heartbeat_ttl_ms=heartbeat_ttl_ms,
                    heartbeat_interval_seconds=float(heartbeat_interval_seconds),
                    hard_deadline_ms=admission.hard_deadline_ms,
                ),
                name=f"gpu-runtime-heartbeat:{lease_id}",
            )
            grant = GPUDispatchGrant(
                generation=subject.generation,
                admission_token=admission_token,
            )
            grant_exposed = True
            yield grant
        finally:
            action: str | None = None
            if lease_may_exist:
                action = "release"
                if grant_exposed and (
                    grant is None
                    or grant.outcome is None
                    or grant.outcome.kind != "response_received"
                ):
                    action = "uncertain"
            await _await_cancellation_safe(
                _cleanup_runtime_lease(
                    store,
                    subject,
                    lease_id=lease_id,
                    owner_id=owner_id,
                    action=action,
                    heartbeat_task=heartbeat_task,
                )
            )

    return dispatch


__all__ = ["build_gpu_dispatch_context_factory"]
