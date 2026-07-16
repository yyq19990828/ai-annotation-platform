import json
from pathlib import Path

import pytest

from mask_utils.rle import decode_coco_rle, encode_coco_rle, validate_coco_rle


FIXTURE_PATH = (
    Path(__file__).resolve().parents[4]
    / "apps/web/src/__fixtures__/rasterMaskRle.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text())


@pytest.mark.parametrize("case", FIXTURE["valid"], ids=lambda case: case["name"])
def test_shared_coco_rle_golden_cases(case):
    pixels = case["pixels_row_major"]
    rle = encode_coco_rle(pixels, case["width"], case["height"])
    assert rle["counts"] == case["counts"]
    assert list(decode_coco_rle(rle)) == pixels


@pytest.mark.parametrize("case", FIXTURE["invalid"], ids=lambda case: case["name"])
def test_shared_coco_rle_rejects_invalid_cases(case):
    with pytest.raises(ValueError):
        validate_coco_rle(
            {"encoding": "coco_rle", "size": case["size"], "counts": case["counts"]}
        )
