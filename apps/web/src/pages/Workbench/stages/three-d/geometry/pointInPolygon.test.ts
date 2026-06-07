import { describe, expect, it } from "vitest";

import { isPointInPolygon, rectToPolygon } from "./pointInPolygon";

describe("isPointInPolygon", () => {
  it("selects points inside a convex polygon", () => {
    const poly = rectToPolygon(0, 0, 10, 10);
    expect(isPointInPolygon({ x: 5, y: 5 }, poly)).toBe(true);
    expect(isPointInPolygon({ x: 12, y: 5 }, poly)).toBe(false);
  });

  it("treats edges and vertices as selected", () => {
    const poly = rectToPolygon(0, 0, 10, 10);
    expect(isPointInPolygon({ x: 0, y: 5 }, poly)).toBe(true);
    expect(isPointInPolygon({ x: 10, y: 10 }, poly)).toBe(true);
  });

  it("handles concave polygons with the even-odd rule", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 5 },
      { x: 0, y: 10 },
    ];
    expect(isPointInPolygon({ x: 8, y: 8 }, poly)).toBe(true);
    expect(isPointInPolygon({ x: 5, y: 8 }, poly)).toBe(false);
  });

  it("uses even-odd behavior for self intersections", () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(isPointInPolygon({ x: 2, y: 5 }, bowtie)).toBe(false);
    expect(isPointInPolygon({ x: 8, y: 5 }, bowtie)).toBe(false);
    expect(isPointInPolygon({ x: 5, y: 5 }, bowtie)).toBe(true);
  });
});
