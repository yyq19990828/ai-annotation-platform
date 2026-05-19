import { describe, expect, it } from "vitest";
import { tightenBboxFromPolygon } from "./bbox";

describe("tightenBboxFromPolygon", () => {
  it("returns null for empty input", () => {
    expect(tightenBboxFromPolygon([])).toBeNull();
  });

  it("returns null when polygon has 0 area", () => {
    expect(
      tightenBboxFromPolygon([
        [0.5, 0.5],
        [0.5, 0.5],
      ]),
    ).toBeNull();
  });

  it("derives tight axis-aligned bbox", () => {
    const out = tightenBboxFromPolygon([
      [0.2, 0.3],
      [0.6, 0.25],
      [0.5, 0.7],
      [0.15, 0.55],
    ]);
    expect(out).not.toBeNull();
    expect(out!.x).toBeCloseTo(0.15);
    expect(out!.y).toBeCloseTo(0.25);
    expect(out!.w).toBeCloseTo(0.45);
    expect(out!.h).toBeCloseTo(0.45);
  });

  it("clamps to [0, 1] when SAM polygon overshoots", () => {
    const out = tightenBboxFromPolygon([
      [-0.01, -0.01],
      [1.01, 0.5],
      [0.5, 1.01],
    ]);
    expect(out).not.toBeNull();
    expect(out!.x).toBeGreaterThanOrEqual(0);
    expect(out!.y).toBeGreaterThanOrEqual(0);
    expect(out!.x + out!.w).toBeLessThanOrEqual(1);
    expect(out!.y + out!.h).toBeLessThanOrEqual(1);
  });

  it("accepts number[][] form", () => {
    const out = tightenBboxFromPolygon([
      [0.1, 0.2],
      [0.4, 0.6],
    ]);
    expect(out).not.toBeNull();
    expect(out!.x).toBeCloseTo(0.1);
    expect(out!.y).toBeCloseTo(0.2);
    expect(out!.w).toBeCloseTo(0.3);
    expect(out!.h).toBeCloseTo(0.4);
  });
});
