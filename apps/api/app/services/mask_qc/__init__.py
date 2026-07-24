"""Pure, deterministic Raster Mask quality primitives."""

from app.services.mask_qc.contracts import (
    MaskComponent,
    MaskOverlapMetrics,
    MaskQCFinding,
    MaskTopologyMetrics,
    TemporalMaskDelta,
    TemporalQCFinding,
    TemporalResolvedFrame,
)
from app.services.mask_qc.temporal import compare_temporal_masks, scan_temporal_frames
from app.services.mask_qc.topology import analyze_rle_topology, compare_rles
from app.services.mask_qc.rules import (
    SingleFrameThresholds,
    derived_bbox_mismatch,
    evaluate_single_frame,
)

__all__ = [
    "MaskComponent",
    "MaskOverlapMetrics",
    "MaskQCFinding",
    "MaskTopologyMetrics",
    "TemporalMaskDelta",
    "TemporalQCFinding",
    "TemporalResolvedFrame",
    "SingleFrameThresholds",
    "analyze_rle_topology",
    "compare_rles",
    "compare_temporal_masks",
    "scan_temporal_frames",
    "derived_bbox_mismatch",
    "evaluate_single_frame",
]
