import { describe, expect, it } from "vitest";

import type { AnnotationResponse, Box3DGeometry } from "@/types";
import { pasteOffsetPayload, serializeBox3D } from "./box3dClipboard";

const geometry: Box3DGeometry = {
  type: "box_3d",
  center: [1, 2, 3],
  size: [4, 5, 6],
  rotation: [0.1, 0.2, 0.3],
  convention_at_create: "iso_8855",
};

function annotation(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  return {
    id: "a1",
    task_id: "t1",
    project_id: null,
    user_id: null,
    source: "manual",
    annotation_type: "box_3d",
    class_name: "car",
    geometry,
    confidence: 1,
    parent_prediction_id: null,
    parent_annotation_id: null,
    lead_time: null,
    is_active: true,
    ground_truth: false,
    attributes: { occluded: true, visibility: "partial" },
    created_at: "2026-06-07T00:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

describe("serializeBox3D", () => {
  it("copies class, geometry and attributes from a box_3d annotation", () => {
    const clip = serializeBox3D(annotation());
    expect(clip).toEqual({
      class_name: "car",
      geometry,
      attributes: { occluded: true, visibility: "partial" },
    });
    expect(clip?.geometry).not.toBe(geometry);
  });

  it("ignores non box_3d annotations", () => {
    expect(serializeBox3D(annotation({ geometry: { type: "bbox", x: 0, y: 0, w: 1, h: 1 } }))).toBeNull();
  });
});

describe("pasteOffsetPayload", () => {
  it("offsets center in world coordinates and preserves class, size, rotation and attributes", () => {
    const clip = serializeBox3D(annotation());
    expect(clip).not.toBeNull();
    const payload = pasteOffsetPayload(clip!, [2, 2, 0]);
    expect(payload.annotation_type).toBe("box_3d");
    expect(payload.tool_unit_id).toBe("lidar_box_3d");
    expect(payload.class_name).toBe("car");
    expect(payload.attributes).toEqual({ occluded: true, visibility: "partial" });
    expect(payload.geometry).toMatchObject({
      type: "box_3d",
      center: [3, 4, 3],
      size: [4, 5, 6],
      rotation: [0.1, 0.2, 0.3],
    });
  });
});
