import sys
import types

import numpy as np

# torch is supplied by the CUDA base image in production, not by the lightweight
# local test environment.  The exercised static codec path only needs the module
# import to succeed.
if "torch" not in sys.modules:
    torch_stub = types.ModuleType("torch")
    torch_stub.cuda = types.SimpleNamespace(is_available=lambda: False)
    sys.modules["torch"] = torch_stub

from video_predictor import SAM3MultiplexVideoTracker


def test_multiplex_and_pvs_shared_mask_geometry_preserves_raw_pixels():
    mask = np.array([[False, True, False], [True, False, True]], dtype=bool)
    geometry, outside = SAM3MultiplexVideoTracker._mask_geometry(mask, "mask")
    assert outside is False
    assert geometry == {
        "type": "mask",
        "rle": {"encoding": "coco_rle", "size": [2, 3], "counts": [1, 2, 2, 1]},
    }


def test_mask_geometry_allows_empty_mask_as_outside():
    geometry, outside = SAM3MultiplexVideoTracker._mask_geometry(
        np.zeros((2, 3), dtype=bool), "mask"
    )
    assert outside is True
    assert geometry["rle"]["counts"] == [6]
