"""v0.14.11 · gsam2 协议 v2 多模型目录测试.

验证 /setup 的 models[] 把 gsam2 的 4 条实际能力 (detection / segmentation /
tracker / interactive_seg) 各拆成独立 model 条目, 让平台「协议能力目录」按 task
正确归类。
"""

from __future__ import annotations

from main import setup


def test_setup_top_level_infra_is_pytorch():
    data = setup()
    assert data["infra"] == "pytorch"


def test_setup_exposes_four_models():
    data = setup()
    assert isinstance(data["models"], list)
    assert len(data["models"]) == 4


def test_setup_models_cover_protocol_tasks():
    data = setup()
    tasks = {m["task"] for m in data["models"]}
    assert tasks == {"detection", "segmentation", "interactive_seg", "tracker"}


def test_setup_each_model_carries_infra_pytorch():
    data = setup()
    for m in data["models"]:
        assert m["infra"] == "pytorch"
        assert m["model_family"] == "grounded-sam2"


def test_detection_model_text_to_bbox():
    data = setup()
    det = next(m for m in data["models"] if m["task"] == "detection")
    assert det["supported_prompts"] == ["text"]
    assert det["supported_geometric_outputs"] == ["bbox"]
    assert det["is_interactive"] is False


def test_segmentation_model_text_to_polygon():
    data = setup()
    seg = next(m for m in data["models"] if m["task"] == "segmentation")
    assert seg["supported_prompts"] == ["text"]
    assert seg["supported_geometric_outputs"] == ["polygon"]


def test_interactive_seg_model_point_box_to_polygon():
    data = setup()
    inter = next(m for m in data["models"] if m["task"] == "interactive_seg")
    assert set(inter["supported_prompts"]) == {"point", "bbox"}
    assert inter["supported_geometric_outputs"] == ["polygon"]
    assert inter["is_interactive"] is True


def test_tracker_model_sam2_video():
    data = setup()
    tracker = next(m for m in data["models"] if m["task"] == "tracker")
    assert tracker["supported_trackers"] == ["sam2_video"]
    assert tracker["supported_geometric_outputs"] == ["bbox"]


def test_top_level_back_compat_fields_unchanged():
    """顶层 supported_prompts / supported_trackers 保留, 供未升级平台合成隐式单 model."""
    data = setup()
    assert set(data["supported_prompts"]) == {"point", "bbox", "text"}
    assert data["supported_trackers"] == ["sam2_video"]
