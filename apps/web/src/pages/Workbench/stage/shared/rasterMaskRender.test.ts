import { describe, expect, it } from "vitest";
import { encodeCocoRle } from "./geometry/maskRle";
import {
  analyzeRasterMaskAlpha,
  pickTopRasterMaskAt,
  rasterMaskPreviewDimensions,
  rasterMaskAlphaBounds,
} from "./rasterMaskRender";

function alpha(rows: number[][]): Uint8Array {
  return Uint8Array.from(rows.flat().map((value) => value ? 255 : 0));
}

describe("analyzeRasterMaskAlpha", () => {
  it("analyzes and crops a non-square row-major mask", () => {
    const source = alpha([
      [0, 1, 1, 0, 0],
      [0, 1, 0, 0, 1],
      [0, 0, 0, 0, 1],
    ]);

    const result = analyzeRasterMaskAlpha(source, 5, 3);

    expect(result.area).toBe(5);
    expect(result.componentCount).toBe(2);
    expect(result.holeCount).toBe(0);
    expect(result.boundaryPixelCount).toBe(5);
    expect(result.bounds).toEqual({ x: 1 / 5, y: 0, w: 4 / 5, h: 1 });
    expect(result.crop).toMatchObject({ x: 1, y: 0, width: 4, height: 3 });
    expect([...result.crop.alpha]).toEqual([
      255, 255, 0, 0,
      255, 0, 0, 255,
      0, 0, 0, 255,
    ]);
    expect(rasterMaskAlphaBounds(source, 5, 3)).toEqual(result.bounds);
  });

  it("keeps a hole as background without counting it as a component", () => {
    const result = analyzeRasterMaskAlpha(alpha([
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ]), 5, 5);

    expect(result.area).toBe(16);
    expect(result.componentCount).toBe(1);
    expect(result.holeCount).toBe(1);
    expect(result.boundaryPixelCount).toBe(16);
    expect(result.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(result.crop.alpha[2 * result.crop.width + 2]).toBe(0);
  });

  it("counts three 4-connected components", () => {
    const result = analyzeRasterMaskAlpha(alpha([
      [1, 0, 0, 0, 0, 0, 0],
      [1, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1],
    ]), 7, 5);

    expect(result.area).toBe(6);
    expect(result.componentCount).toBe(3);
    expect(result.holeCount).toBe(0);
    expect(result.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("returns an explicit empty crop for an empty mask", () => {
    const result = analyzeRasterMaskAlpha(new Uint8Array(12), 4, 3);

    expect(result.area).toBe(0);
    expect(result.componentCount).toBe(0);
    expect(result.holeCount).toBe(0);
    expect(result.boundaryPixelCount).toBe(0);
    expect(result.bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(result.crop).toMatchObject({ x: 0, y: 0, width: 0, height: 0 });
    expect(result.crop.alpha).toHaveLength(0);
  });

  it("counts multiple enclosed background regions without treating diagonal gaps as open", () => {
    const result = analyzeRasterMaskAlpha(alpha([
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ]), 7, 5);

    expect(result.componentCount).toBe(1);
    expect(result.holeCount).toBe(3);
  });
});

describe("pickTopRasterMaskAt", () => {
  const record = (id: string, zOrder: number, rows: number[][]) => {
    const analysis = analyzeRasterMaskAlpha(alpha(rows), rows[0].length, rows.length);
    return { id, zOrder, ...analysis };
  };

  it("uses inclusive normalized image boundaries", () => {
    const target = record("target", 1, [
      [1, 0],
      [0, 1],
    ]);

    expect(pickTopRasterMaskAt([target], { x: 0, y: 0 })?.id).toBe("target");
    expect(pickTopRasterMaskAt([target], { x: 1, y: 1 })?.id).toBe("target");
    expect(pickTopRasterMaskAt([target], { x: 1, y: 0 })).toBeNull();
    expect(pickTopRasterMaskAt([target], { x: -0.01, y: 0 })).toBeNull();
    expect(pickTopRasterMaskAt([target], { x: 0, y: 1.01 })).toBeNull();
  });

  it("does not hit transparent pixels inside a non-empty bounding box", () => {
    const ring = record("ring", 1, [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ]);

    expect(pickTopRasterMaskAt([ring], { x: 0.5, y: 0.5 })).toBeNull();
    expect(pickTopRasterMaskAt([ring], { x: 0.1, y: 0.1 })?.id).toBe("ring");
  });

  it("picks the highest z-order overlapping mask", () => {
    const low = record("low", 1, [[1]]);
    const high = record("high", 9, [[1]]);

    expect(pickTopRasterMaskAt([high, low], { x: 0.5, y: 0.5 })?.id).toBe("high");
  });

  it("uses later render order as the stable tie-breaker", () => {
    const first = record("first", 4, [[1]]);
    const later = record("later", 4, [[1]]);

    expect(pickTopRasterMaskAt([first, later], { x: 0.5, y: 0.5 })?.id).toBe("later");
    expect(pickTopRasterMaskAt([later, first], { x: 0.5, y: 0.5 })?.id).toBe("first");
  });

  it("uses retained RLE truth instead of an empty preview crop", () => {
    const pixels = alpha([
      [1, 0],
      [0, 1],
    ]);
    const target = {
      id: "preview",
      zOrder: 1,
      sourceWidth: 2,
      sourceHeight: 2,
      crop: { x: 0, y: 0, width: 2, height: 2, alpha: new Uint8Array() },
      rle: encodeCocoRle(pixels, 2, 2),
    };

    expect(pickTopRasterMaskAt([target], { x: 0.1, y: 0.1 })?.id).toBe("preview");
    expect(pickTopRasterMaskAt([target], { x: 0.9, y: 0.1 })).toBeNull();
  });
});

describe("rasterMaskPreviewDimensions", () => {
  it("keeps aspect ratio within a hard pixel budget", () => {
    expect(rasterMaskPreviewDimensions(4000, 2000, 1_000_000)).toEqual({
      width: 1414,
      height: 707,
    });
    expect(rasterMaskPreviewDimensions(1, 4096, 400)).toEqual({ width: 1, height: 400 });
    expect(rasterMaskPreviewDimensions(20, 10, 1_000)).toEqual({ width: 20, height: 10 });
  });
});
