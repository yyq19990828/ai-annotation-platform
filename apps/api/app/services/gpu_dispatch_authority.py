"""Dormant Resident-only workload authority for ADR-0049 GPU dispatch."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
import time
import uuid

import structlog
from aap_protocol_v2.lifecycle import AdmissionScope, AdmissionTokenClaims

from app.config import Settings, settings
from app.services.gpu_admission_signer import GPUAdmissionTokenSigner
from app.services.gpu_arbiter import (
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUDispatchContextFactory,
    GPUDispatchGrant,
    GPUDispatchRequest,
    GPUFenceSessionFactory,
    GPUResidentRuntimeSubject,
    GPUResidentRuntimeSubjectError,
    read_gpu_resident_runtime_subject,
    record_gpu_resident_runtime_token_expiry,
)
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
_GPU_RUNTIME_SCOPES = {
    "predict": AdmissionScope.PREDICT,
    "predict_interactive": AdmissionScope.PREDICT,
    "warmup": AdmissionScope.WARMUP,
    "reload": AdmissionScope.RELOAD,
}

GPUArbiterStoreFactory = Callable[[], GPUArbiterStore]
GPUAdmissionSignerFactory = Callable[[], GPUAdmissionTokenSigner]


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


async def _heartbeat_runtime_lease(
    store: GPUArbiterStore,
    subject: GPUResidentRuntimeSubject,
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
    subject: GPUResidentRuntimeSubject,
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
            raise _dispatch_error(
                GPUArbiterErrorCode.NOT_READY,
                "GPU resident runtime subject is not ready",
            ) from exc
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
            hard_ttl_ms = (
                int(config.ml_predict_timeout)
                + _GPU_RUNTIME_HARD_DEADLINE_GRACE_SECONDS
            ) * 1000
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
