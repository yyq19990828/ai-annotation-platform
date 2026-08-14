from __future__ import annotations

import asyncio
import secrets
import time
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Generic, TypeVar

ResourceT = TypeVar("ResourceT")
StateT = TypeVar("StateT")
ResultT = TypeVar("ResultT")


class TrackerSessionLost(KeyError):
    pass


@dataclass
class _Command(Generic[ResourceT, StateT]):
    run: Callable[[ResourceT, StateT], Awaitable[object]] | None
    future: asyncio.Future[object]


@dataclass
class _Session(Generic[ResourceT, StateT]):
    binding: tuple[str, ...]
    queue: asyncio.Queue[_Command[ResourceT, StateT]]
    task: asyncio.Task[None]
    last_used_at: float
    in_flight: int = 0


class TrackerSessionManager(Generic[ResourceT, StateT]):
    """Keep one model-pool borrow alive for an opaque tracker session."""

    def __init__(self, *, ttl_seconds: float = 300.0) -> None:
        self._ttl_seconds = ttl_seconds
        self._sessions: dict[str, _Session[ResourceT, StateT]] = {}

    async def start(
        self,
        *,
        binding: tuple[str, ...],
        borrow: Callable[[], AbstractAsyncContextManager[ResourceT]],
        open_session: Callable[[ResourceT], Awaitable[StateT]],
        close_session: Callable[[ResourceT, StateT], Awaitable[None]],
    ) -> str:
        token = secrets.token_urlsafe(32)
        ready: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        queue: asyncio.Queue[_Command[ResourceT, StateT]] = asyncio.Queue()
        task = asyncio.create_task(
            self._serve(token, borrow, open_session, close_session, queue, ready)
        )
        self._sessions[token] = _Session(binding, queue, task, time.monotonic())
        try:
            await ready
        except BaseException:
            self._sessions.pop(token, None)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise
        return token

    async def call(
        self,
        token: str,
        binding: tuple[str, ...],
        run: Callable[[ResourceT, StateT], Awaitable[ResultT]],
    ) -> ResultT:
        session = self._get(token, binding)
        future: asyncio.Future[object] = asyncio.get_running_loop().create_future()
        session.last_used_at = time.monotonic()
        session.in_flight += 1
        try:
            await session.queue.put(_Command(run=run, future=future))
            return await future  # type: ignore[return-value]
        except BaseException:
            if session.task.done():
                self._sessions.pop(token, None)
            raise
        finally:
            session.in_flight -= 1
            session.last_used_at = time.monotonic()

    async def close(self, token: str, binding: tuple[str, ...]) -> None:
        session = self._get(token, binding)
        self._sessions.pop(token, None)
        future: asyncio.Future[object] = asyncio.get_running_loop().create_future()
        await session.queue.put(_Command(run=None, future=future))
        await asyncio.shield(session.task)

    async def expire(self) -> int:
        cutoff = time.monotonic() - self._ttl_seconds
        expired = [
            token
            for token, session in self._sessions.items()
            if session.in_flight == 0 and session.last_used_at <= cutoff
        ]
        closing: list[_Session[ResourceT, StateT]] = []
        for token in expired:
            session = self._sessions.pop(token, None)
            if session is None:
                continue
            closing.append(session)
            future: asyncio.Future[object] = asyncio.get_running_loop().create_future()
            await session.queue.put(_Command(run=None, future=future))
        await asyncio.gather(
            *(session.task for session in closing), return_exceptions=True
        )
        return len(expired)

    async def shutdown(self) -> None:
        sessions = list(self._sessions.values())
        self._sessions.clear()
        for session in sessions:
            future: asyncio.Future[object] = asyncio.get_running_loop().create_future()
            await session.queue.put(_Command(run=None, future=future))
        await asyncio.gather(
            *(session.task for session in sessions), return_exceptions=True
        )

    def _get(self, token: str, binding: tuple[str, ...]) -> _Session[ResourceT, StateT]:
        session = self._sessions.get(token)
        if session is None or session.binding != binding or session.task.done():
            raise TrackerSessionLost(token)
        return session

    async def _serve(
        self,
        token: str,
        borrow: Callable[[], AbstractAsyncContextManager[ResourceT]],
        open_session: Callable[[ResourceT], Awaitable[StateT]],
        close_session: Callable[[ResourceT, StateT], Awaitable[None]],
        queue: asyncio.Queue[_Command[ResourceT, StateT]],
        ready: asyncio.Future[None],
    ) -> None:
        state: StateT | None = None
        resource: ResourceT | None = None
        try:
            async with borrow() as resource:
                state = await open_session(resource)
                try:
                    if not ready.done():
                        ready.set_result(None)
                    while True:
                        command = await queue.get()
                        if command.run is None:
                            if not command.future.done():
                                command.future.set_result(None)
                            break
                        try:
                            result = await command.run(resource, state)
                        except BaseException as exc:
                            if not command.future.done():
                                command.future.set_exception(exc)
                            break
                        if not command.future.done():
                            command.future.set_result(result)
                finally:
                    await close_session(resource, state)
        except BaseException as exc:
            if not ready.done():
                ready.set_exception(exc)
            raise
        finally:
            self._sessions.pop(token, None)
