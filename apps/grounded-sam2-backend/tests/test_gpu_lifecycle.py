"""Grounded-SAM2-specific dual-pool lifecycle behavior."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Any

import pytest
from aap_protocol_v2.lifecycle import AdmissionScope, LifecycleState

from gpu_lifecycle import GroundedSam2GpuLifecycle
from pool_domain import GroundedSam2Pools


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
    ("image_gpu", "video_gpu", "expected"),
    [
        (True, False, True),
        (False, True, True),
        (True, None, True),
        (False, None, None),
        (None, None, None),
        (False, False, False),
    ],
)
def test_dual_pool_gpu_residency_truth_table(
    image_gpu: bool | None,
    video_gpu: bool | None,
    expected: bool | None,
) -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=int(image_gpu is True), gpu=image_gpu))
        video = _FakePool(_snapshot(size=int(video_gpu is True), gpu=video_gpu))
        snapshot = await GroundedSam2Pools(image, video).snapshot()
        assert snapshot["gpu_resident"] is expected

    _run(scenario())


def test_full_unload_attempts_video_after_image_failure() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        video = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        image.failure = RuntimeError("image cleanup failed")
        domain = GroundedSam2Pools(image, video)
        with pytest.raises(RuntimeError, match="image cleanup failed"):
            await domain.unload_all(reason="manual", force_cleanup=True)
        assert image.unloads == [("manual", True)]
        assert video.unloads == [("manual", True)]
        assert video.state["current_size"] == 0

    _run(scenario())


def test_legacy_unload_is_image_only_and_preserves_wire_shape() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        video = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        lifecycle = GroundedSam2GpuLifecycle(
            GroundedSam2Pools(image, video),
            verify_keyring={},
        )
        response = await lifecycle.legacy_unload()
        assert response == {"ok": True, "unloaded": True, "loaded": False}
        assert image.state["current_size"] == 0
        assert video.state["current_size"] == 1
        assert video.unloads == []

    _run(scenario())


def test_residency_reports_image_and_video_devices() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        video = _FakePool(_snapshot(size=1, gpu=False, device="cpu"))
        lifecycle = GroundedSam2GpuLifecycle(
            GroundedSam2Pools(image, video),
            verify_keyring={},
        )
        residency = await lifecycle.residency()
        assert residency.gpu_loaded is True
        assert residency.pools["image"].resident is True
        assert residency.pools["image"].device == "cuda:0"
        assert residency.pools["video"].resident is False
        assert residency.pools["video"].device == "cpu"

    _run(scenario())


def test_active_workload_before_pool_acquire_cannot_report_trusted_empty() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot())
        video = _FakePool(_snapshot())
        lifecycle = GroundedSam2GpuLifecycle(
            GroundedSam2Pools(image, video),
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
        video = _FakePool(_snapshot(size=1, gpu=True, device="cuda:0"))
        lifecycle = GroundedSam2GpuLifecycle(
            GroundedSam2Pools(image, video),
            verify_keyring={},
        )
        lifecycle._generation = "7"  # noqa: SLF001 - isolate idle generation rule
        lifecycle._generation_open = True  # noqa: SLF001

        assert await lifecycle.try_idle_unload("image", idle_before=1.0) == 1
        assert lifecycle._generation_open is True  # noqa: SLF001
        assert await lifecycle.try_idle_unload("video", idle_before=1.0) == 1
        assert lifecycle._generation_open is False  # noqa: SLF001

    _run(scenario())
