"""/predict 请求 schema 校验测试. 不需要 ultralytics."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas import BatchPredictRequest, Context, PredictParams, Variants


def test_context_minimal_detection() -> None:
    ctx = Context(type="detection", variants=Variants(series="yolo11", size="s"))
    assert ctx.type == "detection"
    assert ctx.params.conf == 0.25
    assert ctx.params.iou == 0.70
    assert ctx.params.max_det == 300


def test_variants_rejects_unknown_series() -> None:
    with pytest.raises(ValidationError):
        Variants(series="yolov99", size="s")  # type: ignore[arg-type]


def test_variants_rejects_unknown_size() -> None:
    with pytest.raises(ValidationError):
        Variants(series="yolo11", size="z")  # type: ignore[arg-type]


def test_context_rejects_unknown_task() -> None:
    with pytest.raises(ValidationError):
        Context(  # type: ignore[arg-type]
            type="tracking",
            variants=Variants(series="yolo11", size="s"),
        )


def test_params_conf_out_of_range_rejected() -> None:
    with pytest.raises(ValidationError):
        PredictParams(conf=1.5)


def test_params_max_det_below_one_rejected() -> None:
    with pytest.raises(ValidationError):
        PredictParams(max_det=0)


def test_batch_predict_request_round_trip() -> None:
    req = BatchPredictRequest(
        tasks=[{"id": "t1", "file_path": "https://a/b.jpg"}],  # type: ignore[list-item]
        context=Context(
            type="segmentation",
            variants=Variants(series="yolo26", size="s"),
            params=PredictParams(conf=0.4, iou=0.5, max_det=100),
        ),
    )
    assert req.tasks[0].id == "t1"
    assert req.context.type == "segmentation"
    assert req.context.variants.series == "yolo26"
    assert req.context.params.conf == 0.4
