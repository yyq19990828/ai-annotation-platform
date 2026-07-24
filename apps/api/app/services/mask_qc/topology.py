from __future__ import annotations

from dataclasses import dataclass

from app.services.mask_qc.contracts import (
    MaskComponent,
    MaskOverlapMetrics,
    MaskTopologyMetrics,
)
from app.utils.raster_mask_rle import coco_rle_area, validate_coco_rle

Span = tuple[int, int]
IndexedSpan = tuple[int, int, int]


@dataclass
class _DisjointSet:
    parent: list[int]
    rank: list[int]

    @classmethod
    def empty(cls) -> _DisjointSet:
        return cls(parent=[], rank=[])

    def add(self) -> int:
        node = len(self.parent)
        self.parent.append(node)
        self.rank.append(0)
        return node

    def find(self, node: int) -> int:
        while self.parent[node] != node:
            self.parent[node] = self.parent[self.parent[node]]
            node = self.parent[node]
        return node

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if self.rank[left_root] == self.rank[right_root]:
            self.rank[left_root] += 1


def foreground_columns(rle: dict) -> tuple[int, int, list[list[Span]]]:
    """Return foreground spans per column without decoding a dense mask.

    COCO RLE is column-major. Keeping only run-derived spans makes the memory
    cost proportional to encoded topology, including for an 8192² sparse mask.
    """

    height, width, counts = validate_coco_rle(rle)
    columns: list[list[Span]] = [[] for _ in range(width)]
    offset = 0
    foreground = False
    for raw_length in counts:
        length = int(raw_length)
        if foreground and length:
            cursor = offset
            remaining = length
            while remaining:
                column, start = divmod(cursor, height)
                take = min(remaining, height - start)
                end = start + take - 1
                spans = columns[column]
                if spans and start <= spans[-1][1] + 1:
                    spans[-1] = (spans[-1][0], max(spans[-1][1], end))
                else:
                    spans.append((start, end))
                cursor += take
                remaining -= take
        offset += length
        foreground = not foreground
    return height, width, columns


def _background_columns(foreground: list[list[Span]], height: int) -> list[list[Span]]:
    background: list[list[Span]] = []
    for spans in foreground:
        cursor = 0
        complement: list[Span] = []
        for start, end in spans:
            if cursor < start:
                complement.append((cursor, start - 1))
            cursor = end + 1
        if cursor < height:
            complement.append((cursor, height - 1))
        background.append(complement)
    return background


def _componentize(
    columns: list[list[Span]],
    *,
    width: int,
    height: int,
    connectivity: int,
) -> tuple[MaskComponent, ...]:
    if connectivity not in {4, 8}:
        raise ValueError("connectivity must be 4 or 8")
    dsu = _DisjointSet.empty()
    indexed: list[list[IndexedSpan]] = []
    for spans in columns:
        indexed.append([(start, end, dsu.add()) for start, end in spans])

    padding = 1 if connectivity == 8 else 0
    for column in range(1, width):
        previous = indexed[column - 1]
        current = indexed[column]
        left = right = 0
        while left < len(previous) and right < len(current):
            p_start, p_end, p_node = previous[left]
            c_start, c_end, c_node = current[right]
            if p_end + padding < c_start:
                left += 1
                continue
            if c_end + padding < p_start:
                right += 1
                continue
            dsu.union(p_node, c_node)
            if p_end < c_end:
                left += 1
            elif c_end < p_end:
                right += 1
            else:
                left += 1
                right += 1

    grouped: dict[int, list[tuple[int, int, int]]] = {}
    for x, spans in enumerate(indexed):
        for start, end, node in spans:
            grouped.setdefault(dsu.find(node), []).append((x, start, end))

    components: list[MaskComponent] = []
    for spans in grouped.values():
        min_x = min(item[0] for item in spans)
        max_x = max(item[0] for item in spans)
        min_y = min(item[1] for item in spans)
        max_y = max(item[2] for item in spans)
        components.append(
            MaskComponent(
                area_pixels=sum(end - start + 1 for _, start, end in spans),
                bbox_pixels=(min_x, min_y, max_x + 1, max_y + 1),
                touches_border=(
                    min_x == 0
                    or max_x == width - 1
                    or min_y == 0
                    or max_y == height - 1
                ),
                spans=tuple(spans),
            )
        )
    return tuple(
        sorted(
            components,
            key=lambda item: (item.bbox_pixels, item.area_pixels, item.spans),
        )
    )


def _intersection_length(left: list[Span], right: list[Span]) -> int:
    total = 0
    left_index = right_index = 0
    while left_index < len(left) and right_index < len(right):
        left_start, left_end = left[left_index]
        right_start, right_end = right[right_index]
        total += max(0, min(left_end, right_end) - max(left_start, right_start) + 1)
        if left_end <= right_end:
            left_index += 1
        if right_end <= left_end:
            right_index += 1
    return total


def _boundary_length_4(columns: list[list[Span]]) -> int:
    area_by_column = [sum(end - start + 1 for start, end in spans) for spans in columns]
    boundary = sum(2 * len(spans) for spans in columns)
    for index, spans in enumerate(columns):
        previous = columns[index - 1] if index else []
        following = columns[index + 1] if index + 1 < len(columns) else []
        boundary += area_by_column[index] - _intersection_length(spans, previous)
        boundary += area_by_column[index] - _intersection_length(spans, following)
    return boundary


def analyze_rle_topology(rle: dict) -> MaskTopologyMetrics:
    height, width, foreground = foreground_columns(rle)
    components = _componentize(foreground, width=width, height=height, connectivity=8)
    background = _componentize(
        _background_columns(foreground, height),
        width=width,
        height=height,
        connectivity=4,
    )
    holes = tuple(component for component in background if not component.touches_border)
    area = sum(component.area_pixels for component in components)
    bbox = None
    if components:
        bbox = (
            min(component.bbox_pixels[0] for component in components),
            min(component.bbox_pixels[1] for component in components),
            max(component.bbox_pixels[2] for component in components),
            max(component.bbox_pixels[3] for component in components),
        )
    component_areas = [component.area_pixels for component in components]
    return MaskTopologyMetrics(
        width=width,
        height=height,
        area_pixels=area,
        bbox_pixels=bbox,
        component_count=len(components),
        hole_count=len(holes),
        min_component_pixels=min(component_areas, default=0),
        max_component_pixels=max(component_areas, default=0),
        touches_border=any(component.touches_border for component in components),
        boundary_length_4=_boundary_length_4(foreground),
        foreground_components=components,
        holes=holes,
    )


def _positive_runs(counts: list[int]):
    foreground = False
    for count in counts:
        if count:
            yield int(count), foreground
        foreground = not foreground


def _combine_rles(left: dict, right: dict, mode: str) -> dict:
    left_height, left_width, left_counts = validate_coco_rle(left)
    right_height, right_width, right_counts = validate_coco_rle(right)
    if (left_height, left_width) != (right_height, right_width):
        raise ValueError("mask dimensions do not match")
    left_runs = iter(_positive_runs(left_counts))
    right_runs = iter(_positive_runs(right_counts))
    left_remaining, left_foreground = next(left_runs)
    right_remaining, right_foreground = next(right_runs)
    output_counts: list[int] = []
    output_foreground = False
    output_length = 0
    consumed = 0
    total = left_height * left_width
    while consumed < total:
        step = min(left_remaining, right_remaining)
        if mode == "and":
            next_foreground = left_foreground and right_foreground
        elif mode == "or":
            next_foreground = left_foreground or right_foreground
        elif mode == "and_not":
            next_foreground = left_foreground and not right_foreground
        elif mode == "xor":
            next_foreground = left_foreground != right_foreground
        else:
            raise ValueError(f"unsupported RLE combine mode: {mode}")
        if next_foreground == output_foreground:
            output_length += step
        else:
            output_counts.append(output_length)
            output_foreground = next_foreground
            output_length = step
        consumed += step
        left_remaining -= step
        right_remaining -= step
        if left_remaining == 0 and consumed < total:
            left_remaining, left_foreground = next(left_runs)
        if right_remaining == 0 and consumed < total:
            right_remaining, right_foreground = next(right_runs)
    output_counts.append(output_length)
    return {
        "encoding": "coco_rle",
        "size": [left_height, left_width],
        "counts": output_counts,
    }


def rle_from_spans(
    *, height: int, width: int, spans: tuple[tuple[int, int, int], ...]
) -> dict:
    columns: list[list[Span]] = [[] for _ in range(width)]
    for x, start, end in sorted(spans):
        if not (0 <= x < width and 0 <= start <= end < height):
            raise ValueError("span falls outside mask dimensions")
        current = columns[x]
        if current and start <= current[-1][1] + 1:
            current[-1] = (current[-1][0], max(current[-1][1], end))
        else:
            current.append((start, end))
    return rle_from_columns(height=height, width=width, columns=columns)


def rle_from_columns(*, height: int, width: int, columns: list[list[Span]]) -> dict:
    if len(columns) != width:
        raise ValueError("column count does not match width")
    counts: list[int] = []
    output_foreground = False
    output_length = 0

    def emit(foreground: bool, length: int) -> None:
        nonlocal output_foreground, output_length
        if length <= 0:
            return
        if foreground == output_foreground:
            output_length += length
        else:
            counts.append(output_length)
            output_foreground = foreground
            output_length = length

    for spans in columns:
        cursor = 0
        for start, end in spans:
            emit(False, start - cursor)
            emit(True, end - start + 1)
            cursor = end + 1
        emit(False, height - cursor)
    counts.append(output_length)
    return {"encoding": "coco_rle", "size": [height, width], "counts": counts}


def rle_and_not(left: dict, right: dict) -> dict:
    return _combine_rles(left, right, "and_not")


def rle_and(left: dict, right: dict) -> dict:
    return _combine_rles(left, right, "and")


def rle_or(left: dict, right: dict) -> dict:
    return _combine_rles(left, right, "or")


def rle_xor(left: dict, right: dict) -> dict:
    return _combine_rles(left, right, "xor")


def rle_replace_region(current: dict, replacement: dict, region: dict) -> dict:
    """Use replacement pixels inside region while preserving current outside it."""

    changed = _combine_rles(current, replacement, "xor")
    selected = _combine_rles(changed, region, "and")
    return _combine_rles(current, selected, "xor")


def compare_rles(left: dict, right: dict) -> MaskOverlapMetrics:
    left_area = coco_rle_area(left)
    right_area = coco_rle_area(right)
    intersection = _combine_rles(left, right, "and")
    xor = _combine_rles(left, right, "xor")
    intersection_pixels = coco_rle_area(intersection)
    xor_pixels = coco_rle_area(xor)
    return MaskOverlapMetrics(
        left_area_pixels=left_area,
        right_area_pixels=right_area,
        intersection_pixels=intersection_pixels,
        union_pixels=(left_area + right_area - intersection_pixels),
        xor_pixels=xor_pixels,
        intersection_rle=intersection,
    )
