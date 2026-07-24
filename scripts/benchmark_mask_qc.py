#!/usr/bin/env python3
"""Deterministic Mask QC, temporal, and format-consumer baseline.

Run with the existing API environment so NumPy, Pillow, and pycocotools stay
identical to production/test consumers. All format packages are created under a
temporary directory and removed before this process exits.
"""

from __future__ import annotations

import argparse
import contextlib
import gc
import hashlib
import io
import json
import platform
import resource
import subprocess
import sys
import tempfile
import time
from collections import deque
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from pycocotools import mask as coco_mask
from pycocotools.coco import COCO


ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "apps/api"
FIXTURE_PATH = API_ROOT / "tests/_fixtures/mask_qc_golden.json"
DEFAULT_OUTPUT = ROOT / "docs/research/data/20-mask-qc-format-baseline.json"
sys.path.insert(0, str(API_ROOT))

from app.services.mask_conversion import analyze_mask  # noqa: E402
from app.utils.raster_mask_rle import (  # noqa: E402
    decode_coco_rle,
    encode_coco_rle,
    validate_coco_rle,
)


RESOLUTIONS = {
    "1080p": (1920, 1080),
    "4k": (3840, 2160),
    "8k_square": (8192, 8192),
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()


def sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def load_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text())


def rows_to_mask(rows: list[str]) -> np.ndarray:
    if not rows:
        raise AssertionError("golden rows must be a non-empty rectangle")
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise AssertionError("golden rows must be a non-empty rectangle")
    if any(set(row) - {".", "#"} for row in rows):
        raise AssertionError("golden rows only accept '.' and '#'")
    return np.asarray([[cell == "#" for cell in row] for row in rows], dtype=np.uint8)


def connected_components(mask: np.ndarray, connectivity: int) -> list[int]:
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=np.uint8)
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if connectivity == 8:
        directions += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    areas: list[int] = []
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or seen[y, x]:
                continue
            queue = deque([(x, y)])
            seen[y, x] = 1
            area = 0
            while queue:
                current_x, current_y = queue.popleft()
                area += 1
                for dx, dy in directions:
                    next_x, next_y = current_x + dx, current_y + dy
                    if (
                        0 <= next_x < width
                        and 0 <= next_y < height
                        and mask[next_y, next_x]
                        and not seen[next_y, next_x]
                    ):
                        seen[next_y, next_x] = 1
                        queue.append((next_x, next_y))
            areas.append(area)
    return areas


def hole_count(mask: np.ndarray) -> int:
    background = 1 - mask
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=np.uint8)
    holes = 0
    for y in range(height):
        for x in range(width):
            if not background[y, x] or seen[y, x]:
                continue
            queue = deque([(x, y)])
            seen[y, x] = 1
            touches_border = False
            while queue:
                current_x, current_y = queue.popleft()
                touches_border |= current_x in {0, width - 1} or current_y in {
                    0,
                    height - 1,
                }
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    next_x, next_y = current_x + dx, current_y + dy
                    if (
                        0 <= next_x < width
                        and 0 <= next_y < height
                        and background[next_y, next_x]
                        and not seen[next_y, next_x]
                    ):
                        seen[next_y, next_x] = 1
                        queue.append((next_x, next_y))
            if not touches_border:
                holes += 1
    return holes


def reference_metrics(mask: np.ndarray) -> dict[str, Any]:
    height, width = mask.shape
    ys, xs = np.nonzero(mask)
    areas = connected_components(mask, connectivity=8)
    return {
        "area_pixels": int(mask.sum()),
        "component_count": len(areas),
        "hole_count": hole_count(mask),
        "min_component_pixels": min(areas, default=0),
        "max_component_pixels": max(areas, default=0),
        "bbox_pixels": None
        if len(xs) == 0
        else [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)],
        "touches_border": bool(
            len(xs)
            and (
                np.any(xs == 0)
                or np.any(xs == width - 1)
                or np.any(ys == 0)
                or np.any(ys == height - 1)
            )
        ),
    }


def verify_golden(fixture: dict[str, Any]) -> dict[str, Any]:
    case_digests: dict[str, str] = {}
    for case in fixture["single_frame"]:
        actual = reference_metrics(rows_to_mask(case["rows"]))
        if actual != case["expected"]:
            raise AssertionError(f"golden mismatch for {case['id']}: {actual}")
        case_digests[case["id"]] = sha256({"rows": case["rows"], "metrics": actual})

    overlap = fixture["overlap"]
    left = rows_to_mask(overlap["left_rows"]).astype(bool)
    right = rows_to_mask(overlap["right_rows"]).astype(bool)
    intersection = int(np.logical_and(left, right).sum())
    union = int(np.logical_or(left, right).sum())
    actual_overlap = {
        "left_area_pixels": int(left.sum()),
        "right_area_pixels": int(right.sum()),
        "intersection_pixels": intersection,
        "union_pixels": union,
        "iou_numerator": intersection,
        "iou_denominator": union,
        "left_containment_numerator": intersection,
        "left_containment_denominator": int(left.sum()),
    }
    if actual_overlap != overlap["expected"]:
        raise AssertionError(f"overlap golden mismatch: {actual_overlap}")
    return {"cases": case_digests, "overlap_sha256": sha256(actual_overlap)}


def current_analyzer_contract_gap(fixture: dict[str, Any]) -> dict[str, Any]:
    case = next(
        item
        for item in fixture["single_frame"]
        if item["id"] == "diagonal_foreground_is_connected"
    )
    mask = rows_to_mask(case["rows"])
    height, width = mask.shape
    stats = analyze_mask(encode_coco_rle(mask.ravel().tolist(), width, height))
    return {
        "case_id": case["id"],
        "current_analyzer": {
            "foreground_connectivity": 4,
            "component_count": stats.components,
        },
        "frozen_contract": {
            "foreground_connectivity": fixture["pixel_contract"][
                "foreground_connectivity"
            ],
            "component_count": case["expected"]["component_count"],
        },
        "matches_frozen_contract": stats.components
        == case["expected"]["component_count"],
    }


def in_ranges(frame: int, ranges: list[list[int]]) -> bool:
    return any(start <= frame <= end for start, end in ranges)


def temporal_records(spec: dict[str, Any]) -> list[list[Any]]:
    frame_count = spec["frame_count"]
    records: list[list[Any]] = []
    track_index = 0
    for profile in spec["profiles"]:
        for _ in range(profile["copies"]):
            track_id = f"track-{track_index:02d}"
            base_x = round(0.08 + track_index * 0.012, 6)
            last_exact = None
            for frame in range(frame_count):
                if in_ranges(frame, profile.get("outside_ranges", [])):
                    state, source, bounds = "outside", None, None
                elif in_ranges(frame, profile.get("occluded_ranges", [])):
                    state, source, bounds = "occluded", "manual", None
                elif in_ranges(frame, profile.get("absent_ranges", [])):
                    state, source, bounds = "absent", "prediction", None
                else:
                    exact_frames = profile.get("exact_frames")
                    if exact_frames is not None and frame not in exact_frames:
                        state, source = "held", "manual"
                    else:
                        state = "exact"
                        source = (
                            "prediction"
                            if profile["id"]
                            in {
                                "two_frame_flicker",
                                "prediction_drift",
                            }
                            else "manual"
                        )
                        last_exact = frame
                    shift = [0.0, 0.0]
                    if (
                        profile["id"] == "prediction_drift"
                        and frame >= profile["drift_from_frame"]
                    ):
                        delta = frame - profile["drift_from_frame"] + 1
                        shift = [
                            profile["centroid_shift_per_frame"][0] * delta,
                            profile["centroid_shift_per_frame"][1] * delta,
                        ]
                    bounds = [
                        round(base_x + shift[0], 6),
                        round(0.2 + shift[1], 6),
                        0.1,
                        0.08,
                    ]
                records.append([track_id, frame, state, source, last_exact, bounds])
            track_index += 1
    return records


def verify_temporal(fixture: dict[str, Any]) -> dict[str, Any]:
    spec = fixture["temporal_300"]
    records = temporal_records(spec)
    state_counts: dict[str, int] = {}
    for record in records:
        state_counts[record[2]] = state_counts.get(record[2], 0) + 1
    digest = sha256(records)
    expected = spec["expected"]
    if (
        len(records) != expected["record_count"]
        or state_counts != expected["state_counts"]
    ):
        raise AssertionError("temporal foundation count mismatch")
    expected_digest = expected["records_sha256"]
    if expected_digest != "TO_BE_GENERATED" and digest != expected_digest:
        raise AssertionError(f"temporal foundation digest mismatch: {digest}")
    return {
        "frame_count": spec["frame_count"],
        "track_count": spec["track_count"],
        "record_count": len(records),
        "state_counts": state_counts,
        "records_sha256": digest,
    }


def emit_run(counts: list[int], state: list[int], value: int, length: int) -> None:
    if length <= 0:
        return
    current_value, current_length = state
    if value == current_value:
        state[1] = current_length + length
        return
    counts.append(current_length)
    state[0] = value
    state[1] = length


def sparse_rle(width: int, height: int) -> dict[str, Any]:
    outer_x = (width // 10, width * 3 // 10)
    outer_y = (height // 5, height * 2 // 5)
    hole_x = (width * 16 // 100, width * 22 // 100)
    hole_y = (height * 26 // 100, height * 34 // 100)
    island_x = (width * 75 // 100, width * 77 // 100)
    island_y = (height * 70 // 100, height * 72 // 100)
    counts: list[int] = []
    state = [0, 0]
    for x in range(width):
        intervals: list[tuple[int, int]] = []
        if outer_x[0] <= x < outer_x[1]:
            if hole_x[0] <= x < hole_x[1]:
                intervals.extend([(outer_y[0], hole_y[0]), (hole_y[1], outer_y[1])])
            else:
                intervals.append(outer_y)
        if island_x[0] <= x < island_x[1]:
            intervals.append(island_y)
        cursor = 0
        for start, end in intervals:
            emit_run(counts, state, 0, start - cursor)
            emit_run(counts, state, 1, end - start)
            cursor = end
        emit_run(counts, state, 0, height - cursor)
    counts.append(state[1])
    return {"encoding": "coco_rle", "size": [height, width], "counts": counts}


def max_rss_bytes() -> int:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(rss if sys.platform == "darwin" else rss * 1024)


def benchmark_dense(rounds: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for label, (width, height) in RESOLUTIONS.items():
        rle = sparse_rle(width, height)
        validate_coco_rle(rle)
        expected_area = sum(rle["counts"][1::2])
        timings: list[float] = []
        stats = None
        for _ in range(rounds):
            gc.collect()
            started = time.perf_counter()
            stats = analyze_mask(rle)
            timings.append((time.perf_counter() - started) * 1000)
        if stats is None or stats.area != expected_area:
            raise AssertionError(f"dense analyzer area mismatch for {label}")
        results.append(
            {
                "resolution": label,
                "width": width,
                "height": height,
                "pixels": width * height,
                "dense_alpha_bytes": width * height,
                "rle_runs": len(rle["counts"]),
                "rle_json_bytes": len(canonical_bytes(rle)),
                "area_pixels": stats.area,
                "component_count_current": stats.components,
                "hole_count_current": stats.holes,
                "round_ms": [round(value, 3) for value in timings],
                "p50_ms": round(float(np.percentile(timings, 50)), 3),
                "p95_ms": round(float(np.percentile(timings, 95)), 3),
                "process_peak_rss_bytes_after": max_rss_bytes(),
            }
        )
    return results


def verify_format_consumers(fixture: dict[str, Any]) -> dict[str, Any]:
    spec = fixture["format_consumer"]
    mask = rows_to_mask(spec["rows"])
    height, width = mask.shape
    if int(mask.sum()) != spec["expected_area_pixels"]:
        raise AssertionError("format fixture area mismatch")
    encoded = encode_coco_rle(mask.ravel().tolist(), width, height)
    if not np.array_equal(
        np.asarray(decode_coco_rle(encoded)).reshape(height, width), mask
    ):
        raise AssertionError("AAP RLE consumer mismatch")
    compressed = coco_mask.encode(np.asfortranarray(mask.astype(np.uint8)))
    compressed_counts = compressed["counts"].decode("ascii")
    checks: dict[str, Any] = {"aap_json": {"pixels": int(mask.sum()), "pass": True}}

    with tempfile.TemporaryDirectory(prefix="mask-qc-consumer-") as directory:
        root = Path(directory)
        coco_document = {
            "images": [
                {"id": 1, "file_name": "image.png", "width": width, "height": height}
            ],
            "categories": [{"id": spec["class_id"], "name": "golden"}],
            "annotations": [
                {
                    "id": 1,
                    "image_id": 1,
                    "category_id": spec["class_id"],
                    "segmentation": {
                        "size": [height, width],
                        "counts": compressed_counts,
                    },
                    "area": int(mask.sum()),
                    "bbox": [1, 1, 6, 4],
                    "iscrowd": 1,
                }
            ],
        }
        coco_path = root / "coco.json"
        coco_path.write_text(json.dumps(coco_document, separators=(",", ":")))
        with contextlib.redirect_stdout(io.StringIO()):
            coco = COCO(str(coco_path))
        decoded_coco = coco.annToMask(coco.anns[1]).astype(np.uint8)
        if not np.array_equal(decoded_coco, mask):
            raise AssertionError("pycocotools COCO consumer mismatch")
        checks["coco_instance"] = {"pixels": int(decoded_coco.sum()), "pass": True}

        binary_path = root / "binary.png"
        Image.fromarray(mask * 255, mode="L").save(binary_path)
        binary = np.asarray(Image.open(binary_path).convert("L")) > 0
        if not np.array_equal(binary, mask.astype(bool)):
            raise AssertionError("Pillow binary PNG consumer mismatch")
        checks["binary_png"] = {"mode": "L", "pixels": int(binary.sum()), "pass": True}

        indexed_pixels = mask * spec["instance_id"]
        indexed_path = root / "indexed.png"
        indexed = Image.fromarray(indexed_pixels.astype(np.uint8), mode="P")
        indexed.putpalette(
            [value for index in range(256) for value in (index, index, index)]
        )
        indexed.save(indexed_path)
        loaded_indexed = Image.open(indexed_path)
        indexed_array = np.asarray(loaded_indexed)
        if loaded_indexed.mode != "P" or not np.array_equal(
            indexed_array, indexed_pixels
        ):
            raise AssertionError("Pillow indexed PNG consumer mismatch")
        checks["indexed_png_davis"] = {
            "mode": loaded_indexed.mode,
            "instance_ids": sorted(int(value) for value in np.unique(indexed_array)),
            "pass": True,
        }

        mots_line = (
            f"{spec['frame_index']} {spec['track_id']} {spec['class_id']} "
            f"{height} {width} {compressed_counts}"
        )
        parts = mots_line.split(" ", 5)
        decoded_mots = coco_mask.decode(
            {
                "size": [int(parts[3]), int(parts[4])],
                "counts": parts[5].encode("ascii"),
            }
        ).astype(np.uint8)
        if not np.array_equal(decoded_mots, mask):
            raise AssertionError("pycocotools MOTS consumer mismatch")
        checks["mots"] = {
            "frame_index": int(parts[0]),
            "track_id": int(parts[1]),
            "class_id": int(parts[2]),
            "pixels": int(decoded_mots.sum()),
            "pass": True,
        }
    return {
        "fixture_sha256": sha256(spec),
        "checks": checks,
        "temporary_artifacts_retained": 0,
    }


def environment() -> dict[str, Any]:
    return {
        "git_sha": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pillow": Image.__version__,
        "platform": platform.platform(),
        "cpu": platform.processor() or platform.machine(),
    }


def run(rounds: int, skip_dense: bool) -> dict[str, Any]:
    fixture = load_fixture()
    return {
        "schema_version": 1,
        "environment": environment(),
        "fixture": {
            "path": str(FIXTURE_PATH.relative_to(ROOT)),
            "sha256": sha256(fixture),
            "golden": verify_golden(fixture),
        },
        "current_analyzer_contract_gap": current_analyzer_contract_gap(fixture),
        "dense_analyze": [] if skip_dense else benchmark_dense(rounds),
        "temporal_foundation": verify_temporal(fixture),
        "format_consumers": verify_format_consumers(fixture),
        "loss_codes": fixture["loss_codes"],
        "method": {
            "rounds": rounds,
            "dense_analyzer": "app.services.mask_conversion.analyze_mask",
            "large_mask_shape": "deterministic sparse donut plus detached island",
            "timing": "perf_counter wall time; p50/p95 over recorded rounds",
            "cleanup": "TemporaryDirectory removes all consumer packages before exit",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--skip-dense", action="store_true")
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("--rounds must be >= 1")
    result = run(args.rounds, args.skip_dense)
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "json": str(args.json),
                "fixture_sha256": result["fixture"]["sha256"],
                "temporal_sha256": result["temporal_foundation"]["records_sha256"],
                "consumers_pass": all(
                    item["pass"]
                    for item in result["format_consumers"]["checks"].values()
                ),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
