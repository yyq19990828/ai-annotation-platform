import numpy as np

from mask_utils import mask_to_preview_polygon


def test_preview_polygon_uses_simplified_primary_outline():
    mask = np.zeros((8, 10), dtype=np.uint8)
    mask[2:6, 3:8] = 1

    points = mask_to_preview_polygon(mask, normalize_to=(10, 8))

    assert len(points) == 4
    assert min(point[0] for point in points) == 0.3
    assert max(point[0] for point in points) == 0.7
    assert min(point[1] for point in points) == 0.25
    assert max(point[1] for point in points) == 0.625


def test_preview_polygon_falls_back_for_single_pixel_masks():
    mask = np.zeros((4, 5), dtype=np.uint8)
    mask[2, 3] = 1

    assert mask_to_preview_polygon(mask, normalize_to=(5, 4)) == [
        [0.6, 0.5],
        [0.8, 0.5],
        [0.8, 0.75],
        [0.6, 0.75],
    ]
