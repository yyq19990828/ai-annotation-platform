"""VehicleAttributePredictor borrower routing and ORT provider inspection tests."""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import numpy as np
import pytest

import predictor as pred
from handle_pool import HandlePool
from predictor import VehicleAttributePredictor, inspect_handle_providers


class _FakeSession:
    def __init__(self, providers=None):
        self.providers = list(providers or ["CPUExecutionProvider"])

    def get_providers(self):
        return list(self.providers)


class _DetResult:
    def __init__(self) -> None:
        self.boxes = [[10.0, 20.0, 90.0, 180.0]]
        self.class_ids = [2]
        self.scores = [0.91]

    def __len__(self) -> int:
        return 1


class _FakeDetector:
    def __init__(self) -> None:
        self.class_names = {0: "person", 2: "car"}
        self._onnx_session = _FakeSession()

    def __call__(self, _img: np.ndarray) -> _DetResult:
        return _DetResult()


class _VAResult:
    labels = ["school_bus", "blue"]
    confidences = [0.93, 0.88]


class _FakeVA:
    def __init__(self) -> None:
        self._onnx_session = _FakeSession()

    def __call__(self, _img: np.ndarray) -> _VAResult:
        return _VAResult()


class _FakePipeline:
    def __init__(self) -> None:
        self.detector = _FakeDetector()
        self.va_classifier = _FakeVA()

    def __call__(self, _img: np.ndarray) -> list[dict]:
        return [
            {
                "type": "car",
                "box2d": [10.0, 20.0, 90.0, 180.0],
                "score": 0.9,
                "vehicle_type": "school_bus",
                "color": "blue",
            }
        ]


def _counting_factory(obj):
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return obj

    return factory, calls


@pytest.fixture
def fake_image(monkeypatch):
    img = np.zeros((200, 100, 3), dtype=np.uint8)
    monkeypatch.setattr(pred, "load_image_bgr", lambda *args, **kwargs: img)
    return img


def _make(det=None, va=None, pipeline=None):
    detector_factory, detector_calls = _counting_factory(det or _FakeDetector())
    va_factory, va_calls = _counting_factory(va or _FakeVA())
    pipeline_factory, pipeline_calls = _counting_factory(pipeline or _FakePipeline())
    pool = HandlePool(
        {
            "detector": detector_factory,
            "va": va_factory,
            "pipeline": pipeline_factory,
        },
        inspect_handle_providers,
    )
    return (
        VehicleAttributePredictor(pool),
        pool,
        detector_calls,
        va_calls,
        pipeline_calls,
    )


@pytest.mark.asyncio
async def test_construction_is_lazy_and_detect_only_loads_detector(fake_image) -> None:
    predictor, pool, detector_calls, va_calls, pipeline_calls = _make()
    assert (await pool.snapshot())["current_size"] == 0
    assert (detector_calls["n"], va_calls["n"], pipeline_calls["n"]) == (0, 0, 0)

    items, cache_hit, load_ms, _inference_ms = await predictor.predict_one(
        "unused",
        "detector",
    )

    assert cache_hit is False
    assert load_ms is not None
    assert items[0]["value"]["rectanglelabels"] == ["car"]
    assert "attributes" not in items[0]
    assert (detector_calls["n"], va_calls["n"], pipeline_calls["n"]) == (1, 0, 0)


@pytest.mark.asyncio
async def test_classify_only_loads_va_and_emits_attributes(fake_image) -> None:
    predictor, _pool, detector_calls, va_calls, pipeline_calls = _make()

    items, *_ = await predictor.predict_one("unused", "va")

    assert items[0]["attributes"] == {
        "vehicle_type": "school_bus",
        "color": "blue",
    }
    assert (detector_calls["n"], va_calls["n"], pipeline_calls["n"]) == (0, 1, 0)


@pytest.mark.asyncio
async def test_handle_is_cached_across_predictions_and_full_unload_rebuilds(
    fake_image,
) -> None:
    predictor, pool, detector_calls, _va_calls, _pipeline_calls = _make()

    await predictor.predict_one("unused", "detector")
    second = await predictor.predict_one("unused", "detector")
    assert second[1] is True
    assert detector_calls["n"] == 1

    assert await pool.unload_all(reason="manual", force_cleanup=True) == 1
    assert (await pool.snapshot())["gpu_resident"] is False
    await predictor.predict_one("unused", "detector")
    assert detector_calls["n"] == 2


@pytest.mark.asyncio
async def test_pipeline_owns_two_sessions_and_maps_composite_output(fake_image) -> None:
    predictor, pool, detector_calls, va_calls, pipeline_calls = _make()

    items, *_ = await predictor.predict_one("unused", "pipeline")
    snapshot = await pool.snapshot()

    assert items[0]["attributes"] == {
        "vehicle_type": "school_bus",
        "color": "blue",
    }
    assert snapshot["session_count"] == 2
    assert snapshot["handles"]["pipeline"]["resident"] is False
    assert (detector_calls["n"], va_calls["n"], pipeline_calls["n"]) == (0, 0, 1)


def test_class_name_of_fallbacks() -> None:
    assert pred._class_name_of({0: "a"}, 0) == "a"
    assert pred._class_name_of({0: "a"}, 9) == "unknown"
    assert pred._class_name_of(["a", "b"], 1) == "b"
    assert pred._class_name_of(["a"], 5) == "unknown"
    assert pred._class_name_of(None, 0) == "unknown"


def test_provider_inspector_keeps_known_cuda_sibling_when_other_session_missing() -> (
    None
):
    pipeline = SimpleNamespace(
        detector=SimpleNamespace(
            _onnx_session=_FakeSession(
                ["CPUExecutionProvider", "CUDAExecutionProvider"]
            )
        ),
        va_classifier=SimpleNamespace(),
    )

    assert inspect_handle_providers("pipeline", pipeline) == [
        ["CPUExecutionProvider", "CUDAExecutionProvider"],
        [],
    ]
    assert inspect_handle_providers("unknown", pipeline) is None


@pytest.mark.asyncio
async def test_cancelled_predict_keeps_borrower_until_executor_really_finishes(
    fake_image,
) -> None:
    started = threading.Event()
    release = threading.Event()

    class _BlockingDetector(_FakeDetector):
        def __call__(self, img):
            started.set()
            assert release.wait(2)
            return super().__call__(img)

    predictor, pool, *_ = _make(det=_BlockingDetector())
    task = asyncio.create_task(predictor.predict_one("unused", "detector"))
    assert await asyncio.to_thread(started.wait, 1)

    task.cancel()
    await asyncio.sleep(0)
    assert (await pool.snapshot())["borrowers"] == 1

    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert (await pool.snapshot())["borrowers"] == 0
