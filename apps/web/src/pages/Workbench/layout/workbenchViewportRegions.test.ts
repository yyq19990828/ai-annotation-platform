import { describe, expect, it } from "vitest";
import { intersectRect, subtractRects } from "./workbenchViewportRegions";

describe("shared viewport occlusion", () => {
  it("subtracts overlapping floating windows without restoring holes or drawing pieces twice", () => {
    const canvas = { left: 0, top: 0, width: 100, height: 100 };
    const covers = [
      { left: 20, top: 20, width: 50, height: 50 },
      { left: 40, top: 40, width: 50, height: 50 },
    ];
    const pieces = subtractRects(canvas, covers);
    expect(pieces.reduce((area, rect) => area + rect.width * rect.height, 0)).toBe(5900);
    pieces.forEach((piece, index) => {
      covers.forEach((cover) => expect(intersectRect(piece, cover)).toBeNull());
      pieces.slice(index + 1).forEach((other) => expect(intersectRect(piece, other)).toBeNull());
    });
    expect(subtractRects(canvas, [])).toEqual([canvas]);
    expect(subtractRects(canvas, [canvas])).toEqual([]);
  });
});
