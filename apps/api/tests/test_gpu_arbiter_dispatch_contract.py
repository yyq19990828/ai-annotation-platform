from __future__ import annotations

import pytest

from app.config import GPUArbiterMode, Settings
from app.services.gpu_arbiter import (
    GPUArbiterDispatchError,
    GPUArbiterErrorCode,
    GPUDispatchGrant,
    GPUDispatchOutcomeChannel,
    unregistered_gpu_loading_blocked,
)


@pytest.mark.parametrize(
    ("code", "status_code", "retry_after_s"),
    [
        (GPUArbiterErrorCode.NOT_READY, 503, None),
        (GPUArbiterErrorCode.CAPACITY_UNAVAILABLE, 503, 4),
        (GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED, 503, 4),
        (GPUArbiterErrorCode.DRAIN_TIMEOUT, 503, 4),
        (GPUArbiterErrorCode.UNAVAILABLE, 503, None),
        (GPUArbiterErrorCode.CONFIG_INVALID, 503, None),
        (GPUArbiterErrorCode.BACKEND_RETIREMENT_REQUIRED, 409, None),
    ],
)
def test_dispatch_error_contract(
    code: GPUArbiterErrorCode,
    status_code: int,
    retry_after_s: int | None,
) -> None:
    error = GPUArbiterDispatchError(
        code,
        message="stable message",
        retry_after_s=retry_after_s,
    )

    assert error.error_code == code.value
    assert error.status_code == status_code
    assert error.detail == {
        "error_code": code.value,
        "message": "stable message",
    }
    assert error.headers == (
        {"Retry-After": str(retry_after_s)} if retry_after_s is not None else None
    )


@pytest.mark.parametrize(
    "code",
    [
        GPUArbiterErrorCode.BACKEND_CONCURRENCY_SATURATED,
        GPUArbiterErrorCode.DRAIN_TIMEOUT,
    ],
)
def test_retryable_dispatch_errors_require_retry_after(
    code: GPUArbiterErrorCode,
) -> None:
    with pytest.raises(ValueError, match="requires retry_after_s"):
        GPUArbiterDispatchError(code)


@pytest.mark.parametrize("retry_after_s", [-1, True, 1.5])
def test_dispatch_error_rejects_invalid_retry_after(retry_after_s: object) -> None:
    with pytest.raises(ValueError, match="non-negative integer"):
        GPUArbiterDispatchError(
            GPUArbiterErrorCode.CAPACITY_UNAVAILABLE,
            retry_after_s=retry_after_s,  # type: ignore[arg-type]
        )


def test_dispatch_grant_requires_canonical_generation_and_token() -> None:
    first = GPUDispatchGrant("1", "signed-token")
    second = GPUDispatchGrant("2", "another-token")

    assert first.generation == "1"
    assert first.outcome_channel is not second.outcome_channel

    with pytest.raises(ValueError, match="canonical positive int64"):
        GPUDispatchGrant("01", "signed-token")
    with pytest.raises(ValueError, match="non-empty and canonical"):
        GPUDispatchGrant("1", " token ")


def test_dispatch_outcome_channel_reports_one_response_exactly_once() -> None:
    channel = GPUDispatchOutcomeChannel()

    assert channel.report_response(503) is True

    assert channel.outcome is not None
    assert channel.outcome.kind == "response_received"
    assert channel.outcome.status_code == 503
    assert channel.outcome.reason is None
    assert channel.report_response(200) is False
    assert channel.outcome.status_code == 503


def test_dispatch_outcome_channel_defaults_missing_result_to_uncertain() -> None:
    channel = GPUDispatchOutcomeChannel()

    assert channel.report_uncertain_if_missing("request_aborted") is True
    assert channel.report_uncertain_if_missing("response_not_reported") is False

    assert channel.outcome is not None
    assert channel.outcome.kind == "uncertain"
    assert channel.outcome.status_code is None
    assert channel.outcome.reason == "request_aborted"


@pytest.mark.parametrize("status_code", [True, 99, 600])
def test_dispatch_outcome_channel_rejects_invalid_http_status(
    status_code: object,
) -> None:
    channel = GPUDispatchOutcomeChannel()

    with pytest.raises(ValueError, match="HTTP status"):
        channel.report_response(status_code)  # type: ignore[arg-type]


def test_unregistered_loading_gate_uses_effective_not_desired_mode() -> None:
    config = Settings(
        _env_file=None,
        gpu_arbiter_mode="enforce",
        gpu_arbiter_resources_json=(
            '{"node-a/index:0":{"node_id":"node-a",'
            '"physical_device_token":"index:0","allocatable_mb":20000,'
            '"mode":"enforce"}}'
        ),
    )

    assert unregistered_gpu_loading_blocked(config=config) is False


def test_unregistered_loading_gate_stays_closed_during_demotion(
    monkeypatch,
) -> None:
    config = Settings(
        _env_file=None,
        gpu_arbiter_mode="off",
        gpu_arbiter_resources_json=(
            '{"node-a/index:0":{"node_id":"node-a",'
            '"physical_device_token":"index:0","allocatable_mb":20000,'
            '"mode":"off"}}'
        ),
    )
    monkeypatch.setattr(
        "app.services.gpu_arbiter.effective_gpu_arbiter_mode",
        lambda _resource_id, *, config: GPUArbiterMode.ENFORCE,
    )

    assert unregistered_gpu_loading_blocked(config=config) is True
