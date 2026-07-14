from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import pytest

from handle_pool import HandlePool, HandlePoolBusyError


class _Session:
    def __init__(self, providers: list[str]) -> None:
        self._providers = providers

    def get_providers(self) -> list[str]:
        return list(self._providers)


def _handle(providers: list[str]) -> SimpleNamespace:
    return SimpleNamespace(_onnx_session=_Session(providers))


def _inspect(name: str, handle: object) -> list[list[str]] | None:
    if name == "pipeline":
        return [
            handle.detector._onnx_session.get_providers(),
            handle.va_classifier._onnx_session.get_providers(),
        ]
    return [handle._onnx_session.get_providers()]


def _factories(factory):
    return {"pipeline": factory, "detector": factory, "va": factory}


def test_same_handle_cold_start_is_single_flight() -> None:
    async def scenario() -> None:
        started = threading.Event()
        release = threading.Event()
        calls = 0

        def build():
            nonlocal calls
            calls += 1
            started.set()
            assert release.wait(2)
            return _handle(["CPUExecutionProvider"])

        pool = HandlePool(_factories(build), _inspect, build_timeout=2)
        first = asyncio.create_task(pool.warmup("detector"))
        assert await asyncio.to_thread(started.wait, 1)
        second = asyncio.create_task(pool.warmup("detector"))
        await asyncio.sleep(0)
        snapshot = await pool.snapshot()
        assert snapshot["builders"] == 1
        assert snapshot["waiters"] == 2
        release.set()
        first_result = await first
        assert first_result[0] is False
        assert first_result[1] is not None
        second_result = await second
        assert second_result[0] is False
        assert calls == 1
        assert (await pool.snapshot())["current_size"] == 1

    asyncio.run(scenario())


def test_three_distinct_builders_reserve_at_most_the_fixed_cap() -> None:
    async def scenario() -> None:
        started = threading.Event()
        release = threading.Event()

        def build(name: str):
            started.set()
            assert release.wait(2)
            if name == "pipeline":
                return SimpleNamespace(
                    detector=_handle(["CPUExecutionProvider"]),
                    va_classifier=_handle(["CPUExecutionProvider"]),
                )
            return _handle(["CPUExecutionProvider"])

        pool = HandlePool(
            {
                name: (lambda name=name: build(name))
                for name in ("pipeline", "detector", "va")
            },
            _inspect,
            build_timeout=2,
        )
        tasks = [
            asyncio.create_task(pool.warmup(name))
            for name in ("pipeline", "detector", "va")
        ]
        assert await asyncio.to_thread(started.wait, 1)
        await asyncio.sleep(0)
        snapshot = await pool.snapshot()
        assert snapshot["builders"] == 3
        assert snapshot["current_size"] + snapshot["reserved_build_slots"] == pool.cap
        release.set()
        await asyncio.gather(*tasks)
        assert (await pool.snapshot())["current_size"] == pool.cap

    asyncio.run(scenario())


def test_borrower_blocks_full_unload_and_serializes_use() -> None:
    async def scenario() -> None:
        pool = HandlePool(
            _factories(lambda: _handle(["CPUExecutionProvider"])),
            _inspect,
        )
        await pool.warmup("detector")
        entered = asyncio.Event()
        release = asyncio.Event()

        async def use() -> None:
            async with pool.borrow("detector"):
                entered.set()
                await release.wait()

        borrower = asyncio.create_task(use())
        await entered.wait()
        with pytest.raises(HandlePoolBusyError):
            await pool.unload_all(reason="manual", force_cleanup=True)
        assert (await pool.snapshot())["borrowers"] == 1
        release.set()
        await borrower
        assert await pool.unload_all(reason="manual", force_cleanup=True) == 1
        snapshot = await pool.snapshot()
        assert snapshot["gpu_resident"] is False
        assert snapshot["current_size"] == 0

    asyncio.run(scenario())


def test_shutdown_waits_for_active_borrower_before_cleanup() -> None:
    async def scenario() -> None:
        pool = HandlePool(
            _factories(lambda: _handle(["CPUExecutionProvider"])),
            _inspect,
        )
        await pool.warmup("detector")
        entered = asyncio.Event()
        release = asyncio.Event()

        async def use() -> None:
            async with pool.borrow("detector"):
                entered.set()
                await release.wait()

        borrower = asyncio.create_task(use())
        await entered.wait()
        shutdown = asyncio.create_task(pool.shutdown())
        await asyncio.sleep(0.02)
        assert not shutdown.done()
        assert (await pool.snapshot())["borrowers"] == 1

        release.set()
        await borrower
        await asyncio.wait_for(shutdown, timeout=1.0)
        snapshot = await pool.snapshot()
        assert snapshot["current_size"] == 0
        assert snapshot["gpu_resident"] is False

    asyncio.run(scenario())


def test_cancelled_shutdown_still_cleans_up_before_reraising() -> None:
    async def scenario() -> None:
        pool = HandlePool(
            _factories(lambda: _handle(["CPUExecutionProvider"])),
            _inspect,
        )
        await pool.warmup("detector")
        entered = asyncio.Event()
        release = asyncio.Event()

        async def use() -> None:
            async with pool.borrow("detector"):
                entered.set()
                await release.wait()

        borrower = asyncio.create_task(use())
        await entered.wait()
        shutdown = asyncio.create_task(pool.shutdown())
        await asyncio.sleep(0)
        shutdown.cancel()
        await asyncio.sleep(0.02)
        shutdown.cancel()
        assert not shutdown.done()

        release.set()
        await borrower
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(asyncio.shield(shutdown), timeout=1.0)
        snapshot = await pool.snapshot()
        assert snapshot["current_size"] == 0
        assert snapshot["gpu_resident"] is False

    asyncio.run(scenario())


def test_cancelled_release_still_drops_borrower_before_returning() -> None:
    async def scenario() -> None:
        pool = HandlePool(
            _factories(lambda: _handle(["CPUExecutionProvider"])),
            _inspect,
        )
        await pool.warmup("detector")
        entered = asyncio.Event()
        leave = asyncio.Event()

        async def use() -> None:
            async with pool.borrow("detector"):
                entered.set()
                await leave.wait()

        borrower = asyncio.create_task(use())
        await entered.wait()
        await pool._lock.acquire()  # noqa: SLF001 - hold metadata release point
        leave.set()
        await asyncio.sleep(0)
        borrower.cancel()
        pool._lock.release()  # noqa: SLF001

        with pytest.raises(asyncio.CancelledError):
            await borrower
        assert (await pool.snapshot())["borrowers"] == 0

    asyncio.run(scenario())


def test_cancelled_waiter_does_not_cancel_or_hide_real_builder() -> None:
    async def scenario() -> None:
        started = threading.Event()
        release = threading.Event()

        def build():
            started.set()
            assert release.wait(2)
            return _handle(["CPUExecutionProvider"])

        pool = HandlePool(_factories(build), _inspect, build_timeout=2)
        waiter = asyncio.create_task(pool.warmup("detector"))
        assert await asyncio.to_thread(started.wait, 1)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert pool.builder_for_now("detector") is await pool.builder_for("detector")
        snapshot = await pool.snapshot()
        assert snapshot["builders"] == 1
        assert snapshot["waiters"] == 0
        assert snapshot["gpu_resident"] is None
        release.set()
        builder = await pool.builder_for("detector")
        assert builder is not None
        await builder
        snapshot = await pool.snapshot()
        assert snapshot["builders"] == 0
        assert snapshot["current_size"] == 1

    asyncio.run(scenario())


def test_residency_uses_full_provider_chains_and_true_dominates_unknown() -> None:
    async def scenario() -> None:
        providers = {
            "pipeline": SimpleNamespace(
                detector=_handle(["CPUExecutionProvider"]),
                va_classifier=SimpleNamespace(),
            ),
            "detector": _handle(["CPUExecutionProvider", "CUDAExecutionProvider"]),
            "va": _handle(["CPUExecutionProvider"]),
        }
        pool = HandlePool(
            {name: (lambda name=name: providers[name]) for name in providers},
            lambda name, handle: (
                [
                    handle.detector._onnx_session.get_providers(),
                    [],
                ]
                if name == "pipeline"
                else [handle._onnx_session.get_providers()]
            ),
        )
        await pool.warmup("pipeline")
        unknown = await pool.snapshot()
        assert unknown["handles"]["pipeline"]["resident"] is None
        assert unknown["gpu_resident"] is None
        await pool.warmup("detector")
        mixed = await pool.snapshot()
        assert mixed["handles"]["detector"]["resident"] is True
        assert mixed["gpu_resident"] is True
        assert mixed["provider"] is None
        assert mixed["handles"]["detector"]["provider"] == "CPUExecutionProvider"

    asyncio.run(scenario())


def test_cleanup_failure_stays_unknown_until_successful_full_cleanup() -> None:
    async def scenario() -> None:
        should_fail = True

        def cleanup() -> None:
            if should_fail:
                raise RuntimeError("cleanup failed")

        pool = HandlePool(
            _factories(lambda: _handle(["CUDAExecutionProvider"])),
            _inspect,
            strict_cleanup=cleanup,
        )
        await pool.warmup("detector")
        with pytest.raises(RuntimeError, match="cleanup failed"):
            await pool.unload_all(reason="manual", force_cleanup=True)
        failed = await pool.snapshot()
        assert failed["current_size"] == 0
        assert failed["cleanup_failed"] is True
        assert failed["gpu_resident"] is None

        should_fail = False
        assert await pool.unload_all(reason="manual", force_cleanup=True) == 0
        recovered = await pool.snapshot()
        assert recovered["cleanup_failed"] is False
        assert recovered["gpu_resident"] is False

    asyncio.run(scenario())
