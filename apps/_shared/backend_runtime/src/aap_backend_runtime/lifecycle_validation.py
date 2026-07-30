"""Shared real-HTTP fault probes for managed lifecycle deployment validators."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Mapping
from typing import Any


GPU_GENERATION_HEADER = "X-AAP-GPU-Generation"
GPU_ADMISSION_TOKEN_HEADER = "X-AAP-GPU-Admission-Token"


async def exercise_lifecycle_fault_matrix(
    *,
    client: Any,
    lifecycle: Any,
    token: Callable[..., str],
    workload_scope: Any,
    drain_scope: Any,
    unload_scope: Any,
    workload_path: str,
    workload_body: Mapping[str, Any],
    current_generation: str,
    stale_generation: str,
    next_generation: str,
    drain_owner: str,
) -> dict[str, bool]:
    """Exercise common negative contracts and leave ``next_generation`` drained.

    The caller must subsequently execute the successful full-pool unload and mark
    ``full_cleanup`` only after its Backend-specific pool checks pass.
    """

    partial = await client.post(
        workload_path,
        json=dict(workload_body),
        headers={GPU_GENERATION_HEADER: current_generation},
    )
    _expect_status(partial, 403, "partial lifecycle headers")

    replay_token = token(
        workload_scope,
        generation=current_generation,
        jti="validation-replay-workload",
    )
    replay_headers = {
        GPU_GENERATION_HEADER: current_generation,
        GPU_ADMISSION_TOKEN_HEADER: replay_token,
    }
    first_replay = await client.post(
        workload_path,
        json=dict(workload_body),
        headers=replay_headers,
    )
    if first_replay.status_code >= 400:
        raise AssertionError(
            f"first replay probe request failed: {first_replay.status_code} "
            f"{first_replay.text}"
        )
    second_replay = await client.post(
        workload_path,
        json=dict(workload_body),
        headers=replay_headers,
    )
    _expect_status(second_replay, 403, "replayed workload token")

    stale = await client.post(
        workload_path,
        json=dict(workload_body),
        headers={
            GPU_GENERATION_HEADER: stale_generation,
            GPU_ADMISSION_TOKEN_HEADER: token(
                workload_scope,
                generation=stale_generation,
            ),
        },
    )
    _expect_status(stale, 409, "stale generation")

    deferred_operation = await lifecycle.begin_workload(
        workload_scope,
        generation_header=current_generation,
        token=token(workload_scope, generation=current_generation),
    )
    deferred = asyncio.get_running_loop().create_future()
    deferred_operation.track_future(deferred)
    await deferred_operation.close()
    if (await lifecycle.residency()).active_requests != 1:
        raise AssertionError("pending executor work was released too early")
    deferred.set_result(None)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if (await lifecycle.residency()).active_requests == 0:
            break
        await asyncio.sleep(0.01)
    else:
        raise AssertionError("completed executor work remained active")

    busy_operation = await lifecycle.begin_workload(
        workload_scope,
        generation_header=current_generation,
        token=token(workload_scope, generation=current_generation),
    )
    drain = await client.post(
        "/drain",
        json={"generation": next_generation},
        headers={
            GPU_GENERATION_HEADER: next_generation,
            GPU_ADMISSION_TOKEN_HEADER: token(
                drain_scope,
                generation=next_generation,
                operation=drain_owner,
            ),
        },
    )
    if drain.status_code >= 400:
        await busy_operation.close()
        raise AssertionError(f"drain probe failed: {drain.status_code} {drain.text}")
    busy_unload = await client.post(
        "/unload",
        json={"generation": next_generation},
        headers={
            GPU_GENERATION_HEADER: next_generation,
            GPU_ADMISSION_TOKEN_HEADER: token(
                unload_scope,
                generation=next_generation,
                operation=drain_owner,
            ),
        },
    )
    try:
        _expect_status(busy_unload, 409, "busy unload")
    finally:
        await busy_operation.close()

    return {
        "partial_headers_rejected": True,
        "token_replay_rejected": True,
        "stale_generation_rejected": True,
        "cancel_accounting": True,
        "busy_unload_rejected": True,
    }


def _expect_status(response: Any, expected: int, label: str) -> None:
    if response.status_code != expected:
        raise AssertionError(
            f"{label} was not rejected: {response.status_code} {response.text}"
        )
