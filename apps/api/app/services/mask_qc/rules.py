from __future__ import annotations

from dataclasses import dataclass

from app.services.mask_qc.contracts import MaskComponent, MaskQCFinding
from app.services.mask_qc.morphology import morphology_rle
from app.services.mask_qc.topology import (
    analyze_rle_topology,
    rle_and_not,
    rle_from_spans,
    rle_xor,
)
from app.utils.raster_mask_rle import coco_rle_area


@dataclass(frozen=True)
class SingleFrameThresholds:
    near_empty_pixels: int = 16
    small_component_pixels: int = 32
    small_component_ratio_ppm: int = 5_000
    small_hole_pixels: int = 32
    narrow_bridge_width: int = 2
    boundary_noise_ratio_ppm: int = 150_000


def _components_region(
    components: list[MaskComponent], *, width: int, height: int
) -> dict | None:
    spans = tuple(span for component in components for span in component.spans)
    return rle_from_spans(height=height, width=width, spans=spans) if spans else None


def _spans_adjacent(left: MaskComponent, right: MaskComponent) -> bool:
    if (
        left.bbox_pixels[2] + 1 < right.bbox_pixels[0]
        or right.bbox_pixels[2] + 1 < left.bbox_pixels[0]
        or left.bbox_pixels[3] + 1 < right.bbox_pixels[1]
        or right.bbox_pixels[3] + 1 < left.bbox_pixels[1]
    ):
        return False
    right_by_x: dict[int, list[tuple[int, int]]] = {}
    for x, start, end in right.spans:
        right_by_x.setdefault(x, []).append((start, end))
    for x, start, end in left.spans:
        for neighbor_x in (x - 1, x, x + 1):
            if any(
                other_end + 1 >= start and end + 1 >= other_start
                for other_start, other_end in right_by_x.get(neighbor_x, [])
            ):
                return True
    return False


def evaluate_single_frame(
    rle: dict, *, thresholds: SingleFrameThresholds = SingleFrameThresholds()
) -> tuple[MaskQCFinding, ...]:
    metrics = analyze_rle_topology(rle)
    findings: list[MaskQCFinding] = []
    if metrics.area_pixels == 0:
        findings.append(
            MaskQCFinding(code="empty_mask", metric={"area_pixels": 0}, threshold={})
        )
        return tuple(findings)
    if metrics.area_pixels < thresholds.near_empty_pixels:
        findings.append(
            MaskQCFinding(
                code="near_empty_mask",
                metric={"area_pixels": metrics.area_pixels},
                threshold={"near_empty_pixels": thresholds.near_empty_pixels},
            )
        )
    if metrics.touches_border:
        border_components = [
            component
            for component in metrics.foreground_components
            if component.touches_border
        ]
        findings.append(
            MaskQCFinding(
                code="touches_border",
                metric={"component_count": len(border_components)},
                threshold={},
                region_rle=_components_region(
                    border_components, width=metrics.width, height=metrics.height
                ),
            )
        )
    small_components = [
        component
        for component in metrics.foreground_components
        if component.area_pixels < thresholds.small_component_pixels
        or component.area_pixels * 1_000_000
        < metrics.area_pixels * thresholds.small_component_ratio_ppm
    ]
    if small_components:
        findings.append(
            MaskQCFinding(
                code="small_island",
                metric={
                    "component_count": len(small_components),
                    "area_pixels": sum(item.area_pixels for item in small_components),
                },
                threshold={
                    "small_component_pixels": thresholds.small_component_pixels,
                    "small_component_ratio_ppm": thresholds.small_component_ratio_ppm,
                },
                region_rle=_components_region(
                    small_components, width=metrics.width, height=metrics.height
                ),
            )
        )
    small_holes = [
        component
        for component in metrics.holes
        if component.area_pixels < thresholds.small_hole_pixels
    ]
    if small_holes:
        findings.append(
            MaskQCFinding(
                code="small_hole",
                metric={
                    "hole_count": len(small_holes),
                    "area_pixels": sum(item.area_pixels for item in small_holes),
                },
                threshold={"small_hole_pixels": thresholds.small_hole_pixels},
                region_rle=_components_region(
                    small_holes, width=metrics.width, height=metrics.height
                ),
            )
        )

    eroded = morphology_rle(
        rle, operation="erode", radius=thresholds.narrow_bridge_width
    )
    eroded_metrics = analyze_rle_topology(eroded.rle)
    if eroded_metrics.component_count >= 2:
        removed = analyze_rle_topology(rle_and_not(rle, eroded.rle))
        bridge_components = [
            component
            for component in removed.foreground_components
            if sum(
                _spans_adjacent(component, core)
                for core in eroded_metrics.foreground_components
            )
            >= 2
        ]
        if bridge_components:
            findings.append(
                MaskQCFinding(
                    code="narrow_bridge",
                    metric={
                        "area_pixels": sum(
                            item.area_pixels for item in bridge_components
                        )
                    },
                    threshold={"narrow_bridge_width": thresholds.narrow_bridge_width},
                    region_rle=_components_region(
                        bridge_components, width=metrics.width, height=metrics.height
                    ),
                )
            )

    smoothed = morphology_rle(rle, operation="close_open", radius=1)
    boundary_xor_pixels = coco_rle_area(rle_xor(rle, smoothed.rle))
    if (
        metrics.boundary_length_4
        and boundary_xor_pixels * 1_000_000
        > metrics.boundary_length_4 * thresholds.boundary_noise_ratio_ppm
    ):
        findings.append(
            MaskQCFinding(
                code="boundary_noise",
                metric={
                    "xor_pixels": boundary_xor_pixels,
                    "boundary_length_4": metrics.boundary_length_4,
                },
                threshold={
                    "boundary_noise_ratio_ppm": thresholds.boundary_noise_ratio_ppm
                },
                region_rle=rle_xor(rle, smoothed.rle),
            )
        )
    return tuple(sorted(findings, key=lambda finding: finding.code))


def derived_bbox_mismatch(
    rle: dict,
    *,
    derived_bbox_pixels: tuple[int, int, int, int] | None,
    iou_min_ppm: int = 980_000,
) -> MaskQCFinding | None:
    """Compare only an explicitly supplied derived bbox; never invent one."""

    mask_bbox = analyze_rle_topology(rle).bbox_pixels
    if mask_bbox is None or derived_bbox_pixels is None:
        return None
    left = max(mask_bbox[0], derived_bbox_pixels[0])
    top = max(mask_bbox[1], derived_bbox_pixels[1])
    right = min(mask_bbox[2], derived_bbox_pixels[2])
    bottom = min(mask_bbox[3], derived_bbox_pixels[3])
    intersection = max(0, right - left) * max(0, bottom - top)
    mask_area = (mask_bbox[2] - mask_bbox[0]) * (mask_bbox[3] - mask_bbox[1])
    derived_area = (derived_bbox_pixels[2] - derived_bbox_pixels[0]) * (
        derived_bbox_pixels[3] - derived_bbox_pixels[1]
    )
    union = mask_area + derived_area - intersection
    if union and intersection * 1_000_000 >= union * iou_min_ppm:
        return None
    return MaskQCFinding(
        code="derived_geometry_mismatch",
        metric={"iou_numerator": intersection, "iou_denominator": union},
        threshold={"bbox_iou_min_ppm": iou_min_ppm},
    )
