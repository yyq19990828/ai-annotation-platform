from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np

from video_predictor import SAM3MultiplexVideoTracker


class _FakePredictor:
    def __init__(self) -> None:
        self.requests: list[dict] = []

    def handle_request(self, request: dict) -> dict:
        self.requests.append(request)
        if request["type"] == "start_session":
            return {"session_id": "session-1"}
        if request["type"] == "add_prompt":
            return {
                "outputs": {
                    "out_obj_ids": np.array([], dtype=np.int64),
                    "out_binary_masks": np.empty((0, 1, 1), dtype=bool),
                }
            }
        return {}

    def handle_stream_request(self, _request: dict):
        return iter(())


def test_continuation_bboxes_are_sent_as_positive_prompts(monkeypatch, tmp_path):
    predictor = _FakePredictor()
    tracker = object.__new__(SAM3MultiplexVideoTracker)
    tracker.max_window_frames = 16
    tracker.active_sessions = 0
    tracker._predictor = predictor
    monkeypatch.setattr(tracker, "_extract_window_jpegs", lambda *_args: (100, 100, 15))
    monkeypatch.setattr(tracker, "_cleanup_tmp", MagicMock())

    tracker.propagate(
        str(tmp_path / "video.mp4"),
        16,
        30,
        "forward",
        "red car",
        {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        "bbox",
        [
            {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
            {"x": 0.5, "y": 0.6, "w": 0.2, "h": 0.1},
        ],
    )

    add_prompt = next(r for r in predictor.requests if r["type"] == "add_prompt")
    assert add_prompt["text"] == "red car"
    assert add_prompt["bounding_boxes"] == [
        [0.1, 0.2, 0.3, 0.4],
        [0.5, 0.6, 0.2, 0.1],
    ]
    assert add_prompt["bounding_box_labels"] == [1, 1]


def test_first_window_text_prompt_has_no_synthetic_box(monkeypatch, tmp_path):
    predictor = _FakePredictor()
    tracker = object.__new__(SAM3MultiplexVideoTracker)
    tracker.max_window_frames = 16
    tracker.active_sessions = 0
    tracker._predictor = predictor
    monkeypatch.setattr(tracker, "_extract_window_jpegs", lambda *_args: (100, 100, 16))
    monkeypatch.setattr(tracker, "_cleanup_tmp", MagicMock())

    tracker.propagate(str(tmp_path / "video.mp4"), 0, 15, "forward", "red car")

    add_prompt = next(r for r in predictor.requests if r["type"] == "add_prompt")
    assert "bounding_boxes" not in add_prompt
    assert "bounding_box_labels" not in add_prompt
