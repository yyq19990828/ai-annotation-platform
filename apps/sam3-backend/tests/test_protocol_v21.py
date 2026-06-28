"""v0.14.15 protocol v2.1 model_variant contract tests."""

from __future__ import annotations

import sys
import types
import asyncio
from unittest.mock import MagicMock

import pytest


@pytest.fixture()
def main_module():
    fake_sam3_mod = types.ModuleType("sam3")
    fake_sam3_mod.build_sam3_image_model = MagicMock(return_value=MagicMock())
    sys.modules["sam3"] = fake_sam3_mod
    sys.modules.pop("main", None)
    import main as m  # noqa: PLC0415

    return m


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_normalize_predict_context_accepts_model_variants(main_module):
    ctx = main_module._normalize_predict_context(
        {"type": "text", "model_variants": {"model_variant": "sam3"}}
    )
    assert ctx["model_variants"] == {"model_variant": "sam3"}


def test_normalize_predict_context_accepts_legacy_model_variant_with_warning(
    main_module, caplog
):
    caplog.set_level("WARNING")
    ctx = main_module._normalize_predict_context({"type": "text", "model_variant": "sam3"})
    assert ctx["model_variants"] == {"model_variant": "sam3"}
    assert "context.model_variant -> context.model_variants" in caplog.text


def test_normalize_predict_context_invalid_model_variant_returns_standard_422(main_module):
    with pytest.raises(Exception) as exc:
        main_module._normalize_predict_context(
            {"type": "text", "model_variants": {"model_variant": "sam3.0"}}
        )
    err = exc.value
    assert err.status_code == 422
    assert err.detail == {
        "error_code": "variant_not_supported",
        "axis": "model_variant",
        "value": "sam3.0",
        "allowed": ["sam3"],
    }


def test_warmup_invalid_model_variant_returns_standard_422(main_module, monkeypatch):
    monkeypatch.setattr(main_module, "_predictor", MagicMock(device="cpu"))
    with pytest.raises(Exception) as exc:
        _run(main_module.warmup(main_module.WarmupRequest(variants={"model_variant": "sam3.0"})))
    err = exc.value
    assert err.status_code == 422
    assert err.detail["error_code"] == "variant_not_supported"
