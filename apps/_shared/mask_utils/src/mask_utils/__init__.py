"""mask_utils — 共享 mask → polygon 工具。"""

from mask_utils.polygon import (
    MultiPolygonRing,
    mask_to_multi_polygon,
    mask_to_polygon,
)
from mask_utils.normalize import normalize_coords

__all__ = [
    "MultiPolygonRing",
    "mask_to_multi_polygon",
    "mask_to_polygon",
    "normalize_coords",
]
__version__ = "0.2.0"
