import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cocoRleArea,
  cocoRleBounds,
  validateCocoRle,
} from "../../../src/pages/Workbench/stage/shared/geometry/maskRle.ts";
import {
  tightenBboxFromPolygon,
  type NormBbox,
} from "../../../src/pages/Workbench/stage/shared/geometry/bbox.ts";
import { simplifyPolygon } from "../../../src/pages/Workbench/stage/shared/geometry/simplify.ts";

type Point = [number, number];
type SavedGeometry =
  | ({ type: "bbox" } & NormBbox)
  | { type: "polygon"; points: Point[] }
  | { type: "raster_mask"; mask: { sha256: string; size: [number, number] } };

export interface SamRecordingCandidate {
  /** Index in the unfiltered transport result, for selecting the actual UI candidate. */
  index: number;
  type: "mask" | "rectanglelabels" | "polygonlabels";
  bbox: NormBbox;
  /** Foreground area as a fraction of the image, comparable across geometry types. */
  area: number;
  pixel_area?: number;
  digest: string;
  candidate_id?: string;
  iou: number;
  /** Expected persisted geometry, including the frontend's polygon simplification. */
  geometry: SavedGeometry;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function normalized(value: unknown): number {
  assert.ok(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
  return value;
}

function validBbox(bbox: NormBbox): NormBbox {
  Object.values(bbox).forEach(normalized);
  assert.ok(bbox.w > 0 && bbox.h > 0 && bbox.x + bbox.w <= 1 + 1e-9 && bbox.y + bbox.h <= 1 + 1e-9);
  return bbox;
}

function ring(value: unknown): Point[] {
  assert.ok(Array.isArray(value) && value.length >= 3);
  return value.map((point) => {
    assert.ok(Array.isArray(point) && point.length === 2);
    return [normalized(point[0]), normalized(point[1])];
  });
}

function ringArea(points: Point[]): number {
  return (
    Math.abs(
      points.reduce((sum, [x, y], index) => {
        const next = points[(index + 1) % points.length];
        return sum + x * next[1] - next[0] * y;
      }, 0),
    ) / 2
  );
}

function inspectCandidate(raw: unknown, index: number): Omit<SamRecordingCandidate, "iou"> {
  const candidate = record(raw);
  const value = record(candidate.value);
  if (candidate.type === "mask") {
    const rle = validateCocoRle(value.rle);
    const bbox = cocoRleBounds(rle);
    assert.ok(bbox, "The native Mask must contain foreground pixels");
    const pixel_area = cocoRleArea(rle);
    const sha256 = digest(rle);
    return {
      index,
      type: "mask",
      bbox,
      area: pixel_area / (rle.size[0] * rle.size[1]),
      pixel_area,
      digest: sha256,
      ...(typeof candidate.candidate_id === "string"
        ? { candidate_id: candidate.candidate_id }
        : {}),
      geometry: { type: "raster_mask", mask: { sha256, size: rle.size } },
    };
  }
  if (candidate.type === "rectanglelabels") {
    const bbox = validBbox({
      x: normalized(value.x),
      y: normalized(value.y),
      w: normalized(value.width),
      h: normalized(value.height),
    });
    const geometry = { type: "bbox" as const, ...bbox };
    return {
      index,
      type: "rectanglelabels",
      bbox,
      area: bbox.w * bbox.h,
      digest: digest(geometry),
      geometry,
    };
  }
  assert.equal(candidate.type, "polygonlabels", "Unsupported recording candidate type");
  // Match useInteractiveAI: single ring first, otherwise the largest component's outer ring.
  const rings =
    Array.isArray(value.points) && value.points.length >= 3
      ? [ring(value.points)]
      : (Array.isArray(value.polygons) ? value.polygons : []).map((polygon) =>
          ring(record(polygon).points),
        );
  const points = rings.sort((a, b) => ringArea(b) - ringArea(a))[0];
  assert.ok(points && ringArea(points) > 0, "The polygon must enclose nonzero area");
  const bbox = tightenBboxFromPolygon(points);
  assert.ok(bbox);
  // Same relative tolerance as useInteractiveAI.SAM_SIMPLIFY_RATIO, without importing React/API state.
  const simplified =
    points.length < 4
      ? points
      : (simplifyPolygon(points, Math.hypot(bbox.w, bbox.h) * 0.003) as Point[]);
  const geometry = { type: "polygon" as const, points: simplified };
  return {
    index,
    type: "polygonlabels",
    bbox,
    area: ringArea(points),
    digest: digest(geometry),
    geometry,
  };
}

/** Choose the actual target object; confidence scores and preview polygons are not selection evidence. */
export function pickSamRecordingCandidate(
  result: readonly unknown[],
  anchorBbox: readonly [number, number, number, number],
): SamRecordingCandidate {
  const [x1, y1, x2, y2] = anchorBbox.map(normalized);
  const anchor = validBbox({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  const candidates: SamRecordingCandidate[] = [];
  for (const [index, raw] of result.entries()) {
    let candidate: Omit<SamRecordingCandidate, "iou">;
    try {
      candidate = inspectCandidate(raw, index);
    } catch (error) {
      if (error instanceof Error) continue;
      throw error;
    }
    const bbox = candidate.bbox;
    const boxArea = bbox.w * bbox.h;
    if (boxArea >= 0.95) continue;
    const intersection =
      Math.max(0, Math.min(x2, bbox.x + bbox.w) - Math.max(x1, bbox.x)) *
      Math.max(0, Math.min(y2, bbox.y + bbox.h) - Math.max(y1, bbox.y));
    const iou = intersection / (anchor.w * anchor.h + boxArea - intersection);
    if (iou >= 0.5) candidates.push({ ...candidate, iou });
  }
  candidates.sort((a, b) => b.iou - a.iou || a.index - b.index);
  assert.ok(
    candidates[0],
    "No non-full-image SAM candidate matches the recording anchor with IoU >= 0.5",
  );
  return candidates[0];
}

/** Bind the saved result to the selected candidate, allowing only explicit Magic Box conversion. */
export function assertSamRecordingSavedGeometry(
  savedGeometry: unknown,
  selected: SamRecordingCandidate,
  options: { polygonAsBbox?: boolean } = {},
): void {
  const saved = record(savedGeometry);
  let expected = selected.geometry;
  if (options.polygonAsBbox && expected.type === "polygon") {
    const bbox = tightenBboxFromPolygon(expected.points);
    assert.ok(bbox);
    expected = { type: "bbox", ...bbox };
  }
  assert.equal(saved.type, expected.type, "Saved geometry must retain the selected candidate type");
  if (expected.type === "raster_mask") {
    const mask = record(saved.mask);
    assert.equal(
      mask.sha256,
      expected.mask.sha256,
      "Saved Mask digest must match the selected candidate",
    );
    assert.deepEqual(mask.size, expected.mask.size);
  } else if (expected.type === "bbox") {
    for (const key of ["x", "y", "w", "h"] as const) {
      assert.ok(
        Math.abs(normalized(saved[key]) - expected[key]) <= 1e-9,
        `Saved bbox ${key} differs from the selected candidate`,
      );
    }
  } else {
    const points = ring(saved.points);
    assert.equal(points.length, expected.points.length);
    points.forEach((point, index) =>
      point.forEach((coordinate, axis) => {
        assert.ok(
          Math.abs(coordinate - expected.points[index][axis]) <= 1e-9,
          "Saved polygon points differ from the selected candidate",
        );
      }),
    );
    assert.ok(
      !saved.holes || (Array.isArray(saved.holes) && saved.holes.length === 0),
      "Saved polygon gained unexpected holes",
    );
  }
}
