"""Tests for /setup rich variant metadata."""

from __future__ import annotations

from main import setup
from predictor import DINO_CONFIGS, SAM2_CONFIGS


def test_setup_supported_variants_match_runtime_variant_keys():
    data = setup()
    groups = {group["key"]: group for group in data["supported_variants"]}

    sam_values = [item["value"] for item in groups["sam_variant"]["variants"]]
    dino_values = [item["value"] for item in groups["dino_variant"]["variants"]]

    assert sam_values == list(SAM2_CONFIGS)
    assert dino_values == list(DINO_CONFIGS)
    assert sam_values == data["params"]["properties"]["sam_variant"]["enum"]
    assert dino_values == data["params"]["properties"]["dino_variant"]["enum"]


def test_setup_supported_variants_include_display_metadata():
    data = setup()
    groups = {group["key"]: group for group in data["supported_variants"]}

    sam_small = next(
        item for item in groups["sam_variant"]["variants"] if item["value"] == "small"
    )
    dino_t = next(item for item in groups["dino_variant"]["variants"] if item["value"] == "T")

    assert sam_small["label"] == "SAM 2.1 Small"
    assert sam_small["tier"] == "balanced"
    assert sam_small["recommended"] is True
    assert isinstance(sam_small["vram_gb"], float)
    assert dino_t["recommended"] is True
