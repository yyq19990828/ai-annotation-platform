import { describe, expect, it } from "vitest";
import { buildTintedMaskRgba, maskAlphaBounds } from "./videoMaskFrames";

describe("video mask frame helpers", () => {
  it("builds a transparent RGBA overlay from row-major alpha", () => {
    expect([...buildTintedMaskRgba(Uint8Array.from([0, 255]), "#102030")]).toEqual([
      0, 0, 0, 0,
      16, 32, 48, 255,
    ]);
  });

  it("computes normalized bounds without treating empty pixels as hits", () => {
    const alpha = Uint8Array.from([
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 0, 255, 0,
    ]);
    expect(maskAlphaBounds(alpha, 4, 3)).toEqual({ x: 0.25, y: 1 / 3, w: 0.5, h: 2 / 3 });
    expect(maskAlphaBounds(new Uint8Array(4), 2, 2)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
