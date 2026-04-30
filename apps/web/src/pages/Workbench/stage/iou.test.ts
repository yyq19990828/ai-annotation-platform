import { describe, expect, it } from "vitest";
import { iou } from "./iou";

describe("iou", () => {
  it("identical boxes → 1", () => {
    expect(iou({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toBeCloseTo(1, 6);
  });

  it("disjoint → 0", () => {
    expect(iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
  });

  it("touching but not overlapping → 0", () => {
    expect(iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.1, y: 0, w: 0.1, h: 0.1 })).toBe(0);
  });

  it("half overlap horizontally → 1/3", () => {
    // a: [0..0.2], b: [0.1..0.3], overlap = 0.1×0.1, union = 0.04+0.04-0.01=0.07
    const v = iou({ x: 0, y: 0, w: 0.2, h: 0.1 }, { x: 0.1, y: 0, w: 0.2, h: 0.1 });
    expect(v).toBeCloseTo(0.01 / 0.03, 6);
  });

  it("contained box (b inside a) → b.area / a.area", () => {
    const v = iou({ x: 0, y: 0, w: 0.4, h: 0.4 }, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
    // inter = 0.01, union = 0.16
    expect(v).toBeCloseTo(0.01 / 0.16, 6);
  });

  it("zero area defensive → 0", () => {
    expect(iou({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(0);
  });
});
