"""Small COCO uncompressed RLE codec.

Public buffers are row-major. COCO RLE scans column-major and always starts
with the background run, so a leading zero is required when pixel (0, 0) is
foreground.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

MAX_MASK_DIMENSION = 4096
MAX_MASK_PIXELS = MAX_MASK_DIMENSION * MAX_MASK_DIMENSION
MAX_MASK_RUNS = 1_000_000


def _strict_positive_int(value: Any, name: str) -> int:
    if type(value) is not int or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def validate_coco_rle(
    rle: Mapping[str, Any],
    *,
    max_dimension: int = MAX_MASK_DIMENSION,
    max_pixels: int = MAX_MASK_PIXELS,
    max_runs: int = MAX_MASK_RUNS,
) -> tuple[int, int, list[int]]:
    if rle.get("encoding") != "coco_rle":
        raise ValueError("encoding must be 'coco_rle'")
    size = rle.get("size")
    if not isinstance(size, list) or len(size) != 2:
        raise ValueError("size must be [height, width]")
    height = _strict_positive_int(size[0], "height")
    width = _strict_positive_int(size[1], "width")
    if height > max_dimension or width > max_dimension:
        raise ValueError(f"mask dimensions must be <= {max_dimension}")
    pixels = height * width
    if pixels > max_pixels:
        raise ValueError(f"mask pixels must be <= {max_pixels}")

    raw_counts = rle.get("counts")
    if not isinstance(raw_counts, list) or not raw_counts:
        raise ValueError("counts must be a non-empty integer array")
    if len(raw_counts) > max_runs:
        raise ValueError(f"mask runs must be <= {max_runs}")
    counts: list[int] = []
    total = 0
    for index, value in enumerate(raw_counts):
        if type(value) is not int or value < 0:
            raise ValueError(f"counts[{index}] must be a non-negative integer")
        counts.append(value)
        total += value
        if total > pixels:
            raise ValueError("sum(counts) exceeds height * width")
    if total != pixels:
        raise ValueError("sum(counts) must equal height * width")
    return height, width, counts


def encode_coco_rle(
    pixels_row_major: Sequence[int], width: int, height: int
) -> dict[str, Any]:
    width = _strict_positive_int(width, "width")
    height = _strict_positive_int(height, "height")
    if width > MAX_MASK_DIMENSION or height > MAX_MASK_DIMENSION:
        raise ValueError(f"mask dimensions must be <= {MAX_MASK_DIMENSION}")
    pixel_count = width * height
    if pixel_count > MAX_MASK_PIXELS:
        raise ValueError(f"mask pixels must be <= {MAX_MASK_PIXELS}")
    if len(pixels_row_major) != pixel_count:
        raise ValueError("pixel buffer length must equal width * height")

    # Predictor outputs are NumPy arrays. Converting to column-major once and
    # finding transitions in native code avoids a Python loop over every pixel
    # for every candidate (tens of millions of iterations for exemplar output).
    column_major = np.asarray(pixels_row_major, dtype=np.bool_).reshape(
        height,
        width,
    ).ravel(order="F")
    transitions = np.flatnonzero(column_major[1:] != column_major[:-1]) + 1
    boundaries = np.concatenate(([0], transitions, [pixel_count]))
    counts = np.diff(boundaries).astype(int).tolist()
    if bool(column_major[0]):
        counts.insert(0, 0)
    if len(counts) > MAX_MASK_RUNS:
        raise ValueError(f"mask runs must be <= {MAX_MASK_RUNS}")
    return {"encoding": "coco_rle", "size": [height, width], "counts": counts}


def decode_coco_rle(rle: Mapping[str, Any]) -> bytearray:
    height, width, counts = validate_coco_rle(rle)
    out = bytearray(width * height)
    offset = 0
    foreground = False
    for run_length in counts:
        if foreground:
            end = offset + run_length
            for column_major_index in range(offset, end):
                x, y = divmod(column_major_index, height)
                out[y * width + x] = 1
        offset += run_length
        foreground = not foreground
    return out
