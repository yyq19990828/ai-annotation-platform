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
from aap_protocol_v2.lifecycle import AdmissionScope, AdmissionTokenClaims

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
    GPUFenceSessionFactory,
    GPUPreparedColdRuntimeSubject,
    GPUResidentRuntimeSubject,
    GPUResidentRuntimeSubjectError,
    commit_gpu_cold_terminal_from_health,
    prepare_gpu_cold_runtime_generation,
    read_gpu_cold_runtime_subject,
    read_gpu_resident_runtime_subject,
    record_gpu_resident_runtime_token_expiry,
)
from app.services.ml_backend import MLBackendService
from app.services.gpu_arbiter_store import (
    GPUAdmissionResult,
    GPUAllocationState,
    GPUArbiterStore,
    GPUArbiterStoreError,
)


logger = structlog.get_logger(__name__)

_GPU_RUNTIME_HEARTBEAT_TTL_MS = 15_000
_GPU_RUNTIME_HEARTBEAT_INTERVAL_SECONDS = 5.0
_GPU_RUNTIME_HARD_DEADLINE_GRACE_SECONDS = 30
_GPU_RUNTIME_MIN_TOKEN_WINDOW_SECONDS = 5
_GPU_RUNTIME_RETRY_AFTER_SECONDS = 1
_GPU_RUNTIME_COLD_INTENT_TTL_MS = 30_000
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
) -> GPUColdRuntimeSubject:
    async with session_factory() as db:
        return await read_gpu_cold_runtime_subject(
            db,
            backend_id=request.backend_id,
            gpu_resource_id=request.gpu_resource_id,
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


async def _refresh_cold_terminal_health(
    session_factory: GPUFenceSessionFactory,
    subject: GPUPreparedColdRuntimeSubject,
) -> str:
    challenge = secrets.token_hex(32)
    try:
        async with session_factory() as db:
            await MLBackendService(db).check_health(
                subject.backend_registry_id,
                gpu_health_challenge=challenge,
            )
            await db.commit()
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


@asynccontextmanager
async def _dispatch_cold_runtime(
    session_factory: GPUFenceSessionFactory,
    request: GPUDispatchRequest,
    subject: GPUColdRuntimeSubject,
    *,
    config: Settings,
    store_factory: GPUArbiterStoreFactory | None,
    signer_factory: GPUAdmissionSignerFactory | None,
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
