from __future__ import annotations

from app.services.mask_qc.contracts import (
    TemporalMaskDelta,
    TemporalQCFinding,
    TemporalResolvedFrame,
)
from app.services.mask_qc.topology import analyze_rle_topology, compare_rles


def _centroid_moments(rle: dict) -> tuple[int, int, int]:
    metrics = analyze_rle_topology(rle)
    x_sum = y_sum = 0
    for component in metrics.foreground_components:
        for x, start, end in component.spans:
            length = end - start + 1
            x_sum += x * length
            y_sum += (start + end) * length // 2
    return metrics.area_pixels, x_sum, y_sum


def compare_temporal_masks(before: dict, after: dict) -> TemporalMaskDelta:
    overlap = compare_rles(before, after)
    before_area, before_x, before_y = _centroid_moments(before)
    after_area, after_x, after_y = _centroid_moments(after)
    if before_area and after_area:
        delta_x = after_x * before_area - before_x * after_area
        delta_y = after_y * before_area - before_y * after_area
        centroid_numerator = delta_x * delta_x + delta_y * delta_y
        centroid_denominator = (before_area * after_area) ** 2
    else:
        centroid_numerator = 0
        centroid_denominator = 0
    return TemporalMaskDelta(
        intersection_pixels=overlap.intersection_pixels,
        union_pixels=overlap.union_pixels,
        xor_pixels=overlap.xor_pixels,
        dice_numerator=2 * overlap.intersection_pixels,
        dice_denominator=before_area + after_area,
        area_change_numerator=abs(after_area - before_area),
        area_change_denominator=max(before_area, 1),
        centroid_shift_squared_numerator=centroid_numerator,
        centroid_shift_squared_denominator=centroid_denominator,
    )


def scan_temporal_frames(
    frames: list[TemporalResolvedFrame],
    *,
    flicker_max_frames: int = 2,
    drift_min_consecutive: int = 3,
    centroid_shift_diagonal_ppm: int = 150_000,
) -> tuple[TemporalQCFinding, ...]:
    """Find bounded absent flicker and prediction drift from a frozen sequence."""

    ordered = sorted(frames, key=lambda frame: frame.frame_index)
    findings: list[TemporalQCFinding] = []
    index = 0
    while index < len(ordered):
        if ordered[index].state != "absent":
            index += 1
            continue
        end = index
        while end + 1 < len(ordered) and ordered[end + 1].state == "absent":
            end += 1
        previous = ordered[index - 1] if index else None
        following = ordered[end + 1] if end + 1 < len(ordered) else None
        if (
            end - index + 1 <= flicker_max_frames
            and previous is not None
            and following is not None
            and previous.state in {"exact", "held"}
            and following.state in {"exact", "held"}
        ):
            findings.append(
                TemporalQCFinding(
                    code="flicker",
                    frame_start=ordered[index].frame_index,
                    frame_end=ordered[end].frame_index,
                    anchor_frame=previous.resolved_from_frame,
                    metric={"absent_frames": end - index + 1},
                    source="prediction",
                    confidence=None,
                    correction_lineage=None,
                )
            )
        index = end + 1

    anchor: TemporalResolvedFrame | None = None
    drift_run: list[tuple[TemporalResolvedFrame, TemporalMaskDelta]] = []

    def flush_drift() -> None:
        if anchor is None or len(drift_run) < drift_min_consecutive:
            drift_run.clear()
            return
        final_frame, final_delta = drift_run[-1]
        findings.append(
            TemporalQCFinding(
                code="drift",
                frame_start=drift_run[0][0].frame_index,
                frame_end=final_frame.frame_index,
                anchor_frame=anchor.frame_index,
                metric={
                    "consecutive_frames": len(drift_run),
                    "centroid_shift_squared_numerator": (
                        final_delta.centroid_shift_squared_numerator
                    ),
                    "centroid_shift_squared_denominator": (
                        final_delta.centroid_shift_squared_denominator
                    ),
                },
                source=final_frame.source,
                confidence=final_frame.confidence,
                correction_lineage=final_frame.correction_lineage,
            )
        )
        drift_run.clear()

    threshold_squared = centroid_shift_diagonal_ppm**2
    for frame in ordered:
        if frame.state in {"outside", "occluded", "absent"} or frame.mask is None:
            flush_drift()
            continue
        if frame.state == "exact" and frame.source == "manual":
            flush_drift()
            anchor = frame
            continue
        if anchor is None:
            continue
        if (
            frame.state == "held"
            and frame.resolved_from_frame == anchor.resolved_from_frame
            and frame.mask == anchor.mask
        ):
            drift_run.clear()
            continue
        delta = compare_temporal_masks(anchor.mask, frame.mask)
        topology = analyze_rle_topology(anchor.mask)
        diagonal_squared = topology.width**2 + topology.height**2
        exceeds = (
            delta.centroid_shift_squared_denominator > 0
            and delta.centroid_shift_squared_numerator * 1_000_000**2
            > delta.centroid_shift_squared_denominator
            * diagonal_squared
            * threshold_squared
        )
        if exceeds:
            drift_run.append((frame, delta))
        else:
            flush_drift()
    flush_drift()
    return tuple(
        sorted(findings, key=lambda finding: (finding.frame_start, finding.code))
    )
