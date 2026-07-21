import { describe, expect, it } from "vitest";
import type { Geometry } from "@/types";
import {
  isComplexPolygonGeometry,
  supportsBBoxNudge,
  supportsSingleRingPolygonEdit,
} from "./geometryEditPolicy";

describe("geometryEditPolicy", () => {
  const simple: Geometry = {
    type: "polygon",
    points: [[0, 0], [1, 0], [1, 1]],
  };
  const withHole: Geometry = {
    type: "polygon",
    points: [[0, 0], [1, 0], [1, 1]],
    holes: [[[0.2, 0.2], [0.4, 0.2], [0.3, 0.4]]],
  };
  const multi: Geometry = {
    type: "multi_polygon",
    polygons: [{ type: "polygon", points: [[0, 0], [1, 0], [1, 1]] }],
  };

  it("仅 holes / multi_polygon 被视为复杂 polygon", () => {
    expect(isComplexPolygonGeometry(simple)).toBe(false);
    expect(isComplexPolygonGeometry(withHole)).toBe(true);
    expect(isComplexPolygonGeometry(multi)).toBe(true);
  });

  it("points-only 编辑器只接收无孔单 polygon", () => {
    expect(supportsSingleRingPolygonEdit(simple)).toBe(true);
    expect(supportsSingleRingPolygonEdit(withHole)).toBe(false);
    expect(supportsSingleRingPolygonEdit(multi)).toBe(false);
  });

  it("bbox nudge 门拒绝所有 polygon 系几何", () => {
    expect(supportsBBoxNudge({ type: "bbox", x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(supportsBBoxNudge(simple)).toBe(false);
    expect(supportsBBoxNudge(withHole)).toBe(false);
    expect(supportsBBoxNudge(multi)).toBe(false);
  });
});
