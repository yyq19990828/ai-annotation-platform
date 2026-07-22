from __future__ import annotations

import pytest

from app.services.mask_conversion import (
    analyze_mask,
    mask_to_bbox_conversion,
    mask_to_region_conversion,
    rasterize_region_geometry,
    region_to_mask_conversion,
)
from app.utils.raster_mask_rle import decode_coco_rle, encode_coco_rle


def test_region_mask_round_trip_preserves_hole_and_components() -> None:
    geometry = {
        "type": "multi_polygon",
        "polygons": [
            {
                "type": "polygon",
                "points": [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
                "holes": [[[0.125, 0.25], [0.125, 0.75], [0.375, 0.75], [0.375, 0.25]]],
            },
            {
                "type": "polygon",
                "points": [[0.75, 0.25], [1, 0.25], [1, 0.75], [0.75, 0.75]],
            },
        ],
    }

    rle, forward = region_to_mask_conversion(geometry, width=8, height=4)
    restored, backward = mask_to_region_conversion(rle)
    round_trip = rasterize_region_geometry(restored, width=8, height=4)

    assert decode_coco_rle(round_trip) == decode_coco_rle(rle)
    assert forward.source_components == 2
    assert forward.target_components == 2
    assert forward.source_holes == 1
    assert forward.target_holes == 1
    assert backward.lossy is False
    assert restored["type"] == "multi_polygon"


def test_mask_analysis_uses_four_connected_components() -> None:
    pixels = bytearray(
        [
            1,
            0,
            0,
            1,
        ]
    )
    rle = encode_coco_rle(pixels, width=2, height=2)

    stats = analyze_mask(rle)

    assert stats.area == 2
    assert stats.components == 2
    assert stats.holes == 0


def test_mask_to_bbox_is_tight_and_reports_background() -> None:
    pixels = bytearray(5 * 4)
    for x, y in [(1, 1), (2, 1), (1, 2)]:
        pixels[y * 5 + x] = 1
    rle = encode_coco_rle(pixels, width=5, height=4)

    geometry, report = mask_to_bbox_conversion(rle, video_frame_index=7)

    assert geometry == {
        "type": "video_bbox",
        "frame_index": 7,
        "x": 0.2,
        "y": 0.25,
        "w": 0.4,
        "h": 0.5,
    }
    assert report.source_area_pixels == 3
    assert report.target_area_pixels == 4
    assert report.changed_pixels == 1
    assert report.lossy is True


def test_empty_region_conversion_is_rejected() -> None:
    with pytest.raises(ValueError, match="empty mask"):
        region_to_mask_conversion(
            {
                "type": "polygon",
                "points": [[0, 0], [0.01, 0], [0.01, 0.01]],
            },
            width=2,
            height=2,
        )


def test_region_to_mask_reports_hole_lost_below_pixel_resolution() -> None:
    _, report = region_to_mask_conversion(
        {
            "type": "polygon",
            "points": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "holes": [
                [[0.45, 0.45], [0.55, 0.45], [0.55, 0.55], [0.45, 0.55]]
            ],
        },
        width=4,
        height=4,
    )

    assert report.source_holes == 1
    assert report.target_holes == 0
    assert report.lossy is True
    assert report.reasons == ("topology_changed_on_rasterization",)
