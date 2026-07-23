import json
from pathlib import Path

import pytest
import numpy as np

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


def test_shared_coco_rle_numpy_input_keeps_column_major_contract():
    pixels = np.array([[0, 1, 0], [1, 1, 0]], dtype=np.uint8)
    rle = encode_coco_rle(pixels.reshape(-1), 3, 2)

    assert rle == {
        "encoding": "coco_rle",
        "size": [2, 3],
        "counts": [1, 3, 2],
    }
    assert list(decode_coco_rle(rle)) == pixels.reshape(-1).tolist()
