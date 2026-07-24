"""Grounded-SAM2-specific dual-pool lifecycle behavior."""

from __future__ import annotations

import asyncio
from copy import deepcopy
import time
from typing import Any

import pytest
from aap_protocol_v2.errors import LifecycleHTTPError
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    AdmissionTokenClaims,
    LifecycleState,
    LifecycleModeRequest,
    sign_admission_token,
)
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

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


def _token(
    lifecycle: GroundedSam2GpuLifecycle,
    private_key: Ed25519PrivateKey,
    scope: AdmissionScope,
    *,
    generation: str | None = None,
    jti: str,
    owner: str = "platform-1",
    operation: str = "evict",
) -> str:
    control = scope in {
        AdmissionScope.DRAIN,
        AdmissionScope.UNLOAD,
        AdmissionScope.RESUME,
        AdmissionScope.MODE,
        AdmissionScope.RESET,
    }
    claims = AdmissionTokenClaims(
        backend_registry_id="backend-1",
        gpu_resource_id="node-a/GPU-1",
        boot_id=lifecycle.boot_id,
        generation=generation,
        control_epoch="1",
        scope=scope,
        jti=jti,
        exp=int(time.time()) + 60,
        owner=owner if control else None,
        operation=operation if control else None,
    )
    return sign_admission_token(
        claims,
        private_key=private_key,
        kid="current",
    )


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


@pytest.mark.parametrize(
    ("generation_header", "token"),
    [
        ("1", None),
        (None, "invalid-token"),
        ("1", "invalid-token"),
    ],
)
def test_legacy_workload_rejects_partial_or_invalid_managed_headers(
    generation_header: str | None,
    token: str | None,
) -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot())
        video = _FakePool(_snapshot())
        lifecycle = GroundedSam2GpuLifecycle(
            GroundedSam2Pools(image, video),
            verify_keyring={},
        )

        with pytest.raises(LifecycleHTTPError) as error:
            await lifecycle.begin_workload(
                AdmissionScope.PREDICT,
                generation_header=generation_header,
                token=token,
            )

        assert error.value.status_code == 403
        assert (await lifecycle.residency()).active_requests == 0

    _run(scenario())


def test_legacy_workload_rejects_valid_managed_headers_without_open_generation() -> (
    None
):
    async def scenario() -> None:
        image = _FakePool(_snapshot())
        video = _FakePool(_snapshot())
        private_key = Ed25519PrivateKey.generate()
        lifecycle = GroundedSam2GpuLifecycle(
            GroundedSam2Pools(image, video),
            verify_keyring={"current": private_key.public_key()},
            boot_id="boot-1",
        )
        claims = AdmissionTokenClaims(
            backend_registry_id="backend-1",
            gpu_resource_id="node-a/GPU-1",
            boot_id=lifecycle.boot_id,
            generation="1",
            control_epoch="1",
            scope=AdmissionScope.PREDICT,
            jti="legacy-managed",
            exp=int(time.time()) + 60,
        )
        token = sign_admission_token(
            claims,
            private_key=private_key,
            kid="current",
        )

        with pytest.raises(LifecycleHTTPError) as error:
            await lifecycle.begin_workload(
                AdmissionScope.PREDICT,
                generation_header="1",
                token=token,
            )

        assert error.value.status_code == 403
        assert (await lifecycle.residency()).active_requests == 0

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


def test_cancel_binds_original_operation_and_replays_exact_token() -> None:
    async def scenario() -> None:
        image = _FakePool(_snapshot())
        video = _FakePool(_snapshot())
        private_key = Ed25519PrivateKey.generate()
        lifecycle = GroundedSam2GpuLifecycle(
            GroundedSam2Pools(image, video),
            verify_keyring={"current": private_key.public_key()},
            evictable_verified=True,
            boot_id="boot-1",
        )
        await lifecycle.set_mode(
            LifecycleModeRequest(gate="enforce", control_epoch="1"),
            token=_token(
                lifecycle,
                private_key,
                AdmissionScope.MODE,
                jti="mode-1",
                operation="mode-1",
            ),
        )
        workload = await lifecycle.begin_workload(
            AdmissionScope.PREDICT,
            generation_header="1",
            token=_token(
                lifecycle,
                private_key,
                AdmissionScope.PREDICT,
                generation="1",
                jti="lease-1",
            ),
        )
        image.state.update(
            current_size=1,
            gpu_resident=True,
            device="cuda:0",
        )
        await workload.close()
        await lifecycle.drain(
            "2",
            generation_header="2",
            token=_token(
                lifecycle,
                private_key,
                AdmissionScope.DRAIN,
                generation="2",
                jti="drain-1",
                owner="owner-1",
                operation="evict",
            ),
        )

        with pytest.raises(LifecycleHTTPError) as wrong_operation:
            await lifecycle.cancel_drain(
                "3",
                generation_header="3",
                token=_token(
                    lifecycle,
                    private_key,
                    AdmissionScope.RESUME,
                    generation="3",
                    jti="resume-wrong-operation",
                    owner="owner-1",
                    operation="resume",
                ),
            )
        assert wrong_operation.value.detail["error_code"] == ("gpu_transition_conflict")
        still_draining = await lifecycle.residency()
        assert still_draining.draining is True
        assert still_draining.generation == "2"

        resume_token = _token(
            lifecycle,
            private_key,
            AdmissionScope.RESUME,
            generation="3",
            jti="resume-1",
            owner="owner-1",
            operation="evict",
        )
        resumed = await lifecycle.cancel_drain(
            "3",
            generation_header="3",
            token=resume_token,
        )
        replayed = await lifecycle.cancel_drain(
            "3",
            generation_header="3",
            token=resume_token,
        )
        assert replayed == resumed
        assert resumed.draining is False
        assert resumed.ready_to_unload is False
        assert resumed.residency.state is LifecycleState.RESIDENT
        assert resumed.residency.gpu_loaded is True

        with pytest.raises(LifecycleHTTPError) as stale_unload:
            await lifecycle.managed_unload(
                "2",
                generation_header="2",
                token=_token(
                    lifecycle,
                    private_key,
                    AdmissionScope.UNLOAD,
                    generation="2",
                    jti="late-unload",
                    owner="owner-1",
                    operation="evict",
                ),
            )
        assert stale_unload.value.detail["error_code"] == "gpu_generation_conflict"

    _run(scenario())
