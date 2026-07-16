"""mask_utils — 共享 mask → polygon 工具。"""

from mask_utils.polygon import (
    MultiPolygonRing,
    mask_to_multi_polygon,
    mask_to_polygon,
)
from mask_utils.normalize import normalize_coords
from mask_utils.rle import decode_coco_rle, encode_coco_rle, validate_coco_rle

__all__ = [
    "MultiPolygonRing",
    "mask_to_multi_polygon",
    "mask_to_polygon",
    "normalize_coords",
    "decode_coco_rle",
    "encode_coco_rle",
    "validate_coco_rle",
]
__version__ = "0.2.0"
