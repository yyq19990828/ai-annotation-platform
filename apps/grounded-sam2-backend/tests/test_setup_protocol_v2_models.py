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


def test_setup_protocol_version_v22():
    data = setup()
    assert data["protocol_version"] == "2.2"
    assert data["compat_protocol_versions"] == ["2.1", "2.0"]


def test_setup_exposes_five_models():
    """v0.18.12 起新增 box-seg 原子, 共 5 个 model。"""
    data = setup()
    assert isinstance(data["models"], list)
    assert len(data["models"]) == 5


def test_box_seg_model_is_public_non_interactive_atom():
    """v0.18.12 · 框→mask 批量分割原子: public(无 visibility)、非交互、composition=atom、bbox→polygon。"""
    data = setup()
    box_seg = next(m for m in data["models"] if m["id"] == "grounded-sam2-box-seg")
    assert box_seg["task"] == "segmentation"
    assert box_seg["is_interactive"] is False
    assert box_seg["supported_prompts"] == ["bbox"]
    assert box_seg["supported_geometric_outputs"] == ["polygon"]
    assert box_seg["composition"] == "atom"
    # public: 不声明 visibility(平台缺省 public), 与 internal 区分。
    assert box_seg.get("visibility") in (None, "public")


def test_composition_annotations():
    """v0.18.12 · 各 model 显式标 composition(原子 vs 内部编排)。"""
    by_id = {m["id"]: m for m in setup()["models"]}
    assert by_id["grounded-sam2-detection"]["composition"] == "atom"
    assert by_id["grounded-sam2-segmentation"]["composition"] == "composite"
    assert by_id["grounded-sam2-interactive-seg"]["composition"] == "atom"
    assert by_id["grounded-sam2-tracker"]["composition"] == "composite"
    assert by_id["grounded-sam2-box-seg"]["composition"] == "atom"


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


def test_setup_params_schema_platform_roles():
    props = setup()["params"]["properties"]
    assert props["box_threshold"]["x-platform-role"] == "confidence"
    assert props["text_threshold"]["x-platform-role"] == "textThreshold"
    assert props["simplify_tolerance"]["x-platform-role"] == "simplifyTolerance"
