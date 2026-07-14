"""RapidOCR mapping, mutable-parameter isolation, and executor cancellation tests."""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import numpy as np
import pytest

import catalog
from engine_pool import EnginePool
from predictor import (
    RapidOCRPredictor,
    _align_orientations,
    _run_blocking_until_complete,
)


class _RecordingEngine:
    def __init__(self) -> None:
        self.mode = "e2e"
        self.updates: list[dict] = []
        self.started: threading.Event | None = None
        self.release: threading.Event | None = None
        self.active = 0
        self.max_active = 0
        self._counter_lock = threading.Lock()

    def update_params(self, **kwargs) -> None:
        self.updates.append(dict(kwargs))
        if kwargs["use_det"] and not kwargs["use_rec"]:
            self.mode = "det"
        elif not kwargs["use_det"] and kwargs["use_rec"]:
            self.mode = "rec"
        else:
            self.mode = "e2e"

    @staticmethod
    def load_img(_path: str) -> np.ndarray:
        return np.zeros((100, 200, 3), dtype=np.uint8)

    @staticmethod
    def preprocess_img(image: np.ndarray):
        return image, object()

    def run_ocr_steps(self, _image, _op):
        with self._counter_lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self.started is not None:
                self.started.set()
            if self.release is not None:
                assert self.release.wait(timeout=1.0)

            box = np.array(
                [[[0.0, 0.0], [200.0, 0.0], [200.0, 100.0], [0.0, 100.0]]]
            )
            if self.mode == "det":
                return (
                    SimpleNamespace(boxes=box),
                    SimpleNamespace(cls_res=None),
                    SimpleNamespace(txts=None),
                    [],
                )
            if self.mode == "rec":
                return (
                    SimpleNamespace(boxes=None),
                    SimpleNamespace(cls_res=[("180", 0.99)]),
                    SimpleNamespace(txts=["hello"]),
                    [],
                )
            return (
                SimpleNamespace(boxes=box),
                SimpleNamespace(cls_res=[("0", 0.99)]),
                SimpleNamespace(txts=["hello"]),
                [],
            )
        finally:
            with self._counter_lock:
                self.active -= 1

    def build_final_output(
        self,
        _ori,
        det_res,
        _cls_res,
        _rec_res,
        _crops,
        _op,
    ):
        if self.mode == "det":
            return SimpleNamespace(
                boxes=det_res.boxes,
                txts=None,
                scores=np.array([0.8]),
            )
        if self.mode == "rec":
            return SimpleNamespace(
                boxes=None,
                txts=["hello"],
                scores=[0.9],
            )
        return SimpleNamespace(
            boxes=det_res.boxes,
            txts=["hello"],
            scores=np.array([0.95]),
        )


def _resolved(model_id: str):
    return catalog.resolve(
        model_id,
        {"version": "v5", "size": "mobile", "lang": "universal"},
    )


def _predictor(engine: _RecordingEngine) -> tuple[RapidOCRPredictor, EnginePool]:
    pool = EnginePool(
        1,
        lambda _resolved: engine,
        lambda _engine: {
            "det": ["CPUExecutionProvider"],
            "cls": ["CPUExecutionProvider"],
            "rec": ["CPUExecutionProvider"],
        },
    )
    return RapidOCRPredictor(pool), pool


@pytest.mark.asyncio
async def test_det_rec_and_e2e_mapping_share_one_composite_engine() -> None:
    engine = _RecordingEngine()
    predictor, pool = _predictor(engine)

    det, det_hit, _, _ = await predictor.predict_one(
        catalog.DET_MODEL_ID,
        _resolved(catalog.DET_MODEL_ID),
        "image.png",
    )
    rec, rec_hit, _, _ = await predictor.predict_one(
        catalog.REC_MODEL_ID,
        _resolved(catalog.REC_MODEL_ID),
        "crop.png",
    )
    e2e, e2e_hit, _, _ = await predictor.predict_one(
        catalog.E2E_MODEL_ID,
        _resolved(catalog.E2E_MODEL_ID),
        "image.png",
    )

    assert det_hit is False
    assert rec_hit is True
    assert e2e_hit is True
    assert (await pool.snapshot())["current_size"] == 1
    assert det == [
        {
            "type": "polygonlabels",
            "value": {
                "points": [
                    [0.0, 0.0],
                    [100.0, 0.0],
                    [100.0, 100.0],
                    [0.0, 100.0],
                ],
                "polygonlabels": ["text"],
            },
            "score": 0.8,
        }
    ]
    assert rec[0]["value"]["points"] == [
        [0.0, 0.0],
        [100.0, 0.0],
        [100.0, 100.0],
        [0.0, 100.0],
    ]
    assert rec[0]["attributes"] == {
        "text": "hello",
        "language": "universal",
        "orientation": "180",
    }
    assert e2e[0]["attributes"] == {
        "text": "hello",
        "language": "universal",
        "orientation": "0",
    }


@pytest.mark.asyncio
async def test_missing_runtime_params_reset_all_mutable_thresholds_to_defaults() -> None:
    engine = _RecordingEngine()
    predictor, _pool = _predictor(engine)
    resolved = _resolved(catalog.E2E_MODEL_ID)

    await predictor.predict_one(
        catalog.E2E_MODEL_ID,
        resolved,
        "image.png",
        {"text_score": 0.1, "box_thresh": 0.2, "unclip_ratio": 2.5},
    )
    await predictor.predict_one(catalog.E2E_MODEL_ID, resolved, "image.png")

    assert engine.updates[0] == {
        "use_det": True,
        "use_cls": True,
        "use_rec": True,
        "text_score": 0.1,
        "box_thresh": 0.2,
        "unclip_ratio": 2.5,
    }
    assert engine.updates[1]["text_score"] == catalog.RUNTIME_PARAM_DEFAULTS[
        "text_score"
    ]
    assert engine.updates[1]["box_thresh"] == catalog.RUNTIME_PARAM_DEFAULTS[
        "box_thresh"
    ]
    assert engine.updates[1]["unclip_ratio"] == catalog.RUNTIME_PARAM_DEFAULTS[
        "unclip_ratio"
    ]


def test_orientation_alignment_skips_filtered_low_score_text() -> None:
    orientations = _align_orientations(
        SimpleNamespace(boxes=np.zeros((2, 4, 2))),
        SimpleNamespace(cls_res=[("0", 0.9), ("180", 0.8)]),
        SimpleNamespace(txts=["low", "keep"]),
        SimpleNamespace(txts=["keep"]),
    )

    assert orientations == ["180"]


@pytest.mark.asyncio
async def test_same_engine_predicts_are_serialized_while_waiters_count_as_borrowers() -> None:
    engine = _RecordingEngine()
    engine.started = threading.Event()
    engine.release = threading.Event()
    predictor, pool = _predictor(engine)
    resolved = _resolved(catalog.E2E_MODEL_ID)

    first = asyncio.create_task(
        predictor.predict_one(catalog.E2E_MODEL_ID, resolved, "one.png")
    )
    assert await asyncio.to_thread(engine.started.wait, 1.0)
    second = asyncio.create_task(
        predictor.predict_one(catalog.E2E_MODEL_ID, resolved, "two.png")
    )
    await asyncio.sleep(0.02)

    assert (await pool.snapshot())["borrowers"] == 2
    assert len(engine.updates) == 1
    engine.release.set()
    await asyncio.gather(first, second)
    assert engine.max_active == 1
    assert len(engine.updates) == 2


@pytest.mark.asyncio
async def test_cancelled_predict_keeps_borrower_until_executor_really_finishes() -> None:
    engine = _RecordingEngine()
    engine.started = threading.Event()
    engine.release = threading.Event()
    predictor, pool = _predictor(engine)

    predict = asyncio.create_task(
        predictor.predict_one(
            catalog.E2E_MODEL_ID,
            _resolved(catalog.E2E_MODEL_ID),
            "image.png",
        )
    )
    assert await asyncio.to_thread(engine.started.wait, 1.0)
    predict.cancel()
    await asyncio.sleep(0.02)

    assert not predict.done()
    assert (await pool.snapshot())["borrowers"] == 1
    engine.release.set()
    with pytest.raises(asyncio.CancelledError):
        await predict
    assert (await pool.snapshot())["borrowers"] == 0


@pytest.mark.asyncio
async def test_cancelled_inner_executor_future_does_not_spin_forever(
    monkeypatch,
) -> None:
    loop = asyncio.get_running_loop()
    inner = loop.create_future()
    inner.cancel()
    monkeypatch.setattr(loop, "run_in_executor", lambda *_args: inner)

    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(
            _run_blocking_until_complete(lambda: None),
            timeout=0.1,
        )
