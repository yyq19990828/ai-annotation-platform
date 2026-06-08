"""v0.14.11 · SAM 3 协议 v2 多模型目录测试.

验证 /setup 的 models[] 把 SAM 3 的 3 条能力 (detection / segmentation /
interactive_seg, 全部走 PCS 路径) 各拆成独立 model 条目。
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module")
def setup_fn():
    """干净加载 main.py 的 setup, mock 掉 sam3 / torch GPU 依赖。"""
    fake_sam3_mod = types.ModuleType("sam3")
    fake_sam3_mod.build_sam3_image_model = MagicMock(return_value=MagicMock())
    sys.modules.setdefault("sam3", fake_sam3_mod)
    sys.modules.pop("main", None)
    import main as m  # noqa: PLC0415

    return m.setup


def test_setup_top_level_infra_is_pytorch(setup_fn):
    data = setup_fn()
    assert data["infra"] == "pytorch"


def test_setup_protocol_version_v21(setup_fn):
    data = setup_fn()
    assert data["protocol_version"] == "2.1"
    assert data["compat_protocol_versions"] == ["2.0"]


def test_setup_exposes_three_models(setup_fn):
    data = setup_fn()
    assert isinstance(data["models"], list)
    assert len(data["models"]) == 3


def test_setup_models_cover_protocol_tasks(setup_fn):
    data = setup_fn()
    tasks = {m["task"] for m in data["models"]}
    assert tasks == {"detection", "segmentation", "interactive_seg"}


def test_setup_each_model_carries_infra_pytorch(setup_fn):
    data = setup_fn()
    for m in data["models"]:
        assert m["infra"] == "pytorch"
        assert m["model_family"] == "sam3"


def test_detection_model_text_to_bbox(setup_fn):
    data = setup_fn()
    det = next(m for m in data["models"] if m["task"] == "detection")
    assert det["supported_prompts"] == ["text"]
    assert det["supported_geometric_outputs"] == ["bbox"]
    assert det["is_interactive"] is False


def test_segmentation_model_text_to_polygon(setup_fn):
    data = setup_fn()
    seg = next(m for m in data["models"] if m["task"] == "segmentation")
    assert seg["supported_prompts"] == ["text"]
    assert seg["supported_geometric_outputs"] == ["polygon"]


def test_interactive_seg_model_exemplar(setup_fn):
    """SAM 3 的交互分割走 exemplar 路径 (示例框 PCS), 不暴露 point/bbox 单物体语义."""
    data = setup_fn()
    inter = next(m for m in data["models"] if m["task"] == "interactive_seg")
    assert inter["supported_prompts"] == ["exemplar"]
    assert inter["supported_geometric_outputs"] == ["polygon"]
    assert inter["is_interactive"] is True


def test_top_level_back_compat_fields_unchanged(setup_fn):
    """顶层 supported_prompts 保留 (text + exemplar), 供未升级平台合成隐式单 model."""
    data = setup_fn()
    assert set(data["supported_prompts"]) == {"text", "exemplar"}


def test_setup_params_schema_platform_roles(setup_fn):
    props = setup_fn()["params"]["properties"]
    assert props["score_threshold"]["x-platform-role"] == "confidence"
    assert props["simplify_tolerance"]["x-platform-role"] == "simplifyTolerance"
    assert props["model_variant"]["x-platform-role"] == "modelVariant"
