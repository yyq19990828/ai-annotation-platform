"""共享 schema 单测."""

from __future__ import annotations

import pytest
from aap_protocol_v2 import (
    BatchPredictResponse,
    PredictionResult,
    TaskItem,
)


def test_task_item_minimal() -> None:
    item = TaskItem(id="t1", file_path="/tmp/a.jpg")
    assert item.id == "t1"
    assert item.file_path == "/tmp/a.jpg"


def test_task_item_int_id_accepted() -> None:
    item = TaskItem(id=42, file_path="x.jpg")
    assert item.id == 42


def test_prediction_result_defaults() -> None:
    r = PredictionResult()
    assert r.task is None
    assert r.result == []
    assert r.score is None


def test_batch_predict_response_round_trip() -> None:
    r = BatchPredictResponse(
        results=[
            PredictionResult(
                task="t1",
                result=[{"type": "rectanglelabels", "value": {"x": 10, "y": 10}}],
                score=0.9,
                model_version="yolo11s",
                inference_time_ms=42,
            )
        ]
    )
    dumped = r.model_dump()
    assert dumped["results"][0]["task"] == "t1"
    assert dumped["results"][0]["model_version"] == "yolo11s"
    assert dumped["results"][0]["inference_time_ms"] == 42


def test_batch_predict_response_empty() -> None:
    r = BatchPredictResponse(results=[])
    assert r.results == []


def test_task_item_missing_file_path_rejects() -> None:
    with pytest.raises(Exception):
        TaskItem(id="t1")  # type: ignore[call-arg]
