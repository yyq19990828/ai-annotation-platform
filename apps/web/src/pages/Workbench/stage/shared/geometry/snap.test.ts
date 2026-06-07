import { describe, expect, it } from "vitest";
import type { AnnotationResponse } from "@/types";
import {
  buildSnapIndex,
  snapPointToCandidates,
  snapPointToSegments,
} from "./snap";

const transform = { imgW: 100, imgH: 100, scale: 1 };

function annotation(id: string, points: [number, number][]): AnnotationResponse {
  return {
    id,
    task_id: "task",
    project_id: "project",
    user_id: "user",
    source: "manual",
    annotation_type: "polygon",
    class_name: "car",
    geometry: { type: "polygon", points },
    confidence: 1,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    attributes: {},
    created_at: "2026-06-07T00:00:00Z",
    updated_at: null,
  };
}

describe("snap geometry helpers", () => {
  it("snaps to the closest point candidate within the pixel threshold", () => {
    const match = snapPointToCandidates(
      [0.115, 0.1],
      [
        { point: [0.2, 0.2], annotationId: "far" },
        { point: [0.1, 0.1], annotationId: "near", pointIndex: 0 },
      ],
      3,
      transform,
    );

    expect(match).toMatchObject({
      kind: "point",
      annotationId: "near",
      point: [0.1, 0.1],
      pointIndex: 0,
    });
    expect(match?.distancePx).toBeCloseTo(1.5);
  });

  it("does not snap to candidates outside the threshold", () => {
    expect(
      snapPointToCandidates([0.14, 0.1], [{ point: [0.1, 0.1] }], 3, transform),
    ).toBeNull();
  });

  it("snaps to the nearest segment projection", () => {
    const match = snapPointToSegments(
      [0.5, 0.53],
      [{ a: [0.2, 0.5], b: [0.8, 0.5], annotationId: "edge", edgeIndex: 0 }],
      4,
      transform,
    );

    expect(match).toMatchObject({
      kind: "segment",
      annotationId: "edge",
      edgeIndex: 0,
      point: [0.5, 0.5],
    });
    expect(match?.distancePx).toBeCloseTo(3);
  });

  it("builds point and segment candidates from polygon and multi_polygon annotations only", () => {
    const index = buildSnapIndex([
      annotation("poly", [[0, 0], [0.2, 0], [0.2, 0.2]]),
      {
        ...annotation("multi", []),
        annotation_type: "multi_polygon",
        geometry: {
          type: "multi_polygon",
          polygons: [{ type: "polygon", points: [[0.4, 0.4], [0.5, 0.4], [0.5, 0.5]] }],
        },
      },
      {
        ...annotation("bbox", []),
        annotation_type: "bbox",
        geometry: { type: "bbox", x: 0, y: 0, w: 0.1, h: 0.1 },
      },
    ]);

    expect(index.points).toHaveLength(6);
    expect(index.segments).toHaveLength(6);
    expect(index.points.map((point) => point.annotationId)).toEqual([
      "poly",
      "poly",
      "poly",
      "multi",
      "multi",
      "multi",
    ]);
  });
});
