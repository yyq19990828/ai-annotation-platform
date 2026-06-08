"""v0.14.17 · _build_predict_context 纯函数单测.

两条互斥路径:
- 协议 v2 结构化 (model_variants 非空, YOLO): model_variants dict + nested params + type=几何 task。
  修通 YOLO 批量预标 (此前 worker 发扁平 series/size + type="text" 被 YOLO 422)。
- 既有扁平路径 (gsam2 文本 / OCR / doc_layout): 与 v0.14.9 行为逐字等价, 防回归。
"""

from __future__ import annotations

from app.workers.tasks import _build_predict_context


def _ctx(**kw):
    base = dict(
        prompt=None,
        output_mode="mask",
        params=None,
        model_id=None,
        task_type=None,
        model_variants=None,
    )
    base.update(kw)
    return _build_predict_context(**base)


# ── 协议 v2 结构化路径 (YOLO) ──────────────────────────────────────────────


def test_v2_structured_context_for_yolo():
    ctx = _ctx(
        task_type="detection",
        model_id="detect",
        model_variants={"series": "yolo11", "size": "s"},
        params={"conf": 0.4, "iou": 0.6, "max_det": 100},
    )
    assert ctx == {
        "type": "detection",
        "model_variants": {"series": "yolo11", "size": "s"},
        "params": {"conf": 0.4, "iou": 0.6, "max_det": 100},
        "model_id": "detect",
    }


def test_v2_defaults_type_when_task_type_missing():
    ctx = _ctx(model_variants={"series": "yolo11", "size": "s"})
    assert ctx["type"] == "detection"
    assert ctx["model_variants"] == {"series": "yolo11", "size": "s"}
    assert ctx["params"] == {}


def test_v2_carries_prompt_as_text_for_future_whitelist():
    ctx = _ctx(
        task_type="segmentation",
        model_variants={"series": "yolo11", "size": "s"},
        prompt="car, person",
    )
    # YOLO 当前忽略 text, 但通道保留给 v0.14.17 后续类别白名单过滤.
    assert ctx["text"] == "car, person"
    assert ctx["type"] == "segmentation"


def test_v2_class_filter_passthrough():
    ctx = _ctx(
        task_type="detection",
        model_variants={"series": "yolo11", "size": "s"},
        class_filter=[0, 2],
    )
    assert ctx["classes"] == [0, 2]


def test_v2_no_class_filter_omits_classes_key():
    ctx = _ctx(
        task_type="detection",
        model_variants={"series": "yolo11", "size": "s"},
    )
    assert "classes" not in ctx


def test_v2_takes_precedence_over_flat_path():
    """model_variants 非空 → 走 v2, 不退回扁平 text 路径 (即便 prompt 存在)."""
    ctx = _ctx(
        task_type="obb",
        model_variants={"series": "yolo11", "size": "s"},
        prompt="ship",
        box_threshold=0.3,
        text_threshold=0.25,
    )
    assert "model_variants" in ctx
    assert "box_threshold" not in ctx  # 扁平阈值不掺进 v2 context


# ── 既有扁平路径 (gsam2 文本 / OCR), 防回归 ─────────────────────────────────


def test_flat_text_path_unchanged():
    ctx = _ctx(
        prompt="car",
        output_mode="box",
        params={"box_threshold": 0.3, "text_threshold": 0.25},
        box_threshold=0.35,
        text_threshold=0.28,
    )
    assert ctx["type"] == "text"
    assert ctx["text"] == "car"
    assert ctx["output"] == "box"
    # 项目级阈值先写, 再被 params 覆盖 (与 v0.14.9 行为一致).
    assert ctx["box_threshold"] == 0.3
    assert ctx["text_threshold"] == 0.25


def test_flat_task_type_override_for_ocr():
    """OCR / doc_layout: 无 model_variants, task_type 覆盖 type, model_id 透传."""
    ctx = _ctx(prompt="", task_type="ocr", model_id="ocr-model")
    assert ctx["type"] == "ocr"
    assert ctx["model_id"] == "ocr-model"


def test_no_prompt_no_task_returns_none():
    assert _ctx() is None
