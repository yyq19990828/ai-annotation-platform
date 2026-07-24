from __future__ import annotations

from app.services.video_tracks import (
    resolve_mask_track_state_at_frame,
    resolve_track_at_frame,
)


def _geometry() -> dict:
    return {
        "type": "video_track_mask",
        "track_id": "track-1",
        "keyframes": [
            {
                "frame_index": 0,
                "mask": {"encoding": "coco_rle", "size": [1, 1], "counts": [0, 1]},
                "source": "manual",
            },
            {
                "frame_index": 10,
                "mask": {"encoding": "coco_rle", "size": [1, 1], "counts": [0, 1]},
                "source": "prediction",
                "confidence": 0.75,
                "occluded": True,
            },
        ],
        "outside": [
            {"from": 3, "to": 4, "source": "prediction"},
            {"from": 7, "to": 8, "source": "manual"},
        ],
    }


def test_detailed_resolver_distinguishes_absent_outside_and_held() -> None:
    geometry = _geometry()
    held = resolve_mask_track_state_at_frame(geometry, 2)
    assert (held["state"], held["resolved_from_frame"]) == ("held", 0)

    absent = resolve_mask_track_state_at_frame(geometry, 3)
    assert absent["state"] == "absent"
    assert absent["source"] == "prediction"

    outside = resolve_mask_track_state_at_frame(geometry, 7)
    assert outside["state"] == "outside"
    assert outside["source"] == "manual"

    assert resolve_track_at_frame(geometry, 3) is None
    assert resolve_track_at_frame(geometry, 7) is None


def test_detailed_resolver_preserves_exact_occluded_provenance() -> None:
    resolved = resolve_mask_track_state_at_frame(_geometry(), 10)
    assert resolved["state"] == "occluded"
    assert resolved["resolved_from_frame"] == 10
    assert resolved["source"] == "prediction"
    assert resolved["confidence"] == 0.75

    compatible = resolve_track_at_frame(_geometry(), 10)
    assert compatible is not None
    assert compatible["occluded"] is True
