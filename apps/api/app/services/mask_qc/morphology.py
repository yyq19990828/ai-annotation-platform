from __future__ import annotations

import numpy as np

from app.services.mask_qc.contracts import MorphologyResult
from app.services.mask_qc.topology import (
    Span,
    foreground_columns,
    rle_from_columns,
)


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    padded = np.pad(mask, radius, constant_values=False)
    result = np.zeros_like(mask, dtype=np.bool_)
    height, width = mask.shape
    for dy in range(2 * radius + 1):
        for dx in range(2 * radius + 1):
            result |= padded[dy : dy + height, dx : dx + width]
    return result


def _erode(mask: np.ndarray, radius: int) -> np.ndarray:
    padded = np.pad(mask, radius, constant_values=False)
    result = np.ones_like(mask, dtype=np.bool_)
    height, width = mask.shape
    for dy in range(2 * radius + 1):
        for dx in range(2 * radius + 1):
            result &= padded[dy : dy + height, dx : dx + width]
    return result


def _decode_window(
    columns: list[list[Span]], *, x0: int, y0: int, x1: int, y1: int
) -> np.ndarray:
    window = np.zeros((y1 - y0, x1 - x0), dtype=np.bool_)
    for x in range(x0, x1):
        for start, end in columns[x]:
            clipped_start = max(start, y0)
            clipped_end = min(end + 1, y1)
            if clipped_start < clipped_end:
                window[clipped_start - y0 : clipped_end - y0, x - x0] = True
    return window


def _append_column_runs(
    target: list[Span], values: np.ndarray, *, y_offset: int
) -> None:
    start: int | None = None
    for index, value in enumerate(values):
        if value and start is None:
            start = index
        if start is not None and (not value or index + 1 == len(values)):
            end = index if value and index + 1 == len(values) else index - 1
            absolute_start = y_offset + start
            absolute_end = y_offset + end
            if target and absolute_start <= target[-1][1] + 1:
                target[-1] = (target[-1][0], absolute_end)
            else:
                target.append((absolute_start, absolute_end))
            start = None


def morphology_rle(
    rle: dict,
    *,
    operation: str,
    radius: int = 1,
    tile_size: int = 512,
) -> MorphologyResult:
    """Apply bounded dense morphology to sparse RLE tiles plus exact halo."""

    if radius < 1 or tile_size < 1:
        raise ValueError("radius and tile_size must be positive")
    if operation == "erode":
        pipeline = ("erode",)
    elif operation == "close_open":
        pipeline = ("dilate", "erode", "erode", "dilate")
    else:
        raise ValueError("unsupported morphology operation")
    height, width, columns = foreground_columns(rle)
    halo = radius * len(pipeline)
    output: list[list[Span]] = [[] for _ in range(width)]
    peak_pixels = 0
    for y0 in range(0, height, tile_size):
        y1 = min(height, y0 + tile_size)
        for x0 in range(0, width, tile_size):
            x1 = min(width, x0 + tile_size)
            window_x0 = max(0, x0 - halo)
            window_y0 = max(0, y0 - halo)
            window_x1 = min(width, x1 + halo)
            window_y1 = min(height, y1 + halo)
            tile = _decode_window(
                columns,
                x0=window_x0,
                y0=window_y0,
                x1=window_x1,
                y1=window_y1,
            )
            peak_pixels = max(peak_pixels, int(tile.size))
            for step in pipeline:
                tile = (
                    _erode(tile, radius) if step == "erode" else _dilate(tile, radius)
                )
            core = tile[
                y0 - window_y0 : y1 - window_y0,
                x0 - window_x0 : x1 - window_x0,
            ]
            for local_x in range(core.shape[1]):
                _append_column_runs(output[x0 + local_x], core[:, local_x], y_offset=y0)
    return MorphologyResult(
        rle=rle_from_columns(height=height, width=width, columns=output),
        peak_materialized_pixels=peak_pixels,
    )
