import io

import pytest
from PIL import Image

from app.services.export_davis import (
    DAVIS_MAX_OBJECTS,
    build_davis_palette_png,
    davis_palette,
    derive_davis_object_ids,
)
from app.utils.raster_mask_rle import encode_coco_rle


def _track(track_id: str, pixels: list[int], *, outside=None, occluded=False):
    rle = encode_coco_rle(pixels, 3, 2)
    return {
        "type": "video_track_mask",
        "track_id": track_id,
        "keyframes": [
            {
                "frame_index": 0,
                "mask": {"encoding": "coco_rle_ref", "size": [2, 3]},
                "mask_rle": rle,
                "source": "manual",
                "occluded": occluded,
            }
        ],
        "outside": outside or [],
    }


def test_davis_png_is_palette_mode_with_stable_ids_and_overlap_order():
    low = _track("trk_a", [1, 1, 0, 0, 0, 0], occluded=True)
    high = _track("trk_b", [0, 1, 0, 0, 1, 0])
    payload = build_davis_palette_png(
        [("low", 1, low), ("high", 2, high)],
        frame_index=0,
        width=3,
        height=2,
    )

    image = Image.open(io.BytesIO(payload))
    image.load()
    assert image.mode == "P"
    assert image.size == (3, 2)
    assert list(image.getdata()) == [1, 2, 0, 0, 2, 0]
    assert image.getpalette()[:12] == davis_palette()[:12]
    assert 255 not in image.getdata()


def test_davis_png_honors_outside_but_keeps_occluded_visible_pixels():
    outside = _track("trk_a", [1, 0, 0, 0, 0, 0], outside=[{"from": 1, "to": 1}])
    held = _track("trk_b", [0, 0, 1, 0, 0, 0], occluded=True)
    payload = build_davis_palette_png(
        [("outside", 1, outside), ("held", 1, held)],
        frame_index=1,
        width=3,
        height=2,
    )
    assert list(Image.open(io.BytesIO(payload)).getdata()) == [0, 0, 2, 0, 0, 0]


def test_davis_rejects_more_than_254_sequence_objects():
    tracks = [
        (
            str(index),
            0,
            {"type": "video_track_mask", "track_id": f"trk_{index}", "keyframes": []},
        )
        for index in range(DAVIS_MAX_OBJECTS + 1)
    ]
    with pytest.raises(ValueError, match="at most 254"):
        derive_davis_object_ids(tracks)
