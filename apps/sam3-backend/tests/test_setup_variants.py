"""Tests for /setup variant metadata on the single-variant SAM 3 backend."""

from __future__ import annotations

import sys
import types

if "torch" not in sys.modules:
    torch_stub = types.ModuleType("torch")
    torch_stub.cuda = types.SimpleNamespace(
        is_available=lambda: False,
        empty_cache=lambda: None,
        ipc_collect=lambda: None,
        mem_get_info=lambda: (0, 0),
        get_device_name=lambda _index: "stub",
    )
    sys.modules["torch"] = torch_stub

from main import setup


def test_setup_supported_variants_declare_single_axis():
    """v0.14.12 · 单档 backend 也要显式声明 variant 轴 (供模型市场显示具体权重).

    SAM 3 仅一档官方权重 (sam3.1), supported_variants 一轴一值; sam_variant /
    dino_variant 不应混进 params (与 gsam2 严格分离).
    """
    data = setup()

    axes = data["supported_variants"]
    assert len(axes) == 1
    assert axes[0]["key"] == "model_variant"
    assert len(axes[0]["variants"]) == 1
    assert axes[0]["variants"][0]["value"] == "sam3.1"

    assert "sam_variant" not in data["params"]["properties"]
    assert "dino_variant" not in data["params"]["properties"]


def test_setup_default_variants_present_on_each_model():
    """v0.14.13 · 即便单档 sam3, default_variants 仍要写, 让前端按统一规则消费."""
    data = setup()
    assert len(data["models"]) == 3
    for model in data["models"]:
        dv = model.get("default_variants")
        assert isinstance(dv, dict) and dv, f"{model['id']} missing default_variants"
        assert dv == {"model_variant": "sam3.1"}


def test_setup_default_variants_match_env_model_variant():
    """default_variants 的值应与 backend 加载的 MODEL_VARIANT 对齐."""
    from main import MODEL_VARIANT

    data = setup()
    for model in data["models"]:
        assert model["default_variants"]["model_variant"] == MODEL_VARIANT
