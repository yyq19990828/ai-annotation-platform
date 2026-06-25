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


# ── v0.18.21 · 开集文本路径 (平台扁平 wire: type=text + model_variants + 顶层 conf) ──


def test_context_text_path_flat_wire() -> None:
    """平台文本路径: type=text, model_variants→variants, 顶层 conf/iou/max_det 收拢成 params."""
    ctx = Context.model_validate({
        "type": "text",
        "text": "person, bus",
        "output": "box",
        "model_id": "detect-world",
        "model_variants": {"series": "yolo-worldv2", "size": "s"},
        "conf": 0.1,
        "iou": 0.5,
        "max_det": 100,
    })
    assert ctx.type == "text"
    assert ctx.text == "person, bus"
    assert ctx.output == "box"
    assert ctx.model_id == "detect-world"
    assert ctx.variants.series == "yolo-worldv2"
    assert ctx.variants.size == "s"
    # 顶层扁平参数被收拢.
    assert ctx.params.conf == 0.1
    assert ctx.params.iou == 0.5
    assert ctx.params.max_det == 100


def test_context_text_accepts_yoloe_series() -> None:
    ctx = Context.model_validate({
        "type": "text",
        "text": "cat",
        "model_variants": {"series": "yoloe-11", "size": "s"},
    })
    assert ctx.variants.series == "yoloe-11"
    # 无顶层 conf → 走默认.
    assert ctx.params.conf == 0.25
    # output 缺省 → box (v0.18.21 检测态默认).
    assert ctx.output == "box"


def test_context_text_segment_output_mask() -> None:
    """v0.18.22 · segment-yoloe 文本分割: output=mask 透传 (后端据此取 polygon)."""
    ctx = Context.model_validate({
        "type": "text",
        "text": "cat, dog",
        "output": "mask",
        "model_id": "segment-yoloe",
        "model_variants": {"series": "yoloe-11", "size": "s"},
    })
    assert ctx.output == "mask"
    assert ctx.model_id == "segment-yoloe"
    assert ctx.variants.series == "yoloe-11"


def test_context_text_output_rejects_unknown() -> None:
    with pytest.raises(ValidationError):
        Context.model_validate({
            "type": "text",
            "text": "cat",
            "output": "polygon",  # 仅 box/mask/both 合法.
            "model_variants": {"series": "yoloe-11", "size": "s"},
        })


def test_context_closed_set_nested_params_unaffected() -> None:
    """闭集嵌套 params 路径不被文本路径的扁平收拢影响."""
    ctx = Context.model_validate({
        "type": "detection",
        "model_variants": {"series": "yolo11", "size": "s"},
        "params": {"conf": 0.4},
    })
    assert ctx.type == "detection"
    assert ctx.params.conf == 0.4
