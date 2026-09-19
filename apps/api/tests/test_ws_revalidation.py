"""Pure tests for per-payload websocket reauthorization (B3).

No database or Redis: the relay must drop a protected message as soon as the
revalidation callback rejects, not after a grace interval.
"""

from __future__ import annotations

import asyncio

import pytest

from app.api.v1 import ws


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, data) -> None:
        self.sent.append(data if isinstance(data, str) else data.decode())

    async def receive(self) -> dict:
        # Block forever; the relay completing ends the wait and cancels this.
        await asyncio.sleep(3600)
        return {"type": "websocket.disconnect"}


class _FakePubSub:
    def __init__(self, messages: list[str]) -> None:
        self._messages = messages

    async def listen(self):
        for message in self._messages:
            yield {"type": "message", "data": message}


async def test_relay_revalidates_before_each_message():
    calls: list[int] = []

    async def revalidate() -> bool:
        calls.append(1)
        return len(calls) < 2  # allow first, reject second

    websocket = _FakeWebSocket()
    pubsub = _FakePubSub(["first", "second"])

    await asyncio.wait_for(
        ws._run_pubsub_ws(websocket, pubsub, heartbeat=False, revalidate=revalidate),
        timeout=5,
    )

    assert websocket.sent == ["first"]
    assert len(calls) == 2


async def test_relay_without_revalidate_forwards_all():
    websocket = _FakeWebSocket()
    pubsub = _FakePubSub(["a", "b"])

    await asyncio.wait_for(
        ws._run_pubsub_ws(websocket, pubsub, heartbeat=False), timeout=5
    )

    assert websocket.sent == ["a", "b"]


async def test_project_stream_rejects_when_credential_invalid(monkeypatch):
    async def invalid_credential(_token):
        return None

    monkeypatch.setattr(ws, "_authenticate_socket_token", invalid_credential)
    assert await ws._revalidate_project_stream("tok", None) is False


@pytest.fixture(autouse=True)
def _no_redis_pool(monkeypatch):
    # The relay test never touches Redis, but importing the module must not
    # construct a live pool.
    yield
