"""v0.14.15 protocol v2.1 variant normalization and error contract tests."""

from __future__ import annotations

import asyncio
import sys
from types import ModuleType
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_modules() -> None:
    sys.modules.setdefault(
        "torch", MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False)))
    )
    sys.modules.setdefault("cv2", MagicMock())
    mask_utils = ModuleType("mask_utils")
    mask_utils.MultiPolygonRing = dict
    mask_utils.mask_to_multi_polygon = MagicMock(return_value=[])
    polygon = ModuleType("mask_utils.polygon")
    polygon.mask_to_polygon = MagicMock(return_value=[])
    rle = ModuleType("mask_utils.rle")
    rle.encode_coco_rle = MagicMock(return_value={})
    sys.modules.setdefault("mask_utils", mask_utils)
    sys.modules.setdefault("mask_utils.polygon", polygon)
    sys.modules.setdefault("mask_utils.rle", rle)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_resolve_variant_accepts_model_variants() -> None:
    from main import _resolve_variant

    assert _resolve_variant(
        {"type": "text", "model_variants": {"sam_variant": "small", "dino_variant": "B"}}
    ) == ("small", "B")


def test_resolve_variant_accepts_legacy_fields_with_warning(caplog) -> None:
    from main import _resolve_variant

    caplog.set_level("WARNING")
    assert _resolve_variant({"type": "text", "sam_variant": "tiny", "dino_variant": "T"}) == (
        "tiny",
        "T",
    )
    assert "context.dino_variant, context.sam_variant -> context.model_variants" in caplog.text


def test_resolve_variant_invalid_value_returns_standard_422() -> None:
    from main import _resolve_variant

    with pytest.raises(Exception) as exc:
        _resolve_variant({"type": "text", "model_variants": {"sam_variant": "nope"}})
    err = exc.value
    assert err.status_code == 422
    assert err.detail["error_code"] == "variant_not_supported"
    assert err.detail["axis"] == "sam_variant"


class _PoolMissingWeight:
    def borrow(self, sam_variant, dino_variant):
        class _MissingLease:
            async def __aenter__(self):
                raise FileNotFoundError("missing checkpoint")

            async def __aexit__(self, *_args):
                return False

        return _MissingLease()

    def builder_for_now(self, sam_variant, dino_variant):
        return None


def test_borrow_predictor_missing_weight_returns_503_retry_after(monkeypatch) -> None:
    import main

    monkeypatch.setattr(main, "_pool", _PoolMissingWeight())
    with pytest.raises(Exception) as exc:
        _run(
            main._run_prompt(
                "missing.jpg",
                {"type": "point", "points": [[0.5, 0.5]]},
            )
        )
    err = exc.value
    assert err.status_code == 503
    assert err.headers == {"Retry-After": "30"}
    assert err.detail["error_code"] == "model_unavailable"
