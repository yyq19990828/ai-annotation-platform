from __future__ import annotations

import json
from pathlib import Path

from app.services.mask_qc import (
    SingleFrameThresholds,
    TemporalResolvedFrame,
    analyze_rle_topology,
    compare_rles,
    compare_temporal_masks,
    derived_bbox_mismatch,
    evaluate_single_frame,
    scan_temporal_frames,
)
from app.services.mask_qc.morphology import morphology_rle
from app.utils.raster_mask_rle import encode_coco_rle

GOLDEN = json.loads(
    (Path(__file__).parent / "_fixtures/mask_qc_golden.json").read_text()
)


def _rle(rows: list[str]) -> dict:
    height = len(rows)
    width = len(rows[0])
    pixels = [1 if cell == "#" else 0 for row in rows for cell in row]
    return encode_coco_rle(pixels, width, height)


def _rectangle_rle(
    *, width: int, height: int, x0: int, y0: int, x1: int, y1: int
) -> dict:
    counts: list[int] = []
    foreground = False
    run_length = 0

    def emit(value: bool, length: int) -> None:
        nonlocal foreground, run_length
        if length <= 0:
            return
        if value == foreground:
            run_length += length
        else:
            counts.append(run_length)
            foreground = value
            run_length = length

    for x in range(width):
        if x0 <= x < x1:
            emit(False, y0)
            emit(True, y1 - y0)
            emit(False, height - y1)
        else:
            emit(False, height)
    counts.append(run_length)
    return {"encoding": "coco_rle", "size": [height, width], "counts": counts}


def test_topology_uses_foreground_8_and_background_4_connectivity() -> None:
    diagonal = analyze_rle_topology(_rle(["#.", ".#"]))
    assert diagonal.area_pixels == 2
    assert diagonal.component_count == 1
    assert diagonal.hole_count == 0

    diagonal_background = analyze_rle_topology(_rle(["###", "#.#", ".##"]))
    assert diagonal_background.hole_count == 1


def test_topology_reports_deterministic_components_holes_bbox_and_border() -> None:
    metrics = analyze_rle_topology(
        _rle(
            [
                "......",
                ".####.",
                ".#..#.",
                ".####.",
                "......",
                ".....#",
            ]
        )
    )
    assert metrics.area_pixels == 11
    assert metrics.bbox_pixels == (1, 1, 6, 6)
    assert metrics.component_count == 2
    assert metrics.hole_count == 1
    assert metrics.min_component_pixels == 1
    assert metrics.max_component_pixels == 10
    assert metrics.touches_border is True
    assert metrics.boundary_length_4 == 24
    assert metrics.materialized_dense_pixels == 0


def test_overlap_and_temporal_metrics_keep_integer_evidence() -> None:
    left = _rle([".....", ".###.", ".###.", "....."])
    right = _rle([".....", "..##.", "..##.", "....."])
    overlap = compare_rles(left, right)
    assert overlap.left_area_pixels == 6
    assert overlap.right_area_pixels == 4
    assert overlap.intersection_pixels == 4
    assert overlap.union_pixels == 6
    assert overlap.xor_pixels == 2
    assert analyze_rle_topology(overlap.intersection_rle).area_pixels == 4

    delta = compare_temporal_masks(left, right)
    assert delta.dice_numerator == 8
    assert delta.dice_denominator == 10
    assert delta.area_change_numerator == 2
    assert delta.area_change_denominator == 6


def test_component_union_crosses_512_seam_without_dense_decode() -> None:
    oracle = GOLDEN["kernel_oracles"]["tile_seam_512"]
    height, width = oracle["size"]
    x0, y0, x1, y1 = oracle["bbox_pixels"]
    metrics = analyze_rle_topology(
        _rectangle_rle(
            width=width,
            height=height,
            x0=x0,
            y0=y0,
            x1=x1,
            y1=y1,
        )
    )
    assert metrics.area_pixels == oracle["area_pixels"]
    assert metrics.component_count == oracle["component_count"]
    assert metrics.bbox_pixels == tuple(oracle["bbox_pixels"])
    assert metrics.materialized_dense_pixels == 0


def test_sparse_8192_square_path_never_materializes_dense_pixels() -> None:
    metrics = analyze_rle_topology(
        _rectangle_rle(
            width=8192,
            height=8192,
            x0=4095,
            y0=4095,
            x1=4097,
            y1=4097,
        )
    )
    assert metrics.area_pixels == 4
    assert metrics.component_count == 1
    assert metrics.materialized_dense_pixels == 0


def test_single_frame_threshold_edges_are_strict_and_regions_are_exact() -> None:
    fifteen = _rectangle_rle(width=10, height=10, x0=1, y0=1, x1=4, y1=6)
    sixteen = _rectangle_rle(width=10, height=10, x0=1, y0=1, x1=5, y1=5)
    thresholds = SingleFrameThresholds(
        near_empty_pixels=16,
        small_component_pixels=1,
        small_component_ratio_ppm=0,
        small_hole_pixels=1,
        narrow_bridge_width=1,
        boundary_noise_ratio_ppm=1_000_000,
    )
    assert "near_empty_mask" in {
        finding.code
        for finding in evaluate_single_frame(fifteen, thresholds=thresholds)
    }
    assert "near_empty_mask" not in {
        finding.code
        for finding in evaluate_single_frame(sixteen, thresholds=thresholds)
    }


def test_narrow_bridge_detects_connector_but_not_thin_single_object() -> None:
    oracle = GOLDEN["kernel_oracles"]["narrow_bridge"]
    bridge = _rle(oracle["rows"])
    thresholds = SingleFrameThresholds(
        near_empty_pixels=1,
        small_component_pixels=1,
        small_component_ratio_ppm=0,
        small_hole_pixels=1,
        narrow_bridge_width=oracle["width"],
        boundary_noise_ratio_ppm=1_000_000,
    )
    finding = next(
        item
        for item in evaluate_single_frame(bridge, thresholds=thresholds)
        if item.code == "narrow_bridge"
    )
    assert finding.region_rle is not None
    assert finding.metric["area_pixels"] == oracle["region_area_pixels"]

    thin = _rle(oracle["thin_object_false_positive_rows"])
    assert "narrow_bridge" not in {
        item.code for item in evaluate_single_frame(thin, thresholds=thresholds)
    }


def test_boundary_noise_keeps_integer_numerator_and_denominator() -> None:
    oracle = GOLDEN["kernel_oracles"]["boundary_noise"]
    noisy = _rle(oracle["rows"])
    thresholds = SingleFrameThresholds(
        near_empty_pixels=1,
        small_component_pixels=1,
        small_component_ratio_ppm=0,
        small_hole_pixels=1,
        narrow_bridge_width=1,
        boundary_noise_ratio_ppm=1,
    )
    finding = next(
        item
        for item in evaluate_single_frame(noisy, thresholds=thresholds)
        if item.code == "boundary_noise"
    )
    assert finding.metric["xor_pixels"] == oracle["xor_pixels"]
    assert finding.metric["boundary_length_4"] == oracle["boundary_length_4"]


def test_morphology_8k_is_tile_bounded() -> None:
    rle = _rectangle_rle(
        width=8192,
        height=8192,
        x0=4094,
        y0=4094,
        x1=4098,
        y1=4098,
    )
    result = morphology_rle(rle, operation="close_open", radius=1, tile_size=512)
    assert result.peak_materialized_pixels <= 520 * 520
    assert analyze_rle_topology(result.rle).materialized_dense_pixels == 0


def test_derived_bbox_mismatch_requires_explicit_snapshot() -> None:
    rle = _rectangle_rle(width=8, height=8, x0=2, y0=2, x1=6, y1=6)
    assert derived_bbox_mismatch(rle, derived_bbox_pixels=None) is None
    assert derived_bbox_mismatch(rle, derived_bbox_pixels=(2, 2, 6, 6)) is None
    mismatch = derived_bbox_mismatch(rle, derived_bbox_pixels=(0, 0, 2, 2))
    assert mismatch is not None
    assert mismatch.code == "derived_geometry_mismatch"


def test_temporal_flicker_requires_visible_frames_on_both_sides() -> None:
    mask = _rectangle_rle(width=20, height=20, x0=2, y0=2, x1=6, y1=6)
    findings = scan_temporal_frames(
        [
            TemporalResolvedFrame(0, "exact", "manual", mask, 0),
            TemporalResolvedFrame(1, "absent", "prediction", None),
            TemporalResolvedFrame(2, "absent", "prediction", None),
            TemporalResolvedFrame(3, "held", "manual", mask, 0),
            TemporalResolvedFrame(4, "absent", "prediction", None),
        ]
    )
    flicker = [finding for finding in findings if finding.code == "flicker"]
    assert [(finding.frame_start, finding.frame_end) for finding in flicker] == [(1, 2)]


def test_temporal_drift_requires_consecutive_frames_and_keeps_lineage() -> None:
    anchor = _rectangle_rle(width=100, height=100, x0=10, y0=10, x1=20, y1=20)
    frames = [TemporalResolvedFrame(0, "exact", "manual", anchor, 0)]
    for frame_index, offset in enumerate((20, 21, 22), start=1):
        frames.append(
            TemporalResolvedFrame(
                frame_index,
                "exact",
                "prediction",
                _rectangle_rle(
                    width=100,
                    height=100,
                    x0=offset,
                    y0=10,
                    x1=offset + 10,
                    y1=20,
                ),
                frame_index,
                confidence=0.8,
                correction_lineage={"issue_id": "issue-1"},
            )
        )
    drift = next(
        finding
        for finding in scan_temporal_frames(
            frames,
            drift_min_consecutive=3,
            centroid_shift_diagonal_ppm=10_000,
        )
        if finding.code == "drift"
    )
    assert (drift.frame_start, drift.frame_end, drift.anchor_frame) == (1, 3, 0)
    assert drift.source == "prediction"
    assert drift.confidence == 0.8
    assert drift.correction_lineage == {"issue_id": "issue-1"}
