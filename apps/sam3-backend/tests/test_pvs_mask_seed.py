from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np
import pytest
import torch

from pvs_video_predictor import SAM3PVSVideoTracker


def _mask_prompt(*, height: int = 2, width: int = 3) -> dict:
    return {
        "rle": {
            "encoding": "coco_rle",
            "size": [height, width],
            "counts": [1, 2, 2, 1],
        },
        "source_annotation_id": "annotation-1",
        "source_version": 3,
        "source_digest": "a" * 64,
    }


def test_pvs_adds_exact_decoded_mask_seed() -> None:
    tracker = SAM3PVSVideoTracker.__new__(SAM3PVSVideoTracker)
    tracker._predictor = MagicMock()
    state = {"video_height": 2, "video_width": 3}

    added = tracker._add_prompt(
        state,
        frame_idx=4,
        obj_id=7,
        prompt={"mask_prompt": _mask_prompt()},
    )

    assert added is True
    kwargs = tracker._predictor.add_new_mask.call_args.kwargs
    assert kwargs["inference_state"] is state
    assert kwargs["frame_idx"] == 4
    assert kwargs["obj_id"] == 7
    assert kwargs["mask"].dtype == torch.bool
    assert kwargs["mask"].cpu().numpy().astype(np.uint8).tolist() == [
        [0, 1, 0],
        [1, 0, 1],
    ]


def test_pvs_rejects_mask_seed_with_wrong_frame_size() -> None:
    tracker = SAM3PVSVideoTracker.__new__(SAM3PVSVideoTracker)
    tracker._predictor = MagicMock()

    with pytest.raises(ValueError, match="must match video frame"):
        tracker._add_prompt(
            {"video_height": 4, "video_width": 3},
            frame_idx=0,
            obj_id=1,
            prompt={"mask_prompt": _mask_prompt()},
        )
    tracker._predictor.add_new_mask.assert_not_called()


def test_pvs_rejects_correction_frame_outside_window() -> None:
    tracker = SAM3PVSVideoTracker.__new__(SAM3PVSVideoTracker)
    tracker._predictor = MagicMock()

    with pytest.raises(ValueError, match="outside decoded window"):
        tracker._add_seed(
            {"video_height": 2, "video_width": 3},
            local_seed=0,
            seed={
                "obj_id": 1,
                "prompts": [
                    {"frame_index": 20, "mask_prompt": _mask_prompt()}
                ],
            },
            lo=10,
            local_count=4,
        )
    tracker._predictor.add_new_mask.assert_not_called()
