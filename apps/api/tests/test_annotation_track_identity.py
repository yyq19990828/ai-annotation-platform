from __future__ import annotations

import pytest

from app.services.annotation_track_identity import prepare_compact_track_identity


@pytest.mark.parametrize(
    "geometry_type",
        ["video_track_bbox", "video_track_polygon", "video_track_polyline", "video_track_mask"],
)
def test_compact_track_identity_is_written_to_geometry_and_column(geometry_type):
    geometry, track_id = prepare_compact_track_identity(
        {"type": geometry_type, "keyframes": []}
    )
    assert track_id is not None
    assert geometry["track_id"] == track_id
    assert track_id.startswith("trk_")


def test_existing_column_is_authoritative_and_identity_change_can_be_rejected():
    geometry, track_id = prepare_compact_track_identity(
        {"type": "video_track_bbox", "track_id": "trk_old", "keyframes": []},
        "trk_column",
    )
    assert track_id == "trk_column"
    assert geometry["track_id"] == "trk_column"

    with pytest.raises(ValueError, match="cannot be changed"):
        prepare_compact_track_identity(
            {"type": "video_track_bbox", "track_id": "trk_new", "keyframes": []},
            "trk_column",
            reject_identity_change=True,
        )


def test_non_track_geometry_passes_through_without_allocating_track_id():
    geometry, track_id = prepare_compact_track_identity({"type": "bbox", "x": 1}, None)
    assert geometry == {"type": "bbox", "x": 1}
    assert track_id is None
