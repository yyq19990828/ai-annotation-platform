import { describe, expect, it } from "vitest";
import { analyzeRasterMaskRleAsync } from "./rasterMaskCompute";

describe("analyzeRasterMaskRleAsync", () => {
  it("测试显式降级保持非正方形的行主序边界", async () => {
    const analysis = await analyzeRasterMaskRleAsync(
      { encoding: "coco_rle", size: [2, 4], counts: [1, 2, 5] },
      { createWorker: null },
    );

    expect(analysis.sourceWidth).toBe(4);
    expect(analysis.sourceHeight).toBe(2);
    expect(analysis.area).toBe(2);
    expect(analysis.bounds).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });
});
