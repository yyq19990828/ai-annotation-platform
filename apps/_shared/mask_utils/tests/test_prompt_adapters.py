from __future__ import annotations

import hashlib
import json

import numpy as np
import pytest

from mask_utils import (
    PromptAdapterError,
    encode_coco_rle,
    mask_prompt_to_low_res_logits,
    scribbles_to_point_prompts,
)


def test_mask_prompt_becomes_bounded_low_res_logits() -> None:
    rle = encode_coco_rle([0, 1, 0, 1, 1, 0], 3, 2)
    digest = hashlib.sha256(json.dumps(rle, separators=(",", ":")).encode()).hexdigest()
    prompt = {"rle": rle, "source_digest": digest}
    logits = mask_prompt_to_low_res_logits(prompt, expected_size=(3, 2))
    assert logits.shape == (1, 256, 256)
    assert logits.dtype == np.float32
    assert set(np.unique(logits)) == {-16.0, 16.0}


def test_mask_prompt_rejects_media_size_mismatch() -> None:
    rle = encode_coco_rle([0, 1, 0, 1], 2, 2)
    digest = hashlib.sha256(json.dumps(rle, separators=(",", ":")).encode()).hexdigest()
    prompt = {"rle": rle, "source_digest": digest}
    with pytest.raises(ValueError, match="must match image"):
        mask_prompt_to_low_res_logits(prompt, expected_size=(3, 2))


def test_mask_prompt_rejects_digest_mismatch() -> None:
    prompt = {
        "rle": encode_coco_rle([0, 1, 0, 1], 2, 2),
        "source_digest": "0" * 64,
    }
    with pytest.raises(ValueError, match="source_digest"):
        mask_prompt_to_low_res_logits(prompt)


def test_scribble_adapter_preserves_both_polarities_and_budget() -> None:
    points, labels = scribbles_to_point_prompts(
        [
            {"polarity": 1, "points": [[0.1, 0.1], [0.9, 0.1]], "width": 0.02},
            {"polarity": 0, "points": [[0.2, 0.8], [0.8, 0.2]], "width": 0.01},
        ],
        image_size=(100, 80),
        max_rasterized_pixels=2_000_000,
        max_points=20,
    )
    assert len(points) == len(labels) <= 20
    assert 1 in labels
    assert 0 in labels
    assert all(0.0 <= value <= 1.0 for point in points for value in point)


def test_scribble_adapter_applies_width_and_later_stroke_wins() -> None:
    points, labels = scribbles_to_point_prompts(
        [
            {"polarity": 1, "points": [[0.1, 0.5], [0.9, 0.5]], "width": 0.2},
            {"polarity": 0, "points": [[0.5, 0.1], [0.5, 0.9]], "width": 0.05},
        ],
        image_size=(40, 40),
        max_rasterized_pixels=2_000_000,
        max_points=1_600,
    )
    labelled = {(round(x, 3), round(y, 3)): label for (x, y), label in zip(points, labels)}
    center = min(labelled, key=lambda point: abs(point[0] - 0.5) + abs(point[1] - 0.5))
    assert labelled[center] == 0
    assert any(label == 1 and abs(y - 0.5) < 0.1 for (x, y), label in zip(points, labels))


def test_scribble_adapter_rejects_raster_work_before_densifying() -> None:
    alternating = [[0.0, 0.0], [1.0, 1.0]] * 100
    with pytest.raises(PromptAdapterError, match="rasterized prompt pixels"):
        scribbles_to_point_prompts(
            [{"polarity": 1, "points": alternating, "width": 0.1}],
            image_size=(4_096, 4_096),
            max_rasterized_pixels=2_000_000,
        )
