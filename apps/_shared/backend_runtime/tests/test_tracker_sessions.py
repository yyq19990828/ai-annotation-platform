import asyncio
from contextlib import asynccontextmanager

import pytest

from aap_backend_runtime import TrackerSessionLost, TrackerSessionManager


def test_tracker_session_holds_resource_and_checks_binding() -> None:
    async def run() -> None:
        events: list[str] = []

        @asynccontextmanager
        async def borrow():
            events.append("borrow")
            try:
                yield "resource"
            finally:
                events.append("release")

        manager = TrackerSessionManager[str, dict]()
        token = await manager.start(
            binding=("job-1", "forward"),
            borrow=borrow,
            open_session=lambda resource: _value({"resource": resource, "count": 0}),
            close_session=lambda _resource, state: _event(
                events, f"close:{state['count']}"
            ),
        )
        assert (
            await manager.call(
                token,
                ("job-1", "forward"),
                _increment,
            )
            == 1
        )
        with pytest.raises(TrackerSessionLost):
            await manager.call(token, ("job-2", "forward"), _increment)
        await manager.close(token, ("job-1", "forward"))
        assert events == ["borrow", "close:1", "release"]

    asyncio.run(run())


def test_tracker_session_expires_and_shutdown_releases_resources() -> None:
    async def run() -> None:
        events: list[str] = []

        @asynccontextmanager
        async def borrow():
            try:
                yield "resource"
            finally:
                events.append("release")

        manager = TrackerSessionManager[str, dict](ttl_seconds=0)
        token = await manager.start(
            binding=("job-1", "forward"),
            borrow=borrow,
            open_session=lambda _resource: _value({}),
            close_session=lambda _resource, _state: _event(events, "close"),
        )
        assert await manager.expire() == 1
        assert events == ["close", "release"]
        with pytest.raises(TrackerSessionLost):
            await manager.close(token, ("job-1", "forward"))

        await manager.start(
            binding=("job-2", "forward"),
            borrow=borrow,
            open_session=lambda _resource: _value({}),
            close_session=lambda _resource, _state: _event(events, "close"),
        )
        await manager.shutdown()
        assert events == ["close", "release", "close", "release"]

    asyncio.run(run())


async def _value(value):
    return value


async def _increment(_resource, state):
    state["count"] += 1
    return state["count"]


async def _event(events, value):
    events.append(value)
