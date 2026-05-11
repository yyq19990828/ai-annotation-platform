import { describe, expect, it } from "vitest";
import type { Annotation } from "@/types";
import { getBatchChangeTarget, useImageAnnotationActions } from "./useImageAnnotationActions";

function box(id: string, cls = "Car"): Annotation {
  return {
    id,
    cls,
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.4,
    source: "manual",
    conf: 1,
  };
}

describe("useImageAnnotationActions module", () => {
  it("exports the hook", () => {
    expect(typeof useImageAnnotationActions).toBe("function");
  });

  it("builds batch class-change target from current selection", () => {
    expect(getBatchChangeTarget(["b"], [box("a"), box("b", "Bike")])).toEqual({
      geom: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      className: "Bike",
      count: 1,
    });
  });
});
