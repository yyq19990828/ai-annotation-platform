from __future__ import annotations

import io
from collections import defaultdict, deque
from collections.abc import Sequence
from typing import Any

import numpy as np
from PIL import Image, ImageDraw
from pycocotools import mask as coco_mask

from app.utils.raster_mask_rle import (
    decode_coco_rle,
    encode_coco_rle,
    validate_coco_rle,
)


def compress_coco_rle(rle: dict[str, Any]) -> dict[str, Any]:
    """Convert canonical uncompressed COCO RLE to the official string form."""
    height, width, counts = validate_coco_rle(rle)
    encoded = coco_mask.frPyObjects(
        {"size": [height, width], "counts": counts}, height, width
    )
    compressed = encoded[0] if isinstance(encoded, list) else encoded
    raw_counts = compressed["counts"]
    if isinstance(raw_counts, bytes):
        raw_counts = raw_counts.decode("ascii")
    return {"size": [height, width], "counts": raw_counts}


def normalize_coco_segmentation_rle(
    segmentation: dict[str, Any],
    *,
    expected_width: int,
    expected_height: int,
) -> dict[str, Any]:
    """Accept official compressed/uncompressed COCO RLE and return canonical RLE."""
    size = segmentation.get("size")
    if size != [expected_height, expected_width]:
        raise ValueError("RLE size must match image width / height")
    counts = segmentation.get("counts")
    if isinstance(counts, list):
        result = {"encoding": "coco_rle", "size": size, "counts": counts}
        validate_coco_rle(result)
        return result
    if not isinstance(counts, (str, bytes)):
        raise ValueError("RLE counts must be an integer array or compressed string")
    encoded_counts = counts.encode("ascii") if isinstance(counts, str) else counts
    try:
        dense = coco_mask.decode(
            {"size": [expected_height, expected_width], "counts": encoded_counts}
        )
    except Exception as exc:
        raise ValueError("compressed COCO RLE is invalid") from exc
    flat = np.asarray(dense, dtype=np.uint8).reshape(
        (expected_height, expected_width), order="C"
    )
    return encode_coco_rle(flat.ravel(order="C").tolist(), expected_width, expected_height)


def rasterize_coco_polygons(
    polygons: Sequence[Sequence[float]], *, width: int, height: int
) -> dict[str, Any]:
    if not polygons:
        raise ValueError("polygon segmentation must contain at least one ring")
    try:
        encoded = coco_mask.frPyObjects(list(polygons), height, width)
        merged = coco_mask.merge(encoded)
        dense = coco_mask.decode(merged)
    except Exception as exc:
        raise ValueError("polygon segmentation is invalid") from exc
    pixels = np.asarray(dense, dtype=np.uint8).reshape((height, width), order="C")
    return encode_coco_rle(pixels.ravel(order="C").tolist(), width, height)


def rasterize_normalized_polygon(
    points: Sequence[Sequence[float]], *, width: int, height: int
) -> dict[str, Any]:
    if len(points) < 3:
        raise ValueError("polygon must contain at least three points")
    pixel_points: list[tuple[float, float]] = []
    for point in points:
        if len(point) != 2:
            raise ValueError("polygon point must be [x, y]")
        x, y = float(point[0]), float(point[1])
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError("polygon coordinates must be normalized")
        pixel_points.append((x * width, y * height))
    image = Image.new("L", (width, height), 0)
    ImageDraw.Draw(image).polygon(pixel_points, fill=1)
    return encode_coco_rle(list(image.getdata()), width, height)


class _BitReader:
    def __init__(self, data: Sequence[int]) -> None:
        self._data = data
        self._offset = 0

    def read(self, size: int) -> int:
        value = 0
        for _ in range(size):
            byte_index, bit_index = divmod(self._offset, 8)
            if byte_index >= len(self._data):
                raise ValueError("Label Studio RLE ended unexpectedly")
            value = (value << 1) | ((int(self._data[byte_index]) >> (7 - bit_index)) & 1)
            self._offset += 1
        return value


def decode_label_studio_rle(encoded: Sequence[int]) -> bytearray:
    """Decode the BrushLabels bitstream independently from COCO RLE."""
    reader = _BitReader(encoded)
    value_count = reader.read(32)
    word_size = reader.read(5) + 1
    run_sizes = [reader.read(4) + 1 for _ in range(4)]
    if word_size > 8:
        raise ValueError("Label Studio RLE word size must be <= 8")
    output = bytearray(value_count)
    index = 0
    while index < value_count:
        repeated = reader.read(1)
        run_size = run_sizes[reader.read(2)]
        end = index + 1 + reader.read(run_size)
        if end > value_count:
            raise ValueError("Label Studio RLE run exceeds declared length")
        if repeated:
            value = reader.read(word_size)
            output[index:end] = bytes([value]) * (end - index)
            index = end
        else:
            while index < end:
                output[index] = reader.read(word_size)
                index += 1
    return output


def _append_bits(bits: list[str], value: int, width: int) -> None:
    bits.append(f"{value:0{width}b}")


def encode_label_studio_mask(pixels_row_major: Sequence[int]) -> list[int]:
    """Encode binary pixels using Label Studio SDK's RGBA BrushLabels contract."""
    rgba: list[int] = []
    for pixel in pixels_row_major:
        value = 255 if pixel else 0
        rgba.extend((value, value, value, value))
    bits: list[str] = [f"{len(rgba):032b}", f"{7:05b}", "0010001101111111"]
    index = 0
    while index < len(rgba):
        value = rgba[index]
        end = index + 1
        while end < len(rgba) and rgba[end] == value:
            end += 1
        remaining = end - index
        while remaining:
            chunk = min(remaining, 65_536)
            if chunk == 1:
                bits.append("000000")
            elif chunk <= 8:
                bits.append("100")
                _append_bits(bits, chunk - 1, 3)
            elif chunk <= 16:
                bits.append("101")
                _append_bits(bits, chunk - 1, 4)
            elif chunk <= 256:
                bits.append("110")
                _append_bits(bits, chunk - 1, 8)
            else:
                bits.append("111")
                _append_bits(bits, chunk - 1, 16)
            _append_bits(bits, value, 8)
            remaining -= chunk
        index = end
    bit_string = "".join(bits)
    padding = 8 - (len(bit_string) % 8)
    bit_string += "0" * padding
    return [int(bit_string[offset : offset + 8], 2) for offset in range(0, len(bit_string), 8)]


def label_studio_rle_to_coco(
    encoded: Sequence[int], *, width: int, height: int
) -> dict[str, Any]:
    rgba = decode_label_studio_rle(encoded)
    expected = width * height * 4
    if len(rgba) != expected:
        raise ValueError("Label Studio RLE length does not match original dimensions")
    alpha = [1 if rgba[index] else 0 for index in range(3, len(rgba), 4)]
    return encode_coco_rle(alpha, width, height)


def binary_png_bytes(rle: dict[str, Any]) -> bytes:
    height, width, _ = validate_coco_rle(rle)
    pixels = bytes(255 if value else 0 for value in decode_coco_rle(rle))
    image = Image.frombytes("L", (width, height), pixels)
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False)
    return output.getvalue()


def binary_png_to_coco(data: bytes, *, width: int, height: int) -> dict[str, Any]:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.mode != "L":
                raise ValueError("binary mask PNG must use 8-bit L mode")
            if image.size != (width, height):
                raise ValueError("PNG dimensions do not match the manifest")
            values = list(image.getdata())
    except OSError as exc:
        raise ValueError("mask PNG is invalid") from exc
    if any(value not in {0, 255} for value in values):
        raise ValueError("binary mask PNG pixels must be 0 or 255")
    return encode_coco_rle([value == 255 for value in values], width, height)


def indexed_png_bytes(pixel_ids: Sequence[int], *, width: int, height: int) -> bytes:
    if len(pixel_ids) != width * height:
        raise ValueError("indexed mask buffer length does not match dimensions")
    if any(type(value) is not int or value < 0 or value > 255 for value in pixel_ids):
        raise ValueError("indexed mask pixel IDs must be in [0, 255]")
    image = Image.frombytes("P", (width, height), bytes(pixel_ids))
    palette: list[int] = []
    for value in range(256):
        palette.extend(((value * 37) % 256, (value * 67) % 256, (value * 97) % 256))
    palette[:3] = [0, 0, 0]
    image.putpalette(palette)
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False)
    return output.getvalue()


def indexed_png_to_coco(
    data: bytes, *, width: int, height: int, pixel_id: int
) -> dict[str, Any]:
    if pixel_id < 1 or pixel_id > 255:
        raise ValueError("indexed mask pixel ID must be in [1, 255]")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.mode != "P":
                raise ValueError("indexed mask PNG must use 8-bit P mode")
            if image.size != (width, height):
                raise ValueError("PNG dimensions do not match the manifest")
            values = list(image.getdata())
    except OSError as exc:
        raise ValueError("indexed mask PNG is invalid") from exc
    return encode_coco_rle([value == pixel_id for value in values], width, height)


def compose_indexed_mask(
    instances: Sequence[tuple[int, dict[str, Any], int]],
    *,
    overlap_policy: str,
) -> tuple[bytearray, dict[int, int]]:
    """Compose (pixel_id, rle, z_order), returning winner pixels and lost counts."""
    if overlap_policy not in {"error", "z_order", "larger_area", "smaller_area"}:
        raise ValueError("invalid indexed PNG overlap policy")
    if not instances:
        return bytearray(), {}
    first_height, first_width, _ = validate_coco_rle(instances[0][1])
    ranked: list[tuple[int, dict[str, Any], int, int]] = []
    for pixel_id, rle, z_order in instances:
        height, width, _ = validate_coco_rle(rle)
        if (height, width) != (first_height, first_width):
            raise ValueError("indexed mask instances must share dimensions")
        area = sum(decode_coco_rle(rle))
        ranked.append((pixel_id, rle, z_order, area))
    if overlap_policy == "z_order":
        ranked.sort(key=lambda row: (row[2], row[0]))
    elif overlap_policy == "larger_area":
        ranked.sort(key=lambda row: (row[3], row[0]))
    elif overlap_policy == "smaller_area":
        ranked.sort(key=lambda row: (-row[3], row[0]))
    else:
        ranked.sort(key=lambda row: row[0])
    output = bytearray(first_width * first_height)
    lost: dict[int, int] = defaultdict(int)
    for pixel_id, rle, _z_order, _area in ranked:
        pixels = decode_coco_rle(rle)
        for offset, value in enumerate(pixels):
            if not value:
                continue
            previous = output[offset]
            if previous:
                if overlap_policy == "error":
                    raise ValueError("indexed PNG instances overlap")
                lost[previous] += 1
            output[offset] = pixel_id
    return output, dict(lost)


def _component_pixels(pixels: Sequence[int], width: int, height: int) -> list[set[tuple[int, int]]]:
    unseen = {(x, y) for y in range(height) for x in range(width) if pixels[y * width + x]}
    components: list[set[tuple[int, int]]] = []
    while unseen:
        seed = min(unseen, key=lambda point: (point[1], point[0]))
        unseen.remove(seed)
        queue = deque([seed])
        component = {seed}
        while queue:
            x, y = queue.popleft()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    component.add(neighbor)
                    queue.append(neighbor)
        components.append(component)
    return components


def _signed_area(points: Sequence[tuple[int, int]]) -> float:
    return sum(
        x1 * y2 - x2 * y1
        for (x1, y1), (x2, y2) in zip(points, (*points[1:], points[0]))
    ) / 2


def _trace_component(component: set[tuple[int, int]]) -> list[tuple[int, int]]:
    edges: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for x, y in component:
        for neighbor, start, end in (
            ((x, y - 1), (x, y), (x + 1, y)),
            ((x + 1, y), (x + 1, y), (x + 1, y + 1)),
            ((x, y + 1), (x + 1, y + 1), (x, y + 1)),
            ((x - 1, y), (x, y + 1), (x, y)),
        ):
            if neighbor not in component:
                edges[start].append(end)
    loops: list[list[tuple[int, int]]] = []
    while edges:
        start = min(edges, key=lambda point: (point[1], point[0]))
        current = start
        loop = [start]
        while True:
            choices = edges.get(current)
            if not choices:
                break
            nxt = choices.pop(0)
            if not choices:
                edges.pop(current, None)
            if nxt == start:
                break
            loop.append(nxt)
            current = nxt
        if len(loop) >= 3:
            loops.append(loop)
    if not loops:
        return []
    outer = max(loops, key=lambda loop: abs(_signed_area(loop)))
    simplified: list[tuple[int, int]] = []
    for point in outer:
        if len(simplified) < 2:
            simplified.append(point)
            continue
        x0, y0 = simplified[-2]
        x1, y1 = simplified[-1]
        x2, y2 = point
        if (x1 - x0) * (y2 - y1) == (y1 - y0) * (x2 - x1):
            simplified[-1] = point
        else:
            simplified.append(point)
    return simplified


def mask_to_yolo_polygons(rle: dict[str, Any]) -> list[list[list[float]]]:
    height, width, _ = validate_coco_rle(rle)
    components = _component_pixels(decode_coco_rle(rle), width, height)
    polygons: list[list[list[float]]] = []
    for component in components:
        boundary = _trace_component(component)
        if len(boundary) >= 3:
            polygons.append([[x / width, y / height] for x, y in boundary])
    return polygons
