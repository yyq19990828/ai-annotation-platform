"""SAM3 admission ordering and legacy wire compatibility."""

from __future__ import annotations

import asyncio
import sys
import threading
from types import ModuleType
from unittest.mock import MagicMock

import httpx
import pytest
from aap_protocol_v2.errors import LifecycleErrorCode, LifecycleHTTPError


def _load_main():
    sys.modules.setdefault(
        "torch",
        MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False))),
    )
    sys.modules.setdefault("cv2", MagicMock())
    if "mask_utils" not in sys.modules:
        mask_utils = ModuleType("mask_utils")
        mask_utils.MultiPolygonRing = dict
        mask_utils.mask_to_multi_polygon = MagicMock(return_value=[])
        polygon = ModuleType("mask_utils.polygon")
        polygon.mask_to_polygon = MagicMock(return_value=[])
        rle = ModuleType("mask_utils.rle")
        rle.encode_coco_rle = MagicMock(return_value={})
        sys.modules["mask_utils"] = mask_utils
        sys.modules["mask_utils.polygon"] = polygon
        sys.modules["mask_utils.rle"] = rle
    import main

    return main


class _Operation:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.futures = []

    def track_future(self, future) -> None:
        if future is not None:
            self.futures.append(future)

    async def close(self) -> None:
        self.events.append("close")


class _Lifecycle:
    def __init__(self, *, deny: bool = False) -> None:
        self.deny = deny
        self.events: list[str] = []

    async def begin_workload(self, scope, **_headers):
        self.events.append(f"begin:{scope.value}")
        if self.deny:
            raise LifecycleHTTPError(LifecycleErrorCode.ADMISSION_DENIED)
        return _Operation(self.events)

    async def legacy_unload(self):
        return {
            "ok": True,
            "unloaded": True,
            "loaded": False,
            "video_loaded": False,
        }


class _Pool:
    async def warmup(self, _key):
        return False, 12, None

    def builder_for_now(self, _key):
        return None


async def _request(method: str, path: str, **kwargs):
    main = _load_main()
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as client:
        return await client.request(method, path, **kwargs)


def _run(coro):
    return asyncio.run(coro)


def test_typed_warmup_admits_before_malformed_json(monkeypatch) -> None:
    main = _load_main()
    lifecycle = _Lifecycle()
    monkeypatch.setattr(main, "_gpu_lifecycle", lifecycle)
    response = _run(
        _request(
            "POST",
            "/warmup",
            content=b"{",
            headers={"content-type": "application/json"},
        )
    )
    assert response.status_code == 422
    assert lifecycle.events == ["begin:warmup", "close"]


def test_admission_denial_wins_over_invalid_body(monkeypatch) -> None:
    main = _load_main()
    lifecycle = _Lifecycle(deny=True)
    monkeypatch.setattr(main, "_gpu_lifecycle", lifecycle)
    response = _run(
        _request(
            "POST",
            "/warmup",
            content=b"{",
            headers={"content-type": "application/json"},
        )
    )
    assert response.status_code == 403
    assert response.json()["detail"]["error_code"] == "gpu_admission_denied"
    assert lifecycle.events == ["begin:warmup"]


def test_predict_keeps_legacy_malformed_json_400(monkeypatch) -> None:
    main = _load_main()
    lifecycle = _Lifecycle()
    monkeypatch.setattr(main, "_gpu_lifecycle", lifecycle)
    response = _run(
        _request(
            "POST",
            "/predict",
            content=b"{",
            headers={"content-type": "application/json"},
        )
    )
    assert response.status_code == 400
    assert lifecycle.events == ["begin:predict", "close"]


def test_reload_success_wire_is_unchanged(monkeypatch) -> None:
    main = _load_main()
    lifecycle = _Lifecycle()
    monkeypatch.setattr(main, "_gpu_lifecycle", lifecycle)
    monkeypatch.setattr(main, "_image_pool", _Pool())
    response = _run(_request("POST", "/reload"))
    assert response.status_code == 200
    assert response.json() == {"ok": True, "loaded": True, "reloaded": True}
    assert lifecycle.events == ["begin:reload", "close"]


def test_bodyless_unload_keeps_full_pool_legacy_wire(monkeypatch) -> None:
    main = _load_main()
    lifecycle = _Lifecycle()
    monkeypatch.setattr(main, "_gpu_lifecycle", lifecycle)
    response = _run(_request("POST", "/unload"))
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "unloaded": True,
        "loaded": False,
        "video_loaded": False,
    }


def test_cancelled_image_inference_holds_lease_until_thread_finishes(
    monkeypatch,
) -> None:
    main = _load_main()
    from managed_pool import BuildArtifact, ManagedLruPool, ManagedPoolBusyError

    started = threading.Event()
    release = threading.Event()

    class _Predictor:
        device = "cuda:0"
        cleanup_uncertain = False

        def predict_interactive(self, *_args, **_kwargs):
            started.set()
            release.wait(timeout=5)
            return [], False, None

    async def scenario() -> None:
        pool = ManagedLruPool(
            1,
            lambda _key: BuildArtifact(_Predictor()),
            str,
            lambda: None,
        )
        monkeypatch.setattr(main, "_image_pool", pool)
        monkeypatch.setattr(main, "fetch_image", lambda *_args, **_kwargs: object())
        main._cache.clear()
        operation = _Operation([])
        task = asyncio.create_task(
            main._run_prompt(
                "image.jpg",
                {"type": "point", "points": [[0.5, 0.5]]},
                operation,
            )
        )
        while not started.is_set():
            await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        with pytest.raises(ManagedPoolBusyError):
            await pool.unload_all(reason="manual")
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert all(future.done() for future in operation.futures)
        assert await pool.unload_all(reason="manual") == 1
        await pool.shutdown()

    _run(scenario())


@pytest.mark.parametrize("kind", ["multiplex", "pvs"])
def test_cancelled_video_keeps_source_and_borrower_until_thread_finishes(
    monkeypatch,
    tmp_path,
    kind: str,
) -> None:
    main = _load_main()
    from managed_pool import BuildArtifact, ManagedLruPool, ManagedPoolBusyError

    started = threading.Event()
    release = threading.Event()
    local_path = tmp_path / f"{kind}.mp4"
    local_path.write_bytes(b"video")

    class _Tracker:
        device = "cuda:0"
        active_sessions = 0
        cleanup_uncertain = False

        def propagate(self, *_args, **_kwargs):
            assert local_path.exists()
            started.set()
            release.wait(timeout=5)
            assert local_path.exists()
            return []

    async def scenario() -> None:
        pool = ManagedLruPool(
            1,
            lambda _key: BuildArtifact(_Tracker()),
            str,
            lambda: None,
        )
        monkeypatch.setattr(main, "_video_local_path", lambda _path: str(local_path))
        operation = _Operation([])
        if kind == "multiplex":
            monkeypatch.setattr(main, "_multiplex_pool", pool)
            target = main._run_video_tracker
            ctx = {
                "from_frame": 0,
                "to_frame": 1,
                "text": "car",
            }
        else:
            monkeypatch.setattr(main, "_pvs_pool", pool)
            target = main._run_pvs_video_tracker
            ctx = {
                "from_frame": 0,
                "to_frame": 1,
                "seeds": [{"obj_id": 1, "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}}],
            }
        task = asyncio.create_task(target("https://example.invalid/video.mp4", ctx, operation))
        while not started.is_set():
            await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        assert local_path.exists()
        assert not task.done()
        with pytest.raises(ManagedPoolBusyError):
            await pool.unload_all(reason="manual")
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not local_path.exists()
        assert await pool.unload_all(reason="manual") == 1
        await pool.shutdown()

    _run(scenario())
