"""v0.10.30 · D-2.1a derive_track_number 确定性派生单测。"""

from app.services.video_tracks import derive_track_number


def _track(track_id: str, first_frame: int) -> dict:
    return {
        "type": "video_track_bbox",
        "track_id": track_id,
        "keyframes": [
            {"frame_index": first_frame, "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}},
            {"frame_index": first_frame + 5, "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}},
        ],
    }


def test_derive_track_number_orders_by_first_keyframe():
    tracks = [
        ("a", _track("trk_a", 10)),
        ("b", _track("trk_b", 0)),
        ("c", _track("trk_c", 5)),
    ]
    assert derive_track_number(tracks) == {"b": 1, "c": 2, "a": 3}


def test_derive_track_number_breaks_ties_by_track_id():
    tracks = [
        ("z", _track("trk_z", 0)),
        ("a", _track("trk_a", 0)),
    ]
    # 首关键帧帧号并列 -> 按 track_id 字典序: trk_a < trk_z
    assert derive_track_number(tracks) == {"a": 1, "z": 2}


def test_derive_track_number_empty():
    assert derive_track_number([]) == {}


def test_derive_track_number_unsorted_keyframes_use_min_frame():
    geometry = {
        "type": "video_track_bbox",
        "track_id": "trk_x",
        "keyframes": [
            {"frame_index": 8, "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}},
            {"frame_index": 3, "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}},
        ],
    }
    other = _track("trk_y", 5)
    # trk_x 首帧应取 min=3, 排在 trk_y(5) 前
    assert derive_track_number([("x", geometry), ("y", other)]) == {"x": 1, "y": 2}
