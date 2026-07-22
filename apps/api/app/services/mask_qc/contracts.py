from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

PixelBBox = tuple[int, int, int, int]
MaskFrameState = Literal["exact", "held", "absent", "outside", "occluded"]


@dataclass(frozen=True)
class MaskComponent:
    area_pixels: int
    bbox_pixels: PixelBBox
    touches_border: bool
    spans: tuple[tuple[int, int, int], ...]


@dataclass(frozen=True)
class MaskTopologyMetrics:
    width: int
    height: int
    area_pixels: int
    bbox_pixels: PixelBBox | None
    component_count: int
    hole_count: int
    min_component_pixels: int
    max_component_pixels: int
    touches_border: bool
    boundary_length_4: int
    foreground_components: tuple[MaskComponent, ...]
    holes: tuple[MaskComponent, ...]
    materialized_dense_pixels: int = 0


@dataclass(frozen=True)
class MaskOverlapMetrics:
    left_area_pixels: int
    right_area_pixels: int
    intersection_pixels: int
    union_pixels: int
    xor_pixels: int
    intersection_rle: dict

    @property
    def iou_numerator(self) -> int:
        return self.intersection_pixels

    @property
    def iou_denominator(self) -> int:
        return self.union_pixels


@dataclass(frozen=True)
class TemporalMaskDelta:
    intersection_pixels: int
    union_pixels: int
    xor_pixels: int
    dice_numerator: int
    dice_denominator: int
    area_change_numerator: int
    area_change_denominator: int
    centroid_shift_squared_numerator: int
    centroid_shift_squared_denominator: int


@dataclass(frozen=True)
class MaskQCFinding:
    code: str
    metric: dict[str, int]
    threshold: dict[str, int]
    region_rle: dict[str, Any] | None = None


@dataclass(frozen=True)
class MorphologyResult:
    rle: dict[str, Any]
    peak_materialized_pixels: int


@dataclass(frozen=True)
class TemporalResolvedFrame:
    frame_index: int
    state: MaskFrameState
    source: str | None
    mask: dict[str, Any] | None
    resolved_from_frame: int | None = None
    confidence: float | None = None
    correction_lineage: dict[str, Any] | None = None


@dataclass(frozen=True)
class TemporalQCFinding:
    code: str
    frame_start: int
    frame_end: int
    anchor_frame: int | None
    metric: dict[str, int]
    source: str | None
    confidence: float | None
    correction_lineage: dict[str, Any] | None
