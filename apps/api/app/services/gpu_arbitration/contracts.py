"""Cycle-safe GPU arbitration contracts (no ml_client / DB / store imports).

These types, error codes, enums and dispatch dataclasses are the low-level contract
layer that ``ml_client`` and the GPU orchestration modules both depend on. Extracted
verbatim from the legacy ``gpu_arbiter.py`` so ``ml_client`` no longer needs to import
``gpu_arbiter`` (breaking the historical cycle).
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field as dataclass_field
from enum import Enum
from typing import Callable, Literal

from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    validate_canonical_positive_int64,
)
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

GPUShadowSessionFactory = Callable[[], AsyncSession]


class GPUArbiterErrorCode(str, Enum):
    """Stable platform-side arbitration errors frozen by ADR-0049."""

    NOT_READY = "gpu_arbiter_not_ready"
    CAPACITY_UNAVAILABLE = "gpu_capacity_unavailable"
    BACKEND_CONCURRENCY_SATURATED = "gpu_backend_concurrency_saturated"
    DRAIN_TIMEOUT = "gpu_drain_timeout"
    UNAVAILABLE = "gpu_arbiter_unavailable"
    CONFIG_INVALID = "gpu_config_invalid"
    BACKEND_RETIREMENT_REQUIRED = "gpu_backend_retirement_required"


_GPU_ARBITER_DISPATCH_ERROR_STATUS = {
    GPUArbiterErrorCode.NOT_READY: 503,
    GPUArbiterErrorCode.CAPACITY_UNAVAILABLE: 503,
    GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED: 503,
    GPUArbiterErrorCode.DRAIN_TIMEOUT: 503,
    GPUArbiterErrorCode.UNAVAILABLE: 503,
    GPUArbiterErrorCode.CONFIG_INVALID: 503,
    GPUArbiterErrorCode.BACKEND_RETIREMENT_REQUIRED: 409,
}


_GPU_ARBITER_RETRY_AFTER_REQUIRED = frozenset(
    {
        GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED,
        GPUArbiterErrorCode.DRAIN_TIMEOUT,
    }
)


class GPUArbiterDispatchError(HTTPException):
    """Structured dispatch error usable by FastAPI routes and worker callers."""

    def __init__(
        self,
        code: GPUArbiterErrorCode,
        *,
        message: str | None = None,
        retry_after_s: int | None = None,
    ) -> None:
        if code in _GPU_ARBITER_RETRY_AFTER_REQUIRED and retry_after_s is None:
            raise ValueError(f"{code.value} requires retry_after_s")
        if retry_after_s is not None and (
            not isinstance(retry_after_s, int)
            or isinstance(retry_after_s, bool)
            or retry_after_s < 0
        ):
            raise ValueError("retry_after_s must be a non-negative integer")

        detail = {"error_code": code.value}
        if message is not None:
            detail["message"] = message
        headers = (
            {"Retry-After": str(retry_after_s)} if retry_after_s is not None else None
        )
        self.error_code = code.value
        self.retry_after_s = retry_after_s
        super().__init__(
            status_code=_GPU_ARBITER_DISPATCH_ERROR_STATUS[code],
            detail=detail,
            headers=headers,
        )


GPUDispatchOperation = Literal[
    "predict",
    "predict_interactive",
    "warmup",
    "reload",
    "unload",
]


GPUDispatchOutcomeKind = Literal["response_received", "uncertain"]


GPUDispatchUncertainReason = Literal["request_aborted", "response_not_reported"]


@dataclass(frozen=True)
class GPUDispatchRequest:
    """Exact client metadata passed to the authoritative dispatch context."""

    backend_id: str
    gpu_resource_id: str
    operation: GPUDispatchOperation
    scope: AdmissionScope


@dataclass(frozen=True)
class GPUDispatchOutcome:
    """One explicit transport outcome; it is not a residency assertion."""

    kind: GPUDispatchOutcomeKind
    status_code: int | None = None
    reason: GPUDispatchUncertainReason | None = None


class GPUDispatchOutcomeChannel:
    """Mutable one-shot outcome channel owned by an immutable dispatch grant."""

    def __init__(self) -> None:
        self._outcome: GPUDispatchOutcome | None = None

    @property
    def outcome(self) -> GPUDispatchOutcome | None:
        return self._outcome

    def report_response(self, status_code: int) -> bool:
        if (
            not isinstance(status_code, int)
            or isinstance(status_code, bool)
            or not 100 <= status_code <= 599
        ):
            raise ValueError("status_code must be a valid HTTP status")
        if self._outcome is not None:
            return False
        self._outcome = GPUDispatchOutcome(
            kind="response_received",
            status_code=status_code,
        )
        return True

    def report_uncertain_if_missing(
        self,
        reason: GPUDispatchUncertainReason,
    ) -> bool:
        if self._outcome is not None:
            return False
        self._outcome = GPUDispatchOutcome(kind="uncertain", reason=reason)
        return True


@dataclass(frozen=True)
class GPUDispatchGrant:
    """Managed lifecycle headers produced after authoritative admission."""

    generation: str
    admission_token: str
    outcome_channel: GPUDispatchOutcomeChannel = dataclass_field(
        default_factory=GPUDispatchOutcomeChannel,
        init=False,
        repr=False,
        compare=False,
    )

    def __post_init__(self) -> None:
        validate_canonical_positive_int64(self.generation)
        if (
            not self.admission_token
            or self.admission_token.strip() != self.admission_token
        ):
            raise ValueError("admission_token must be non-empty and canonical")

    @property
    def outcome(self) -> GPUDispatchOutcome | None:
        return self.outcome_channel.outcome

    def report_response(self, status_code: int) -> bool:
        return self.outcome_channel.report_response(status_code)

    def report_uncertain_if_missing(
        self,
        reason: GPUDispatchUncertainReason,
    ) -> bool:
        return self.outcome_channel.report_uncertain_if_missing(reason)


GPUDispatchContextFactory = Callable[
    [GPUDispatchRequest], AbstractAsyncContextManager[GPUDispatchGrant]
]
