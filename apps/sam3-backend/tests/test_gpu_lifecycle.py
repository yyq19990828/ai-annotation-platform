"""SAM3-specific three-pool lifecycle behavior."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Any

import pytest
from aap_protocol_v2.lifecycle import AdmissionScope, LifecycleState

from gpu_lifecycle import Sam3GpuLifecycle
from pool_domain import Sam3Pools


def _snapshot(
    *,
    size: int = 0,
    gpu: bool | None = False,
    device: str | None = None,
    cleanup_failed: bool = False,
) -> dict[str, Any]:
    return {
        "cap": 1,
        "current_size": size,
        "loaded_keys": [],
        "last_evict": None,
        "builders": 0,
        "reserved_build_slots": 0,
        "borrowers": 0,
        "waiters": 0,
        "cleanup_in_progress": False,
        "cleanup_failed": cleanup_failed,
        "gpu_resident": gpu,
        "device": device,
        "active_sessions": 0,
        "idle_seconds": 0.0,
        "idle_unload_seconds": 600.0,
    }


class _FakePool:
    def __init__(self, snapshot: dict[str, Any]) -> None:
        self.state = snapshot
        self.unloads: list[tuple[str, bool]] = []
        self.idle_unloads = 0
        self.shutdowns = 0
        self.failure: BaseException | None = None

    async def snapshot(self) -> dict[str, Any]:
        return deepcopy(self.state)

    async def unload_all(
        self,
        *,
        reason: str,
        force_cleanup: bool,
    ) -> int:
        self.unloads.append((reason, force_cleanup))
        if self.failure is not None:
            raise self.failure
        count = self.state["current_size"]
        self.state.update(
            current_size=0,
            gpu_resident=False,
            device=None,
            cleanup_failed=False,
        )
        return count

    async def unload_idle(self, *, idle_before: float) -> int:
        del idle_before
        self.idle_unloads += 1
        return await self.unload_all(reason="idle", force_cleanup=False)

    async def shutdown(self) -> None:
        self.shutdowns += 1
        await self.unload_all(reason="shutdown", force_cleanup=True)


def _run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize(
    ("image_gpu", "multiplex_gpu", "pvs_gpu", "expected"),
    [
        (True, False, False, True),
        (False, True, False, True),
        (False, False, True, True),
        (True, None, None, True),
        (False, None, False, None),
        (None, None, None, None),
        (False, False, False, False),
    ],
)
def test_three_pool_gpu_residency_truth_table(
    image_gpu: bool | None,
    multiplex_gpu: bool | None,
    pvs_gpu: bool | None,
    expected: bool | None,
) -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=int(image_gpu is True), gpu=image_gpu))
        multiplex = _FakePool(
            _snapshot(size=int(multiplex_gpu is True), gpu=multiplex_gpu)
        )
        pvs = _FakePool(_snapshot(size=int(pvs_gpu is True), gpu=pvs_gpu))
        snapshot = await Sam3Pools(image, multiplex, pvs).snapshot()
        assert snapshot["gpu_resident"] is expected

    _run(scenario())


def test_full_unload_attempts_both_video_pools_after_image_failure() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        multiplex = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        pvs = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        image.failure = RuntimeError("image cleanup failed")
        domain = Sam3Pools(image, multiplex, pvs)
        with pytest.raises(RuntimeError, match="image cleanup failed"):
            await domain.unload_all(reason="manual", force_cleanup=True)
        assert image.unloads == [("manual", True)]
        assert multiplex.unloads == [("manual", True)]
        assert pvs.unloads == [("manual", True)]
        assert multiplex.state["current_size"] == 0
        assert pvs.state["current_size"] == 0

    _run(scenario())


def test_legacy_unload_clears_all_pools_and_preserves_wire_shape() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        multiplex = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        pvs = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        lifecycle = Sam3GpuLifecycle(
            Sam3Pools(image, multiplex, pvs),
            verify_keyring={},
        )
        response = await lifecycle.legacy_unload()
        assert response == {
            "ok": True,
            "unloaded": True,
            "loaded": False,
            "video_loaded": False,
        }
        assert image.state["current_size"] == 0
        assert multiplex.state["current_size"] == 0
        assert pvs.state["current_size"] == 0

    _run(scenario())


def test_residency_reports_all_pool_devices() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        multiplex = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        pvs = _FakePool(_snapshot())
        lifecycle = Sam3GpuLifecycle(
            Sam3Pools(image, multiplex, pvs),
            verify_keyring={},
        )
        residency = await lifecycle.residency()
        assert residency.gpu_loaded is True
        assert residency.pools["image"].resident is True
        assert residency.pools["image"].device == "cuda:0"
        assert residency.pools["multiplex_video"].resident is True
        assert residency.pools["multiplex_video"].device == "cuda:0"
        assert residency.pools["pvs_video"].resident is False

    _run(scenario())


def test_active_workload_before_pool_acquire_cannot_report_trusted_empty() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot())
        multiplex = _FakePool(_snapshot())
        pvs = _FakePool(_snapshot())
        lifecycle = Sam3GpuLifecycle(
            Sam3Pools(image, multiplex, pvs),
            verify_keyring={},
        )

        operation = await lifecycle.begin_workload(
            AdmissionScope.PREDICT,
            generation_header=None,
            token=None,
        )
        residency = await lifecycle.residency()
        assert residency.active_requests == 1
        assert residency.gpu_loaded is None
        assert residency.state is LifecycleState.UNKNOWN

        await operation.close()
        residency = await lifecycle.residency()
        assert residency.active_requests == 0
        assert residency.gpu_loaded is False
        assert residency.state is LifecycleState.UNLOADED

    _run(scenario())


def test_partial_idle_unload_keeps_managed_generation_open() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        multiplex = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        pvs = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        lifecycle = Sam3GpuLifecycle(
            Sam3Pools(image, multiplex, pvs),
            verify_keyring={},
        )
        lifecycle._generation = "7"  # noqa: SLF001 - isolate idle generation rule
        lifecycle._generation_open = True  # noqa: SLF001

        assert await lifecycle.try_idle_unload("image", idle_before=1.0) == 1
        assert lifecycle._generation_open is True  # noqa: SLF001
        assert await lifecycle.try_idle_unload("multiplex_video", idle_before=1.0) == 1
        assert lifecycle._generation_open is True  # noqa: SLF001
        assert await lifecycle.try_idle_unload("pvs_video", idle_before=1.0) == 1
        assert lifecycle._generation_open is False  # noqa: SLF001

    _run(scenario())
