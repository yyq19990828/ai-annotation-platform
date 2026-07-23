"""Adapters from native Mask/scribble wire payloads to SAM decoder inputs."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
from collections.abc import Mapping, Sequence
from typing import Any

from mask_utils.rle import decode_coco_rle, validate_coco_rle

LOW_RES_MASK_SIDE = 256
MAX_ADAPTED_SCRIBBLE_POINTS = 512


class PromptAdapterError(ValueError):
    """A bounded prompt cannot be converted to a model input."""


def mask_prompt_to_low_res_logits(
    mask_prompt: Mapping[str, Any],
    *,
    expected_size: tuple[int, int] | None = None,
    low_res_size: tuple[int, int] = (LOW_RES_MASK_SIDE, LOW_RES_MASK_SIDE),
) -> Any:
    """Decode an authorized COCO RLE seed into bounded SAM low-res logits."""

    import numpy as np

    rle = mask_prompt.get("rle")
    if not isinstance(rle, Mapping):
        raise PromptAdapterError("mask_prompt.rle is required")
    try:
        height, width, _counts = validate_coco_rle(rle)
    except ValueError as exc:
        raise PromptAdapterError(str(exc)) from exc
    digest = hashlib.sha256(
        json.dumps(
            {
                "encoding": "coco_rle",
                "size": list(rle["size"]),
                "counts": list(rle["counts"]),
            },
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    source_digest = mask_prompt.get("source_digest")
    if not isinstance(source_digest, str) or not hmac.compare_digest(
        digest, source_digest
    ):
        raise PromptAdapterError("mask_prompt source_digest does not match its RLE")
    if expected_size is not None and (width, height) != expected_size:
        raise PromptAdapterError(
            f"mask_prompt size must match image {expected_size[0]}x{expected_size[1]}"
        )
    low_res_height, low_res_width = low_res_size
    if low_res_height <= 0 or low_res_width <= 0:
        raise PromptAdapterError("low_res_size must contain positive dimensions")
    binary = np.frombuffer(decode_coco_rle(rle), dtype=np.uint8).reshape(height, width)
    ys = np.minimum(
        ((np.arange(low_res_height) + 0.5) * height / low_res_height).astype(int),
        height - 1,
    )
    xs = np.minimum(
        ((np.arange(low_res_width) + 0.5) * width / low_res_width).astype(int),
        width - 1,
    )
    sampled = binary[np.ix_(ys, xs)] > 0
    return np.where(sampled, 16.0, -16.0).astype(np.float32, copy=False)[None, :, :]


def scribbles_to_point_prompts(
    scribbles: Sequence[Mapping[str, Any]],
    *,
    image_size: tuple[int, int],
    max_rasterized_pixels: int,
    max_points: int = MAX_ADAPTED_SCRIBBLE_POINTS,
) -> tuple[list[list[float]], list[int]]:
    """Rasterize normalized strokes, then sample a bounded SAM point prompt.

    ``width`` is normalized against the shorter image side. Strokes are applied
    in request order, so later positive/negative paint wins at overlaps. The
    raster-work budget is checked before allocating or drawing large temporary
    objects; output sampling is deterministic and preserves both polarities.
    """

    import cv2
    import numpy as np

    if not scribbles:
        raise PromptAdapterError("scribbles must be non-empty")
    image_width, image_height = image_size
    if (
        type(image_width) is not int
        or type(image_height) is not int
        or image_width <= 0
        or image_height <= 0
    ):
        raise PromptAdapterError("image_size must contain positive integers")
    if type(max_points) is not int or max_points <= 0:
        raise PromptAdapterError("max_points must be a positive integer")
    if type(max_rasterized_pixels) is not int or max_rasterized_pixels <= 0:
        raise PromptAdapterError("max_rasterized_pixels must be a positive integer")

    validated: list[tuple[int, list[tuple[float, float]], int]] = []
    raster_work = 0
    short_side = min(image_width, image_height)
    for stroke_index, stroke in enumerate(scribbles):
        polarity = stroke.get("polarity")
        if type(polarity) is not int or polarity not in (0, 1):
            raise PromptAdapterError(
                f"scribbles[{stroke_index}].polarity must be 0 or 1"
            )
        raw_points = stroke.get("points")
        if not isinstance(raw_points, Sequence) or len(raw_points) < 2:
            raise PromptAdapterError(
                f"scribbles[{stroke_index}].points must contain >= 2 points"
            )
        points: list[tuple[float, float]] = []
        for point_index, point in enumerate(raw_points):
            if not isinstance(point, Sequence) or len(point) != 2:
                raise PromptAdapterError(
                    f"scribbles[{stroke_index}].points[{point_index}] must be [x,y]"
                )
            try:
                x, y = float(point[0]), float(point[1])
            except (TypeError, ValueError) as exc:
                raise PromptAdapterError("scribble points must be numeric") from exc
            if (
                not math.isfinite(x)
                or not math.isfinite(y)
                or not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0)
            ):
                raise PromptAdapterError(
                    "scribble points must be finite and normalized"
                )
            points.append((x, y))

        try:
            normalized_width = float(stroke.get("width"))
        except (TypeError, ValueError) as exc:
            raise PromptAdapterError("scribble width must be numeric") from exc
        if not math.isfinite(normalized_width) or not 0.0 < normalized_width <= 1.0:
            raise PromptAdapterError("scribble width must be finite and within (0,1]")
        thickness = max(1, round(normalized_width * short_side))
        radius = max(1, math.ceil(thickness / 2))
        # OpenCV draws each segment in bounded native memory. This conservative
        # capsule-area sum bounds cumulative raster work even for an 8k-point
        # polyline that repeatedly crosses the full image diagonal.
        raster_work += math.ceil(math.pi * radius * radius)
        for start, end in zip(points, points[1:]):
            dx = (end[0] - start[0]) * max(1, image_width - 1)
            dy = (end[1] - start[1]) * max(1, image_height - 1)
            raster_work += math.ceil(math.hypot(dx, dy) * thickness)
            raster_work += math.ceil(math.pi * radius * radius)
            if raster_work > max_rasterized_pixels:
                raise PromptAdapterError(
                    "scribble rasterized prompt pixels exceed the configured limit"
                )
        validated.append((polarity, points, thickness))

    # OpenCV's drawing primitives do not support every signed 8-bit operation
    # consistently across builds. Keep the ownership raster unsigned and use
    # distinct non-zero values for positive/negative paint.
    raster = np.zeros((image_height, image_width), dtype=np.uint8)
    for polarity, points, thickness in validated:
        value = 1 if polarity == 1 else 2
        pixel_points = np.asarray(
            [
                (
                    round(x * max(1, image_width - 1)),
                    round(y * max(1, image_height - 1)),
                )
                for x, y in points
            ],
            dtype=np.int32,
        )
        cv2.polylines(
            raster,
            [pixel_points],
            isClosed=False,
            color=value,
            thickness=thickness,
            lineType=cv2.LINE_8,
        )
        radius = max(1, math.ceil(thickness / 2))
        for x, y in pixel_points:
            cv2.circle(raster, (int(x), int(y)), radius, value, thickness=-1)

    positive = np.argwhere(raster == 1)
    negative = np.argwhere(raster == 2)
    total = len(positive) + len(negative)
    if total == 0:
        raise PromptAdapterError("scribble rasterization produced no prompt pixels")

    if total <= max_points:
        positive_budget = len(positive)
        negative_budget = len(negative)
    elif len(positive) == 0:
        positive_budget, negative_budget = 0, max_points
    elif len(negative) == 0:
        positive_budget, negative_budget = max_points, 0
    else:
        positive_budget = max(1, round(max_points * len(positive) / total))
        positive_budget = min(positive_budget, max_points - 1)
        negative_budget = max_points - positive_budget

    def sample(
        pixels: Any,
        budget: int,
        label: int,
    ) -> tuple[list[list[float]], list[int]]:
        if budget <= 0:
            return [], []
        if len(pixels) > budget:
            indices = np.linspace(0, len(pixels) - 1, num=budget, dtype=np.int64)
            pixels = pixels[indices]
        points = [
            [
                (float(x) + 0.5) / image_width,
                (float(y) + 0.5) / image_height,
            ]
            for y, x in pixels
        ]
        return points, [label] * len(points)

    positive_points, positive_labels = sample(positive, positive_budget, 1)
    negative_points, negative_labels = sample(negative, negative_budget, 0)
    return (
        positive_points + negative_points,
        positive_labels + negative_labels,
    )


__all__ = [
    "LOW_RES_MASK_SIDE",
    "MAX_ADAPTED_SCRIBBLE_POINTS",
    "PromptAdapterError",
    "mask_prompt_to_low_res_logits",
    "scribbles_to_point_prompts",
]
