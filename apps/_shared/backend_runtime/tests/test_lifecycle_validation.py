from __future__ import annotations

import asyncio
from types import SimpleNamespace

from aap_backend_runtime.lifecycle_validation import exercise_lifecycle_fault_matrix


class _Response:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


class _Operation:
    def __init__(self, lifecycle) -> None:
        self.lifecycle = lifecycle
        self.pending = []

    def track_future(self, future) -> None:
        self.pending.append(future)

    async def close(self) -> None:
        if not self.pending:
            self.lifecycle.active -= 1
            return
        for future in self.pending:
            future.add_done_callback(lambda _done: self.lifecycle.release())


class _Lifecycle:
    def __init__(self) -> None:
        self.active = 0

    async def begin_workload(self, *_args, **_kwargs):
        self.active += 1
        return _Operation(self)

    async def residency(self):
        return SimpleNamespace(active_requests=self.active)

    def release(self) -> None:
        self.active -= 1


class _Client:
    def __init__(self, lifecycle: _Lifecycle) -> None:
        self.lifecycle = lifecycle
        self.seen_tokens = set()

    async def post(self, path, *, json, headers):
        token = headers.get("X-AAP-GPU-Admission-Token")
        generation = headers.get("X-AAP-GPU-Generation")
        if path == "/drain":
            return _Response(200)
        if path == "/unload":
            return _Response(409 if self.lifecycle.active else 200)
        if token is None:
            return _Response(403)
        if generation == "1":
            return _Response(409)
        if token in self.seen_tokens:
            return _Response(403)
        self.seen_tokens.add(token)
        return _Response(200)


def test_fault_matrix_covers_shared_negative_contracts_and_leaves_drain() -> None:
    lifecycle = _Lifecycle()
    client = _Client(lifecycle)
    counter = 0

    def token(scope, *, generation=None, operation=None, jti=None):
        nonlocal counter
        counter += 1
        return f"{scope}:{generation}:{operation}:{jti or counter}"

    checks = asyncio.run(
        exercise_lifecycle_fault_matrix(
            client=client,
            lifecycle=lifecycle,
            token=token,
            workload_scope="warmup",
            drain_scope="drain",
            unload_scope="unload",
            workload_path="/warmup",
            workload_body={"model_id": "model"},
            current_generation="3",
            stale_generation="1",
            next_generation="4",
            drain_owner="cycle-2",
        )
    )

    assert checks == {
        "partial_headers_rejected": True,
        "token_replay_rejected": True,
        "stale_generation_rejected": True,
        "cancel_accounting": True,
        "busy_unload_rejected": True,
    }
    assert lifecycle.active == 0
