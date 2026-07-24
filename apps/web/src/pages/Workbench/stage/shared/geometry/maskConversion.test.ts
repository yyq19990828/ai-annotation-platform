import { describe, expect, it } from "vitest";
import type { MultiPolygonGeometry, PolygonGeometry } from "@/types";
import { decodeCocoRle, encodeCocoRle } from "./maskRle";
import {
  compareRegionToRasterResult,
  rasterMaskToRegionPreview,
  rasterizeRegionGeometry,
  vectorGeometryToRasterPreview,
} from "./maskConversion";

const donut: PolygonGeometry = {
  type: "polygon",
  points: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  holes: [
    [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75],
    ],
  ],
};

describe("maskConversion", () => {
  it("polygon hole 往返保持零 XOR", () => {
    const raster = vectorGeometryToRasterPreview(donut, 8, 6);
    const vector = rasterMaskToRegionPreview(raster.rle);

    expect(vector.geometry.type).toBe("polygon");
    expect(vector.report.sourceHoles).toBe(1);
    expect(vector.report.changedPixels).toBe(0);
    expect(vector.report.lossy).toBe(false);
  });

  it("非正方形三组件输出 multi_polygon 并保持像素", () => {
    const geometry: MultiPolygonGeometry = {
      type: "multi_polygon",
      polygons: [
        {
          type: "polygon",
          points: [
            [0, 0],
            [0.25, 0],
            [0.25, 0.34],
            [0, 0.34],
          ],
        },
        {
          type: "polygon",
          points: [
            [0.4, 0.34],
            [0.6, 0.34],
            [0.6, 0.67],
            [0.4, 0.67],
          ],
        },
        {
          type: "polygon",
          points: [
            [0.75, 0.67],
            [1, 0.67],
            [1, 1],
            [0.75, 1],
          ],
        },
      ],
    };
    const alpha = rasterizeRegionGeometry(geometry, 12, 6);
    const raster = vectorGeometryToRasterPreview(geometry, 12, 6);
    const vector = rasterMaskToRegionPreview(raster.rle);

    expect(vector.geometry.type).toBe("multi_polygon");
    expect(vector.report.sourceComponents).toBe(3);
    expect(vector.report.changedPixels).toBe(0);
    expect(decodeCocoRle(raster.rle)).toEqual(alpha);
  });

  it("精修报告统计实际像素 XOR 与丢失量", () => {
    const raster = vectorGeometryToRasterPreview(donut, 8, 6);
    const edited = decodeCocoRle(raster.rle);
    edited[0] = 0;
    edited[3 * 8 + 3] = 255;

    const report = compareRegionToRasterResult(donut, encodeCocoRle(edited, 8, 6));

    expect(report.changedPixels).toBe(2);
    expect(report.droppedPixels).toBe(1);
    expect(report.areaDeltaPixels).toBe(0);
    expect(report.lossy).toBe(true);
    expect(report.tolerance).toBe(0);
  });

  it("单像素孤岛转矢量不丢失", () => {
    const alpha = new Uint8Array(5 * 3);
    alpha[1 * 5 + 2] = 255;

    const vector = rasterMaskToRegionPreview(encodeCocoRle(alpha, 5, 3));

    expect(vector.report.sourceComponents).toBe(1);
    expect(vector.report.changedPixels).toBe(0);
    expect(vector.report.droppedPixels).toBe(0);
  });

  it("斜角接触像素保持为两个四连通组件", () => {
    const alpha = new Uint8Array(4 * 4);
    alpha[1 * 4 + 1] = 255;
    alpha[2 * 4 + 2] = 255;

    const vector = rasterMaskToRegionPreview(encodeCocoRle(alpha, 4, 4));

    expect(vector.geometry.type).toBe("multi_polygon");
    expect(vector.report.sourceComponents).toBe(2);
    expect(vector.report.targetComponents).toBe(2);
    expect(vector.report.changedPixels).toBe(0);
  });
});
