from __future__ import annotations

import io
from typing import Any

from PIL import Image

from app.services.video_tracks import derive_track_number, resolve_track_at_frame
from app.utils.raster_mask_rle import decode_coco_rle, validate_coco_rle

DAVIS_MAX_OBJECTS = 254


def davis_palette() -> list[int]:
    """Return the standard 256-color DAVIS/VOC palette."""
    palette: list[int] = []
    for label in range(256):
        value = label
        red = green = blue = 0
        for shift in range(8):
            red |= ((value >> 0) & 1) << (7 - shift)
            green |= ((value >> 1) & 1) << (7 - shift)
            blue |= ((value >> 2) & 1) << (7 - shift)
            value >>= 3
        palette.extend((red, green, blue))
    return palette


def derive_davis_object_ids(
    tracks: list[tuple[Any, int, dict]],
) -> dict[Any, int]:
    if len(tracks) > DAVIS_MAX_OBJECTS:
        raise ValueError(
            f"DAVIS supports at most {DAVIS_MAX_OBJECTS} mask tracks per sequence; "
            "palette index 255 is reserved for void"
        )
    return derive_track_number([(annotation_id, geometry) for annotation_id, _, geometry in tracks])


def build_davis_palette_png(
    tracks: list[tuple[Any, int, dict]],
    *,
    frame_index: int,
    width: int,
    height: int,
) -> bytes:
    """Pack one source frame into a DAVIS palette PNG.

    Tracks are painted by ascending ``z_order`` and then ascending deterministic
    object id, so the later (higher) value wins on overlap.
    """
    object_ids = derive_davis_object_ids(tracks)
    pixels = bytearray(width * height)
    ordered = sorted(tracks, key=lambda row: (row[1], object_ids[row[0]]))
    for annotation_id, _z_order, geometry in ordered:
        resolved = resolve_track_at_frame(geometry, frame_index)
        if resolved is None:
            continue
        rle = resolved.get("mask_rle")
        if not isinstance(rle, dict):
            raise ValueError("DAVIS export requires hydrated mask RLE content")
        rle_height, rle_width, _ = validate_coco_rle(rle)
        if (rle_width, rle_height) != (width, height):
            raise ValueError(
                f"DAVIS mask size {rle_width}x{rle_height} does not match video {width}x{height}"
            )
        mask = decode_coco_rle(rle)
        object_id = object_ids[annotation_id]
        for index, value in enumerate(mask):
            if value:
                pixels[index] = object_id

    image = Image.frombytes("P", (width, height), bytes(pixels))
    image.putpalette(davis_palette())
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False)
    return output.getvalue()
