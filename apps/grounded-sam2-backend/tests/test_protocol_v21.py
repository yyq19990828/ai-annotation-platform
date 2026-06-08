"""v0.14.15 protocol v2.1 variant normalization and error contract tests."""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_modules() -> None:
    sys.modules.setdefault(
        "torch", MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False)))
    )


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
    async def get(self, sam_variant, dino_variant):
        raise FileNotFoundError("missing checkpoint")


def test_get_predictor_missing_weight_returns_503_retry_after(monkeypatch) -> None:
    import main

    monkeypatch.setattr(main, "_pool", _PoolMissingWeight())
    with pytest.raises(Exception) as exc:
        _run(main._get_predictor("tiny", "T"))
    err = exc.value
    assert err.status_code == 503
    assert err.headers == {"Retry-After": "30"}
    assert err.detail["error_code"] == "model_unavailable"
