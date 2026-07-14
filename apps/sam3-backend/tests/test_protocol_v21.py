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
    request = types.SimpleNamespace(
        state=types.SimpleNamespace(gpu_workload=MagicMock())
    )
    monkeypatch.setattr(main_module, "_image_pool", object())
    monkeypatch.setattr(main_module, "_multiplex_pool", object())
    monkeypatch.setattr(main_module, "_pvs_pool", object())
    with pytest.raises(Exception) as exc:
        _run(
            main_module.warmup(
                request,
                main_module.WarmupRequest(
                    variants={"model_variant": "sam3.0"}
                ),
            )
        )
    err = exc.value
    assert err.status_code == 422
    assert err.detail["error_code"] == "variant_not_supported"


def test_multiplex_collects_all_continuation_seed_bboxes(main_module):
    ctx = {
        "seeds": [
            {"obj_id": 1, "geometry": {"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}},
            {
                "obj_id": 2,
                "geometry": {
                    "type": "mask",
                    "bbox": {"x": 0.5, "y": 0.4, "w": 0.2, "h": 0.1},
                },
            },
        ],
        "source_geometry": {"type": "bbox", "x": 0, "y": 0, "w": 1, "h": 1},
    }

    assert main_module._seed_bboxes_from_video_ctx(ctx) == [
        {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        {"x": 0.5, "y": 0.4, "w": 0.2, "h": 0.1},
    ]


def test_multiplex_seed_bboxes_fall_back_to_source_geometry(main_module):
    ctx = {
        "source_geometry": {
            "type": "polygon",
            "points": [[0.2, 0.1], [0.8, 0.3], [0.4, 0.9]],
        }
    }

    assert main_module._seed_bboxes_from_video_ctx(ctx) == [
        {"x": 0.2, "y": 0.1, "w": pytest.approx(0.6), "h": 0.8}
    ]
