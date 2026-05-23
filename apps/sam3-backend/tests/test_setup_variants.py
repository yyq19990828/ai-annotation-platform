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


def test_setup_supported_variants_empty_for_single_variant_backend():
    data = setup()

    assert data["supported_variants"] == []
    assert "sam_variant" not in data["params"]["properties"]
    assert "dino_variant" not in data["params"]["properties"]
