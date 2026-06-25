"""/setup 协议 v2 多模型目录结构测试.

不需要 ultralytics / GPU; 仅测 main.setup() 返回的 dict 形态符合
docs-site/dev/reference/ml-backend-protocol.md §4.1 规范.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_torch_and_ultralytics() -> None:
    """让 main 在无 GPU / 无 ultralytics 环境也可以 import."""
    sys.modules.setdefault("torch", MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False))))
    sys.modules.setdefault("ultralytics", MagicMock())


@pytest.fixture(scope="module")
def setup_dict() -> dict:
    import main  # noqa: PLC0415
    return main.setup()


def test_setup_protocol_version_v22(setup_dict: dict) -> None:
    assert setup_dict["protocol_version"] == "2.2"
    assert setup_dict["compat_protocol_versions"] == ["2.1", "2.0"]


def test_setup_models_are_atoms(setup_dict: dict) -> None:
    """v0.18.12 · YOLO 各 task model 均标 composition=atom。"""
    assert all(m["composition"] == "atom" for m in setup_dict["models"])


def test_setup_infra_pytorch(setup_dict: dict) -> None:
    assert setup_dict["infra"] == "pytorch"


def test_setup_supported_prompts_none_only(setup_dict: dict) -> None:
    """yolo 是纯批量, supported_prompts 只有 'none'."""
    assert setup_dict["supported_prompts"] == ["none"]


def test_setup_has_four_models(setup_dict: dict) -> None:
    models = setup_dict["models"]
    assert len(models) == 4
    ids = {m["id"] for m in models}
    assert ids == {"detect", "segment", "pose", "obb"}


def test_setup_models_declare_supported_inputs(setup_dict: dict) -> None:
    """v0.18.16 · 各 task 显式声明 supported_inputs (整图 + crop, 可作 crop-detect 下游)。"""
    for m in setup_dict["models"]:
        assert m["supported_inputs"] == ["full_image", "crop"]


def test_setup_models_carry_protocol_task(setup_dict: dict) -> None:
    tasks = {m["task"] for m in setup_dict["models"]}
    assert tasks == {"detection", "segmentation", "keypoint", "obb"}


def test_setup_models_all_family_yolo(setup_dict: dict) -> None:
    for m in setup_dict["models"]:
        assert m["model_family"] == "yolo"


def test_setup_models_all_infra_pytorch(setup_dict: dict) -> None:
    for m in setup_dict["models"]:
        assert m["infra"] == "pytorch"


def test_setup_detect_geometry_bbox(setup_dict: dict) -> None:
    detect = next(m for m in setup_dict["models"] if m["id"] == "detect")
    assert detect["supported_geometric_outputs"] == ["bbox"]


def test_setup_segment_geometry_polygon(setup_dict: dict) -> None:
    seg = next(m for m in setup_dict["models"] if m["id"] == "segment")
    assert seg["supported_geometric_outputs"] == ["polygon"]


def test_setup_pose_geometry_keypoint(setup_dict: dict) -> None:
    pose = next(m for m in setup_dict["models"] if m["id"] == "pose")
    assert pose["supported_geometric_outputs"] == ["keypoint"]


def test_setup_obb_geometry_rotated_bbox(setup_dict: dict) -> None:
    obb = next(m for m in setup_dict["models"] if m["id"] == "obb")
    assert obb["supported_geometric_outputs"] == ["rotated_bbox"]


def test_setup_each_model_has_two_axis_variants(setup_dict: dict) -> None:
    for m in setup_dict["models"]:
        axes = m["supported_variants"]
        keys = {axis["key"] for axis in axes}
        assert keys == {"series", "size"}


def test_setup_detect_series_includes_rtdetr(setup_dict: dict) -> None:
    detect = next(m for m in setup_dict["models"] if m["id"] == "detect")
    series_axis = next(a for a in detect["supported_variants"] if a["key"] == "series")
    series_values = {v["value"] for v in series_axis["variants"]}
    assert "rtdetr" in series_values
    assert "yolo26" in series_values


def test_setup_segment_excludes_rtdetr_v10_v12(setup_dict: dict) -> None:
    """seg 任务 series 严格按矩阵, 不应出现 rtdetr / v10 / v12."""
    seg = next(m for m in setup_dict["models"] if m["id"] == "segment")
    series_axis = next(a for a in seg["supported_variants"] if a["key"] == "series")
    series_values = {v["value"] for v in series_axis["variants"]}
    assert "rtdetr" not in series_values
    assert "yolov10" not in series_values
    assert "yolo12" not in series_values
    assert series_values == {"yolov8", "yolov9", "yolo11", "yolo26"}


def test_setup_pose_obb_only_v8_v11_v26(setup_dict: dict) -> None:
    for mid in ("pose", "obb"):
        m = next(x for x in setup_dict["models"] if x["id"] == mid)
        series_axis = next(a for a in m["supported_variants"] if a["key"] == "series")
        values = {v["value"] for v in series_axis["variants"]}
        assert values == {"yolov8", "yolo11", "yolo26"}


def test_setup_yolo11_recommended_in_each_model(setup_dict: dict) -> None:
    for m in setup_dict["models"]:
        series_axis = next(a for a in m["supported_variants"] if a["key"] == "series")
        recommended = [v for v in series_axis["variants"] if v.get("recommended")]
        # yolo11 在 4 个 model 中都有, 应被标推荐.
        assert any(v["value"] == "yolo11" and v.get("recommended") for v in series_axis["variants"]), \
            f"yolo11 should be recommended for model {m['id']}"


def test_setup_params_schema_keys(setup_dict: dict) -> None:
    for m in setup_dict["models"]:
        props = m["params"]["properties"]
        assert "conf" in props
        assert "iou" in props
        assert "max_det" in props


def test_setup_params_schema_platform_roles(setup_dict: dict) -> None:
    props = setup_dict["params"]["properties"]
    assert props["conf"]["x-platform-role"] == "confidence"
    assert props["iou"]["x-platform-role"] == "iou"
    assert props["max_det"]["x-platform-role"] == "maxDet"


def test_setup_top_level_geometric_outputs_union(setup_dict: dict) -> None:
    geoms = set(setup_dict["supported_geometric_outputs"])
    assert geoms == {"bbox", "polygon", "keypoint", "rotated_bbox"}


def test_setup_top_level_is_interactive_false(setup_dict: dict) -> None:
    assert setup_dict["is_interactive"] is False


def test_setup_variant_combinations_present(setup_dict: dict) -> None:
    """v0.14.12 · 每个 model 必须暴露 variant_combinations (yolo 的多轴非真笛卡尔积)."""
    for m in setup_dict["models"]:
        assert "variant_combinations" in m, m["id"]
        combos = m["variant_combinations"]
        assert isinstance(combos, list) and len(combos) > 0
        for combo in combos:
            assert isinstance(combo, list) and len(combo) == 2  # [series, size]


def test_setup_detect_variant_combinations_count(setup_dict: dict) -> None:
    """detection 矩阵: v8/11/12/26 各 5 + v9 5 + v10 6 + rtdetr 2 = 33."""
    detect = next(m for m in setup_dict["models"] if m["id"] == "detect")
    assert len(detect["variant_combinations"]) == 33


def test_setup_segment_variant_combinations_count(setup_dict: dict) -> None:
    """segmentation: v8 5 + v9 2 + v11 5 + v26 5 = 17."""
    seg = next(m for m in setup_dict["models"] if m["id"] == "segment")
    assert len(seg["variant_combinations"]) == 17


def test_setup_pose_variant_combinations_count(setup_dict: dict) -> None:
    """keypoint: v8/11/26 各 5 = 15."""
    pose = next(m for m in setup_dict["models"] if m["id"] == "pose")
    assert len(pose["variant_combinations"]) == 15


def test_setup_obb_variant_combinations_count(setup_dict: dict) -> None:
    """obb: v8/11/26 各 5 = 15."""
    obb = next(m for m in setup_dict["models"] if m["id"] == "obb")
    assert len(obb["variant_combinations"]) == 15


def test_setup_variant_combinations_all_legal(setup_dict: dict) -> None:
    """每个 combo 必须在 MODEL_MATRIX 中确实存在 (避免序列化错位)."""
    import main as m  # noqa: PLC0415
    for entry in setup_dict["models"]:
        task = entry["task"]
        for series, size in entry["variant_combinations"]:
            assert size in m.MODEL_MATRIX[task][series], (task, series, size)


def test_setup_each_model_has_default_variants(setup_dict: dict) -> None:
    """v0.14.13 · 每个 model 必须暴露 default_variants (供前端 VariantSelector 取初值)."""
    for entry in setup_dict["models"]:
        dv = entry.get("default_variants")
        assert isinstance(dv, dict) and dv, f"{entry['id']} missing default_variants"
        assert set(dv.keys()) == {"series", "size"}


def test_setup_default_variants_legal(setup_dict: dict) -> None:
    """default_variants 必须是该 task 下的合法 (series, size) 组合."""
    import main as m  # noqa: PLC0415
    for entry in setup_dict["models"]:
        task = entry["task"]
        dv = entry["default_variants"]
        assert dv["size"] in m.MODEL_MATRIX[task][dv["series"]], (task, dv)


def test_setup_default_variants_prefer_yolo11_s(setup_dict: dict) -> None:
    """yolo11/s 4 task 全覆盖, 推荐组合应被选中."""
    for entry in setup_dict["models"]:
        assert entry["default_variants"] == {"series": "yolo11", "size": "s"}, entry["id"]


# ---------- v0.14.14: warmup_endpoint 声明 ----------


def test_setup_warmup_endpoint_true(setup_dict: dict) -> None:
    """v0.14.14 协议 §4.4 · 顶层 warmup_endpoint 必须为 True (yolo 支持 /warmup)."""
    assert setup_dict["warmup_endpoint"] is True
