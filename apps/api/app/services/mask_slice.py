"""Partition COCO RLE by pixel centers without allocating dense image buffers."""

from __future__ import annotations

import math
from typing import Protocol

from app.utils.raster_mask_rle import MAX_MASK_RUNS, coco_rle_area, validate_coco_rle


class SliceBudget(Protocol):
    def consume(self, amount: int = 1) -> None: ...


def slice_mask_rle(
    source: dict, cut_path: list[tuple[float, float]], budget: SliceBudget
) -> tuple[dict, dict]:
    """Return kept/new RLE; greater area keeps identity, with left winning ties.

    Evaluate the same binary64 expression as the browser, with no epsilon. Each
    foreground span is monotone along y, so binary search finds its partition.
    Both outputs consume exactly the source's foreground, including center ties.
    """
    if (
        len(cut_path) != 2
        or cut_path[0] == cut_path[1]
        or any(
            len(point) != 2
            or any(not math.isfinite(v) or not 0 <= v <= 1 for v in point)
            for point in cut_path
        )
    ):
        raise ValueError("切线需要两个不同的归一化有限端点")
    height, width, counts = validate_coco_rle(source)
    (ax, ay), (bx, by) = cut_path
    dx, dy = bx - ax, by - ay
    output = [[], []]
    ends = [0, 0]

    def append(side: int, start: int, end: int) -> None:
        if end <= start:
            return
        runs = output[side]
        if runs and start == ends[side]:
            runs[-1] += end - start
        else:
            if len(runs) + 2 > MAX_MASK_RUNS:
                raise ValueError("切割结果超过 RLE 运算预算")
            runs.extend((start - ends[side], end - start))
        ends[side] = end

    def left(x: int, y: int) -> bool:
        budget.consume()
        return dx * ((y + 0.5) / height - ay) - dy * ((x + 0.5) / width - ax) >= 0

    offset = 0
    for index, count in enumerate(counts):
        budget.consume()
        end = offset + count
        if index % 2:
            cursor = offset
            while cursor < end:
                x, y0 = divmod(cursor, height)
                y1 = min(height, end - x * height)
                first, last = left(x, y0), left(x, y1 - 1)
                if first == last:
                    append(0 if first else 1, cursor, x * height + y1)
                else:
                    low, high = y0 + 1, y1 - 1
                    while low < high:
                        mid = (low + high) // 2
                        if left(x, mid) == first:
                            low = mid + 1
                        else:
                            high = mid
                    split = x * height + low
                    append(0 if first else 1, cursor, split)
                    append(1 if first else 0, split, x * height + y1)
                cursor = x * height + y1
        offset = end
    results = []
    for side in range(2):
        runs = output[side]
        if not runs:
            raise ValueError("切线必须将来源分成两个非空 Mask")
        if ends[side] < height * width:
            runs.append(height * width - ends[side])
        result = {"encoding": "coco_rle", "size": [height, width], "counts": runs}
        validate_coco_rle(result)
        results.append(result)
    if coco_rle_area(results[0]) < coco_rle_area(results[1]):
        results.reverse()
    return results[0], results[1]
