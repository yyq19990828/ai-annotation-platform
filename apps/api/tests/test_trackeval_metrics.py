import numpy as np

from app.services.video_track_quality import _issue_frame_counts
from app.vendor.trackeval_metrics import evaluate_sequence


def _data(gt, tracker, similarities, *, gt_ids, tracker_ids):
    return {
        "gt_ids": [np.asarray(row, dtype=int) for row in gt],
        "tracker_ids": [np.asarray(row, dtype=int) for row in tracker],
        "similarity_scores": [np.asarray(row, dtype=float) for row in similarities],
        "num_gt_ids": gt_ids,
        "num_tracker_ids": tracker_ids,
    }


def test_trackeval_subset_perfect_and_identity_switch():
    perfect = evaluate_sequence(
        _data(
            [[0], [0]],
            [[0], [0]],
            [[[1.0]], [[1.0]]],
            gt_ids=1,
            tracker_ids=1,
        )
    )
    assert perfect["HOTA"] == 1
    assert perfect["IDF1"] == 1
    assert perfect["MOTA_left"] == 1

    switched = evaluate_sequence(
        _data(
            [[0], [0]],
            [[0], [1]],
            [[[1.0]], [[1.0]]],
            gt_ids=1,
            tracker_ids=2,
        )
    )
    assert switched["IDSW"] == 1
    assert switched["Frag"] == 0
    assert switched["MOTA_left"] == 0.5


def test_trackeval_subset_fp_fn_and_fragmentation():
    result = evaluate_sequence(
        _data(
            [[0], [0], [0]],
            [[0], [1], [0]],
            [[[1.0]], [[0.0]], [[1.0]]],
            gt_ids=1,
            tracker_ids=2,
        )
    )
    assert result["FP"] == 1
    assert result["FN"] == 1
    assert result["Frag"] == 1


def test_quality_issue_aggregate_clips_to_requested_range():
    issues = [
        {
            "code": "false_negative",
            "left_annotation_id": "left",
            "right_annotation_id": None,
            "frame_start": 4,
            "frame_end": 8,
        },
        {
            "code": "false_positive",
            "left_annotation_id": None,
            "right_annotation_id": "right",
            "frame_start": 7,
            "frame_end": 9,
        },
    ]

    assert _issue_frame_counts(issues, frame_range=(6, 7)) == {
        "false_negative": 2,
        "false_positive": 1,
    }
    assert _issue_frame_counts(issues, annotation_id="left") == {"false_negative": 5}
