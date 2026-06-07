"""v0.14.9 · 能力声明协议 v2 — extract_capabilities / derive_modalities 派生单测.

纯函数测试 (无 DB): 覆盖多模型目录解析、infra 继承/覆盖、向后兼容合成隐式单 model、
扁平并集、模态派生。
"""

from app.services.ml_capabilities import derive_modalities, extract_capabilities


def test_extract_none_returns_none():
    assert extract_capabilities(None) is None
    assert extract_capabilities({}) is None


# ── 多模型 backend (YOLO 官仓: 按任务分条目) ──


def _yolo_setup() -> dict:
    return {
        "name": "yolo-ultralytics-backend",
        "version": "0.1.0",
        "model_version": "ultralytics-8.3.x",
        "infra": "pytorch",
        "is_interactive": False,
        "models": [
            {
                "id": "detect",
                "display_name": "YOLO 目标检测",
                "task": "detection",
                "model_family": "yolo",
                "supported_prompts": ["none"],
                "supported_geometric_outputs": ["bbox"],
                "supported_variants": [
                    {"key": "series", "variants": [{"value": "yolo11"}]},
                    {"key": "size", "variants": [{"value": "n"}, {"value": "s"}]},
                ],
                "default_thresholds": {"conf": 0.25, "iou": 0.7},
            },
            {
                "id": "segment",
                "task": "segmentation",
                "model_family": "yolo",
                "supported_geometric_outputs": ["polygon"],
            },
            {
                "id": "pose",
                "task": "keypoint",
                "model_family": "yolo",
                # 不声明几何 → 按 task 默认补全 keypoint
            },
            {
                "id": "obb",
                "task": "obb",
                "model_family": "yolo",
                "supported_geometric_outputs": ["rotated_bbox"],
            },
            {
                "id": "classify",
                "task": "classification",
                "model_family": "yolo",
                "supported_geometric_outputs": ["none"],
                "output_attribute_types": ["class"],
            },
        ],
    }


def test_multi_model_parses_each_entry():
    caps = extract_capabilities(_yolo_setup())
    assert caps is not None
    assert caps["infra"] == "pytorch"
    models = {m["id"]: m for m in caps["models"]}
    assert set(models) == {"detect", "segment", "pose", "obb", "classify"}
    assert models["detect"]["task"] == "detection"
    assert models["detect"]["model_family"] == "yolo"
    # infra 缺省继承 backend
    assert models["detect"]["infra"] == "pytorch"
    # 几何未声明按 task 默认补全
    assert models["pose"]["supported_geometric_outputs"] == ["keypoint"]
    # OCR/cls 属性输出
    assert models["classify"]["output_attribute_types"] == ["class"]


def test_multi_model_flat_union():
    caps = extract_capabilities(_yolo_setup())
    assert caps is not None
    # 扁平并集 (向后兼容消费方): 几何去重合并
    geo = caps["supported_geometric_outputs"]
    assert set(geo) == {"bbox", "polygon", "keypoint", "rotated_bbox", "none"}
    # 纯批量 YOLO → image 模态
    assert caps["modalities"] == ["image"]


def test_model_infra_override():
    setup = {
        "name": "onnx-zoo",
        "infra": "onnx",
        "models": [
            {
                "id": "yolo",
                "task": "detection",
                "supported_geometric_outputs": ["bbox"],
            },
            {
                "id": "ppocr",
                "task": "ocr",
                "infra": "paddle",  # 覆盖 backend 默认
                "supported_geometric_outputs": ["polygon"],
                "output_attribute_types": ["text", "language"],
            },
        ],
    }
    caps = extract_capabilities(setup)
    assert caps is not None
    models = {m["id"]: m for m in caps["models"]}
    assert models["yolo"]["infra"] == "onnx"  # 继承
    assert models["ppocr"]["infra"] == "paddle"  # 覆盖
    assert "text" in models["ppocr"]["output_attribute_types"]


# ── 向后兼容: 老 backend 无 models[] → 合成隐式单 model ──


def test_legacy_grounded_sam2_synthesizes_single_model():
    # grounded-sam2: 有 prompts + trackers, 无 models[] / infra
    setup = {
        "name": "grounded-sam2",
        "version": "0.10.1",
        "model_version": "grounded-sam2-dinoT-sam2.1tiny",
        "is_interactive": True,
        "supported_prompts": ["point", "bbox", "text"],
        "supported_text_outputs": ["box", "mask", "both"],
        "supported_trackers": ["sam2_video"],
        "supported_variants": [{"key": "sam_variant", "variants": [{"value": "tiny"}]}],
        "params": {"type": "object", "properties": {}},
    }
    caps = extract_capabilities(setup)
    assert caps is not None
    # 合成单 model
    assert len(caps["models"]) == 1
    m = caps["models"][0]
    assert m["id"] == "grounded-sam2"
    assert m["task"] == "tracker"  # 有 trackers 优先判 tracker
    assert m["infra"] == "unknown"  # 老 backend 不报 infra
    # 扁平字段与升级前完全一致 (向后兼容)
    assert caps["is_interactive"] is True
    assert caps["supported_prompts"] == ["point", "bbox", "text"]
    assert caps["supported_trackers"] == ["sam2_video"]
    assert caps["supported_text_outputs"] == ["box", "mask", "both"]
    # image (prompts 非空) + video (trackers 非空) 双修保留
    assert caps["modalities"] == ["image", "video"]


def test_legacy_detection_only_backend():
    # echo backend: 无 prompts/trackers/models → detection 单 model, 仅展示
    setup = {"name": "echo-backend", "labels": ["demo"], "is_interactive": False}
    caps = extract_capabilities(setup)
    assert caps is not None
    assert len(caps["models"]) == 1
    assert caps["models"][0]["task"] == "detection"
    assert caps["infra"] == "unknown"
    # 无 prompts/trackers → 扁平为空; per-model 补 image
    assert caps["modalities"] == ["image"]


# ── 模态派生 ──


def test_modality_video_from_tracker_task():
    setup = {
        "name": "tracker-only",
        "infra": "onnx",
        "models": [
            {"id": "t", "task": "tracker", "supported_trackers": ["sam2_video"]}
        ],
    }
    caps = extract_capabilities(setup)
    assert caps is not None
    assert caps["modalities"] == ["video"]


def test_modality_lidar_from_geometry():
    setup = {
        "name": "pc",
        "models": [
            {
                "id": "box3d",
                "task": "detection",
                "supported_geometric_outputs": ["lidar_box_3d"],
            }
        ],
    }
    caps = extract_capabilities(setup)
    assert caps is not None
    assert caps["modalities"] == ["lidar"]


def test_derive_modalities_empty_caps():
    assert derive_modalities(None) == []
    assert derive_modalities({}) == []
