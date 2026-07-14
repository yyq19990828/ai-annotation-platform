"""Run the SAM3 managed-lifecycle deployment gate on a real GPU.

The script is intentionally self-contained: it creates an ephemeral signing key,
drives the ASGI app in-process, generates synthetic image/video inputs under /tmp,
and removes them before exit. Run it only in the deployment image with checkpoint
and GPU mounts equivalent to the target service.
"""

from __future__ import annotations

import asyncio
import gc
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from statistics import median
from typing import Any

import cv2
import httpx
import numpy as np
from PIL import Image, ImageDraw
from aap_protocol_v2.lifecycle import (
    AdmissionScope,
    AdmissionTokenClaims,
    GPU_ADMISSION_TOKEN_HEADER,
    GPU_GENERATION_HEADER,
    encode_ed25519_public_key,
    sign_admission_token,
)
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


CONTROL_SCOPES = {
    AdmissionScope.DRAIN,
    AdmissionScope.UNLOAD,
    AdmissionScope.RESUME,
    AdmissionScope.MODE,
    AdmissionScope.RESET,
}
REGISTRY_ID = "sam3-validation"
RESOURCE_ID = "local-validation-gpu"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _gpu_memory_mb(target_uuid: str | None) -> int:
    output = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-gpu=uuid,memory.used",
            "--format=csv,noheader,nounits",
        ],
        text=True,
    )
    rows = [line.split(",", 1) for line in output.splitlines() if line.strip()]
    if target_uuid:
        for gpu_uuid, used in rows:
            if gpu_uuid.strip() == target_uuid:
                return int(used.strip())
        raise RuntimeError(f"GPU UUID {target_uuid!r} is not visible")
    if len(rows) != 1:
        raise RuntimeError("VALIDATION_GPU_UUID is required when multiple GPUs are visible")
    return int(rows[0][1].strip())


def _gpu_total_memory_mb(target_uuid: str | None) -> int:
    output = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-gpu=uuid,memory.total",
            "--format=csv,noheader,nounits",
        ],
        text=True,
    )
    rows = [line.split(",", 1) for line in output.splitlines() if line.strip()]
    if target_uuid:
        for gpu_uuid, total in rows:
            if gpu_uuid.strip() == target_uuid:
                return int(total.strip())
        raise RuntimeError(f"GPU UUID {target_uuid!r} is not visible")
    if len(rows) != 1:
        raise RuntimeError("VALIDATION_GPU_UUID is required when multiple GPUs are visible")
    return int(rows[0][1].strip())


def _gpu_compute_processes(target_uuid: str | None) -> list[dict[str, int | str]]:
    output = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-compute-apps=gpu_uuid,pid,used_gpu_memory",
            "--format=csv,noheader,nounits",
        ],
        text=True,
    )
    processes: list[dict[str, int | str]] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        gpu_uuid, pid, used = (part.strip() for part in line.split(",", 2))
        if target_uuid is None or gpu_uuid == target_uuid:
            processes.append(
                {"gpu_uuid": gpu_uuid, "pid": int(pid), "used_memory_mb": int(used)}
            )
    return processes


def _gpu_memory_samples(target_uuid: str | None, *, count: int = 5) -> list[int]:
    samples: list[int] = []
    for _ in range(count):
        samples.append(_gpu_memory_mb(target_uuid))
        time.sleep(0.5)
    return samples


def _torch_memory_mb(torch_module: Any) -> dict[str, int]:
    torch_module.cuda.synchronize()
    allocated = torch_module.cuda.memory_allocated()
    reserved = torch_module.cuda.memory_reserved()
    return {
        "allocated_mb": int(allocated / 1024**2),
        "reserved_mb": int(reserved / 1024**2),
        "allocated_bytes": allocated,
        "reserved_bytes": reserved,
    }


def _initialize_context_baseline(
    torch_module: Any,
    target_uuid: str | None,
) -> dict[str, Any]:
    marker = torch_module.empty(1, device="cuda")
    torch_module.cuda.synchronize()
    del marker
    gc.collect()
    torch_module.clear_autocast_cache()
    torch_module.cuda.empty_cache()
    torch_module.cuda.ipc_collect()
    torch_memory = _torch_memory_mb(torch_module)
    if torch_memory["allocated_bytes"] or torch_memory["reserved_bytes"]:
        raise AssertionError(
            f"context-only probe retained PyTorch memory: {torch_memory}"
        )
    samples = _gpu_memory_samples(target_uuid)
    return {
        "samples_mb": samples,
        "torch": torch_memory,
        "compute_processes": _gpu_compute_processes(target_uuid),
    }


def _assert_pool_domain_empty(snapshot: dict[str, Any]) -> None:
    for pool_id, pool in snapshot["pools"].items():
        assert pool["current_size"] == 0, pool_id
        assert pool["builders"] == 0, pool_id
        assert pool["reserved_build_slots"] == 0, pool_id
        assert pool["borrowers"] == 0, pool_id
        assert pool["waiters"] == 0, pool_id
        assert pool["cleanup_in_progress"] is False, pool_id
        assert pool["cleanup_failed"] is False, pool_id
        assert pool["gpu_resident"] is False, pool_id


def _assert_unloaded_cycle(
    *,
    residency: dict[str, Any],
    samples: list[int],
    torch_memory: dict[str, int],
    pool_snapshot: dict[str, Any],
) -> None:
    assert residency["state"] == "unloaded"
    assert residency["gpu_loaded"] is False
    # `evictable` describes a resident allocation that can be selected as a
    # victim. An already-unloaded generation is therefore intentionally false.
    assert residency["evictable"] is False
    assert residency["active_requests"] == 0
    assert residency["builders"] == 0
    assert residency["borrowers"] == 0
    assert all(
        pool["resident"] is False for pool in residency["pools"].values()
    )
    _assert_pool_domain_empty(pool_snapshot)
    if max(samples) - min(samples) > 64:
        raise AssertionError(f"unloaded GPU memory did not stabilize: {samples}")
    tolerance_bytes = 64 * 1024**2
    if (
        torch_memory["allocated_bytes"] > tolerance_bytes
        or torch_memory["reserved_bytes"] > tolerance_bytes
    ):
        raise AssertionError(
            "managed unload left PyTorch-owned GPU memory: "
            f"{torch_memory}"
        )


def _assert_repeated_memory_recovery(memory: dict[str, Any]) -> None:
    context = memory["context_baseline"]["samples_mb"]
    first = memory["cycle_1_unloaded_mb"]
    second = memory["cycle_2_unloaded_mb"]
    if abs(median(first) - median(second)) > 64:
        raise AssertionError(
            "unloaded GPU baseline drifted between generations: "
            f"cycle_1={first}, cycle_2={second}"
        )
    context_median = median(context)
    slack_mb = max(512, int(memory["gpu_total_mb"] * 0.02))
    for cycle in (1, 2):
        loaded = memory[f"cycle_{cycle}_loaded_mb"]
        unloaded = memory[f"cycle_{cycle}_unloaded_mb"]
        unloaded_median = median(unloaded)
        if unloaded_median > context_median + slack_mb:
            raise AssertionError(
                f"cycle {cycle} did not return to the CUDA context baseline: "
                f"context={context}, unloaded={unloaded}, slack_mb={slack_mb}"
            )
        working_set = loaded - context_median
        recovered = loaded - unloaded_median
        if working_set <= 0 or recovered / working_set < 0.90:
            raise AssertionError(
                f"cycle {cycle} recovered less than 90% of its model working set: "
                f"context={context_median}, loaded={loaded}, unloaded={unloaded}"
            )


def _make_inputs(root: Path) -> tuple[Path, Path]:
    root.mkdir(parents=True, exist_ok=True)
    image_path = root / "image.png"
    image = Image.new("RGB", (256, 256), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((48, 64, 176, 192), fill="red")
    draw.ellipse((120, 40, 220, 140), fill="blue")
    image.save(image_path)

    video_path = root / "video.mp4"
    writer = cv2.VideoWriter(
        str(video_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        4.0,
        (256, 256),
    )
    if not writer.isOpened():
        raise RuntimeError("failed to create validation video")
    try:
        for index in range(4):
            frame = np.full((256, 256, 3), 255, dtype=np.uint8)
            x = 36 + index * 12
            cv2.rectangle(frame, (x, 72), (x + 112, 184), (0, 0, 255), -1)
            writer.write(frame)
    finally:
        writer.release()
    return image_path, video_path


async def _run() -> dict[str, Any]:
    private_key = Ed25519PrivateKey.generate()
    os.environ["GPU_LIFECYCLE_VERIFY_KEYS_JSON"] = json.dumps(
        {"validation": encode_ed25519_public_key(private_key.public_key())}
    )
    os.environ["SAM3_MANAGED_LIFECYCLE_VERIFIED"] = "1"
    os.environ["SAM3_IDLE_UNLOAD_SECONDS"] = "0"
    os.environ["SAM3_MODEL_POOL_BUILD_TIMEOUT"] = "300"

    sys.path.insert(0, "/app")
    import main  # noqa: PLC0415

    validation_root = Path(tempfile.mkdtemp(prefix="sam3_lifecycle_validation_"))
    image_path, video_path = _make_inputs(validation_root)
    target_uuid = os.getenv("VALIDATION_GPU_UUID") or None
    timings_ms: dict[str, int] = {}
    memory: dict[str, Any] = {}

    await main._load_models()  # noqa: SLF001
    assert main._gpu_lifecycle is not None  # noqa: SLF001
    boot_id = main._gpu_lifecycle.boot_id  # noqa: SLF001

    def token(
        scope: AdmissionScope,
        *,
        generation: str | None = None,
        control_epoch: str = "2",
        owner: str = "validation",
        operation: str = "validation",
    ) -> str:
        control = scope in CONTROL_SCOPES
        claims = AdmissionTokenClaims(
            backend_registry_id=REGISTRY_ID,
            gpu_resource_id=RESOURCE_ID,
            boot_id=boot_id,
            generation=generation,
            control_epoch=control_epoch,
            scope=scope,
            jti=f"validation-{scope.value}-{uuid.uuid4().hex}",
            exp=int(time.time()) + 1800,
            owner=owner if control else None,
            operation=operation if control else None,
        )
        return sign_admission_token(
            claims,
            private_key=private_key,
            kid="validation",
        )

    def headers(scope: AdmissionScope, generation: str) -> dict[str, str]:
        return {
            GPU_GENERATION_HEADER: generation,
            GPU_ADMISSION_TOKEN_HEADER: token(scope, generation=generation),
        }

    async def checked_post(
        client: httpx.AsyncClient,
        path: str,
        *,
        json_body: dict[str, Any],
        request_headers: dict[str, str],
    ) -> dict[str, Any]:
        started = time.perf_counter()
        response = await client.post(path, json=json_body, headers=request_headers)
        timings_ms[f"{path}:{len(timings_ms)}"] = int(
            (time.perf_counter() - started) * 1000
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"{path} returned {response.status_code}: {response.text[:1000]}"
            )
        return response.json()

    transport = httpx.ASGITransport(app=main.app)
    try:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://sam3-validation",
            timeout=600,
        ) as client:
            reset = await checked_post(
                client,
                "/lifecycle/reset",
                json_body={"control_epoch": "1"},
                request_headers={
                    GPU_ADMISSION_TOKEN_HEADER: token(
                        AdmissionScope.RESET,
                        control_epoch="1",
                        operation="reset-1",
                    )
                },
            )
            assert reset["residency"]["gpu_loaded"] is False
            memory["cold_card_baseline_mb"] = _gpu_memory_mb(target_uuid)
            cold_processes = _gpu_compute_processes(target_uuid)
            if cold_processes:
                raise RuntimeError(
                    "validation GPU is not isolated before CUDA initialization: "
                    f"{cold_processes}"
                )
            memory["gpu_total_mb"] = _gpu_total_memory_mb(target_uuid)
            memory["context_baseline"] = _initialize_context_baseline(
                main.torch,
                target_uuid,
            )
            if len(memory["context_baseline"]["compute_processes"]) != 1:
                raise RuntimeError(
                    "validation process is not the sole compute process on the target GPU: "
                    f"{memory['context_baseline']['compute_processes']}"
                )

            mode = await checked_post(
                client,
                "/lifecycle/mode",
                json_body={"gate": "enforce", "control_epoch": "2"},
                request_headers={
                    GPU_ADMISSION_TOKEN_HEADER: token(
                        AdmissionScope.MODE,
                        control_epoch="2",
                        operation="mode-2",
                    )
                },
            )
            assert mode["gate"] == "enforce"

            await checked_post(
                client,
                "/predict",
                json_body={
                    "task": {"file_path": str(image_path)},
                    "context": {
                        "type": "point",
                        "points": [[0.5, 0.5]],
                        "labels": [1],
                    },
                },
                request_headers=headers(AdmissionScope.PREDICT, "1"),
            )
            await checked_post(
                client,
                "/predict",
                json_body={
                    "task": {"file_path": str(video_path)},
                    "context": {
                        "type": "video_tracker",
                        "model_key": "sam3_video",
                        "from_frame": 0,
                        "to_frame": 3,
                        "direction": "forward",
                        "text": "red square",
                        "output_geometry": "bbox",
                    },
                },
                request_headers=headers(AdmissionScope.PREDICT, "1"),
            )
            await checked_post(
                client,
                "/predict",
                json_body={
                    "task": {"file_path": str(video_path)},
                    "context": {
                        "type": "video_tracker",
                        "model_key": "sam3_video_interactive",
                        "from_frame": 0,
                        "to_frame": 3,
                        "direction": "forward",
                        "output_geometry": "bbox",
                        "seeds": [
                            {
                                "obj_id": 1,
                                "bbox": {"x": 0.14, "y": 0.28, "w": 0.44, "h": 0.44},
                            }
                        ],
                    },
                },
                request_headers=headers(AdmissionScope.PREDICT, "1"),
            )

            health = (await client.get("/health")).json()
            residency = health["residency"]
            assert residency["gpu_loaded"] is True
            assert residency["evictable"] is True
            assert all(
                residency["pools"][pool_id]["resident"] is True
                for pool_id in ("image", "multiplex_video", "pvs_video")
            )
            assert health["video_pool"]["active_sessions"] == 0
            memory["cycle_1_loaded_mb"] = _gpu_memory_mb(target_uuid)

            drain_owner = "cycle-1"
            await checked_post(
                client,
                "/drain",
                json_body={"generation": "2"},
                request_headers={
                    GPU_GENERATION_HEADER: "2",
                    GPU_ADMISSION_TOKEN_HEADER: token(
                        AdmissionScope.DRAIN,
                        generation="2",
                        operation=drain_owner,
                    ),
                },
            )
            unloaded = await checked_post(
                client,
                "/unload",
                json_body={"generation": "2"},
                request_headers={
                    GPU_GENERATION_HEADER: "2",
                    GPU_ADMISSION_TOKEN_HEADER: token(
                        AdmissionScope.UNLOAD,
                        generation="2",
                        operation=drain_owner,
                    ),
                },
            )
            assert unloaded["unloaded_count"] == 3
            assert unloaded["residency"]["gpu_loaded"] is False
            memory["cycle_1_unloaded_mb"] = _gpu_memory_samples(target_uuid)
            memory["cycle_1_torch_unloaded_mb"] = _torch_memory_mb(main.torch)
            cycle_1_pool = await main._pool_domain.snapshot()  # noqa: SLF001
            _assert_unloaded_cycle(
                residency=unloaded["residency"],
                samples=memory["cycle_1_unloaded_mb"],
                torch_memory=memory["cycle_1_torch_unloaded_mb"],
                pool_snapshot=cycle_1_pool,
            )

            for task in (None, "tracker", "interactive"):
                body = {} if task is None else {"task": task}
                await checked_post(
                    client,
                    "/warmup",
                    json_body=body,
                    request_headers=headers(AdmissionScope.WARMUP, "3"),
                )
            health = (await client.get("/health")).json()
            assert health["residency"]["gpu_loaded"] is True
            assert health["residency"]["evictable"] is True
            assert all(
                health["residency"]["pools"][pool_id]["resident"] is True
                for pool_id in ("image", "multiplex_video", "pvs_video")
            )
            memory["cycle_2_loaded_mb"] = _gpu_memory_mb(target_uuid)

            drain_owner = "cycle-2"
            await checked_post(
                client,
                "/drain",
                json_body={"generation": "4"},
                request_headers={
                    GPU_GENERATION_HEADER: "4",
                    GPU_ADMISSION_TOKEN_HEADER: token(
                        AdmissionScope.DRAIN,
                        generation="4",
                        operation=drain_owner,
                    ),
                },
            )
            unloaded = await checked_post(
                client,
                "/unload",
                json_body={"generation": "4"},
                request_headers={
                    GPU_GENERATION_HEADER: "4",
                    GPU_ADMISSION_TOKEN_HEADER: token(
                        AdmissionScope.UNLOAD,
                        generation="4",
                        operation=drain_owner,
                    ),
                },
            )
            assert unloaded["unloaded_count"] == 3
            final_health = (await client.get("/health")).json()
            assert final_health["residency"]["gpu_loaded"] is False
            assert final_health["cache"]["size"] == 0
            assert final_health["video_pool"]["active_sessions"] == 0
            memory["cycle_2_unloaded_mb"] = _gpu_memory_samples(target_uuid)
            memory["cycle_2_torch_unloaded_mb"] = _torch_memory_mb(main.torch)
            cycle_2_pool = await main._pool_domain.snapshot()  # noqa: SLF001
            _assert_unloaded_cycle(
                residency=final_health["residency"],
                samples=memory["cycle_2_unloaded_mb"],
                torch_memory=memory["cycle_2_torch_unloaded_mb"],
                pool_snapshot=cycle_2_pool,
            )

        _assert_repeated_memory_recovery(memory)

        leftovers = [
            str(path)
            for pattern in ("sam3vid_*", "sam3pvs_*", "sam3vid_src_*")
            for path in Path("/tmp").glob(pattern)
            if path != validation_root
        ]
        if leftovers:
            raise RuntimeError(f"temporary video artifacts remain: {leftovers}")

        checkpoint_dir = Path(os.getenv("CHECKPOINT_DIR", "/app/checkpoints"))
        checkpoints = {
            name: {
                "size": (checkpoint_dir / name).stat().st_size,
                "sha256": _sha256(checkpoint_dir / name),
            }
            for name in ("sam3.pt", "sam3.1_multiplex.pt")
        }
        return {
            "image_id": os.getenv("VALIDATION_IMAGE_ID"),
            "gpu_uuid": target_uuid,
            "boot_id": boot_id,
            "checkpoints": checkpoints,
            "timings_ms": timings_ms,
            "memory_mb": memory,
            "final_residency": final_health["residency"],
        }
    finally:
        try:
            await main._shutdown()  # noqa: SLF001
        finally:
            shutil.rmtree(validation_root, ignore_errors=True)


def main() -> None:
    print(json.dumps(asyncio.run(_run()), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
