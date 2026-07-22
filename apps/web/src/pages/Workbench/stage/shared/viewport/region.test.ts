import { describe, expect, it } from "vitest";
import { fitNormalizedRegion } from "./region";

describe("fitNormalizedRegion", () => {
  it("fits and centers a normalized quality issue region", () => {
    expect(fitNormalizedRegion(
      { scale: 1, tx: 0, ty: 0 },
      { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 },
      { width: 1000, height: 500 },
      { width: 800, height: 600 },
      50,
    )).toEqual({ scale: 1.4, tx: -300, ty: -50 });
  });

  it("keeps the current viewport for an invalid empty region", () => {
    const current = { scale: 2, tx: 3, ty: 4 };
    expect(fitNormalizedRegion(
      current,
      { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.8 },
      { width: 100, height: 100 },
      { width: 500, height: 500 },
    )).toBe(current);
  });
});
