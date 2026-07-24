"""Video wrapper session counters and cleanup uncertainty."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

import pvs_video_predictor as pvs_module
import video_predictor as multiplex_module


@pytest.mark.parametrize(
    ("module", "tracker_type", "args"),
    [
        (
            multiplex_module,
            multiplex_module.SAM3MultiplexVideoTracker,
            ("video.mp4", 0, 1, "forward", "car"),
        ),
        (
            pvs_module,
            pvs_module.SAM3PVSVideoTracker,
            (
                "video.mp4",
                0,
                1,
                "forward",
                [{"obj_id": 1, "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}}],
            ),
        ),
    ],
)
def test_mkdtemp_failure_does_not_leak_active_session(
    monkeypatch,
    module,
    tracker_type,
    args,
) -> None:
    tracker = tracker_type.__new__(tracker_type)
    tracker.device = "cpu"
    tracker.max_window_frames = 16
    tracker.active_sessions = 0
    tracker._predictor = MagicMock()
    if tracker_type is multiplex_module.SAM3MultiplexVideoTracker:
        tracker.cleanup_uncertain = False
    monkeypatch.setattr(
        module.tempfile,
        "mkdtemp",
        MagicMock(side_effect=OSError("no temp space")),
    )

    with pytest.raises(OSError, match="no temp space"):
        tracker.propagate(*args)

    assert tracker.active_sessions == 0


def test_multiplex_close_failure_marks_cleanup_uncertain(
    monkeypatch,
    tmp_path,
) -> None:
    tracker = multiplex_module.SAM3MultiplexVideoTracker.__new__(
        multiplex_module.SAM3MultiplexVideoTracker
    )
    tracker.device = "cpu"
    tracker.max_window_frames = 16
    tracker.active_sessions = 0
    tracker.cleanup_uncertain = False
    predictor = MagicMock()

    def handle_request(request):
        if request["type"] == "start_session":
            return {"session_id": "s1"}
        if request["type"] == "add_prompt":
            return {"outputs": {}}
        raise RuntimeError("close failed")

    predictor.handle_request.side_effect = handle_request
    predictor.handle_stream_request.return_value = []
    tracker._predictor = predictor
    monkeypatch.setattr(
        multiplex_module.tempfile,
        "mkdtemp",
        lambda **_kwargs: str(tmp_path),
    )
    monkeypatch.setattr(
        tracker,
        "_extract_window_jpegs",
        lambda *_args: (1, 1, 1),
    )
    monkeypatch.setattr(tracker, "_pick_target_obj", lambda *_args: None)
    monkeypatch.setattr(tracker, "_cleanup_tmp", lambda *_args: None)
    monkeypatch.setattr(multiplex_module, "free_gpu_memory", lambda: None)

    assert tracker.propagate("video.mp4", 0, 0, "forward", "car") == []
    assert tracker.active_sessions == 0
    assert tracker.cleanup_uncertain is True


@pytest.mark.parametrize(
    "relative_path",
    [
        "sam3/model/sam3_tracking_predictor.py",
        "sam3/model/sam3_multiplex_video_predictor.py",
        "sam3/model/sam3_multiplex_base.py",
    ],
)
def test_vendor_does_not_keep_process_scoped_autocast(relative_path: str) -> None:
    vendor_root = Path(__file__).parents[1] / "vendor" / "sam3"
    source = (vendor_root / relative_path).read_text(encoding="utf-8")
    assert "bf16_context.__enter__()" not in source


@pytest.mark.parametrize(
    ("module", "tracker_type", "args"),
    [
        (
            multiplex_module,
            multiplex_module.SAM3MultiplexVideoTracker,
            ("video.mp4", 0, 1, "forward", "car"),
        ),
        (
            pvs_module,
            pvs_module.SAM3PVSVideoTracker,
            (
                "video.mp4",
                0,
                1,
                "forward",
                [{"obj_id": 1, "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}}],
            ),
        ),
    ],
)
def test_video_autocast_is_scoped_even_when_inference_fails(
    monkeypatch,
    module,
    tracker_type,
    args,
) -> None:
    events: list[str] = []

    class _Autocast:
        def __enter__(self):
            events.append("enter")

        def __exit__(self, *_args):
            events.append("exit")

    tracker = tracker_type.__new__(tracker_type)
    tracker.device = "cuda:0"
    monkeypatch.setattr(
        module.torch,
        "autocast",
        lambda **kwargs: (
            events.append(f"config:{kwargs['device_type']}:{kwargs['enabled']}")
            or _Autocast()
        ),
    )

    def fail(*_args, **_kwargs):
        raise RuntimeError("inference failed")

    monkeypatch.setattr(tracker, "_propagate", fail)
    with pytest.raises(RuntimeError, match="inference failed"):
        tracker.propagate(*args)

    assert events == ["config:cuda:True", "enter", "exit"]
