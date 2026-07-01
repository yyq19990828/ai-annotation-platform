// v0.20.15 · geometryTranslate 平移守护 (粘贴偏移 + 父子 Alt 拖动联动共用同一套)。
import { describe, it, expect } from "vitest";
import type { Annotation } from "@/types";
import { translateGeometry, translatePoints, clamp01 } from "./geometryTranslate";

function anno(geometry: Annotation["geometry"]): Annotation {
  return { id: "a", geometry, x: 0, y: 0, w: 0, h: 0 } as Annotation;
}

describe("clamp01 / translatePoints", () => {
  it("clamp01 夹到 [0,1]", () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });
  it("translatePoints 逐点平移并 clamp", () => {
    expect(translatePoints([[0.1, 0.1], [0.9, 0.9]], 0.2, -0.05)).toEqual([
      [0.30000000000000004, 0.05],
      [1, 0.85],
    ]);
  });
});

describe("translateGeometry", () => {
  it("bbox 平移, x/y clamp 到不越界 (保 w/h)", () => {
    const { geometry } = translateGeometry(
      anno({ type: "bbox", x: 0.2, y: 0.2, w: 0.3, h: 0.3 }),
      0.1,
      -0.1,
    );
    expect(geometry).toEqual({ type: "bbox", x: 0.30000000000000004, y: 0.1, w: 0.3, h: 0.3 });
  });

  it("bbox 越右边界 → x clamp 到 1-w", () => {
    const { geometry } = translateGeometry(
      anno({ type: "bbox", x: 0.8, y: 0.1, w: 0.3, h: 0.3 }),
      0.5,
      0,
    );
    expect((geometry as { x: number }).x).toBeCloseTo(0.7); // 1 - 0.3
  });

  it("polygon 逐顶点平移", () => {
    const { geometry } = translateGeometry(
      anno({ type: "polygon", points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]] }),
      0.1,
      0.1,
    );
    expect((geometry as { points: [number, number][] }).points).toEqual([
      [0.2, 0.2],
      [0.30000000000000004, 0.30000000000000004],
      [0.4, 0.2],
    ]);
  });

  it("rotated_bbox 平移中心 cx/cy, 保 angle/w/h", () => {
    const { geometry } = translateGeometry(
      anno({ type: "rotated_bbox", cx: 0.4, cy: 0.4, w: 0.2, h: 0.1, angle: 30 }),
      0.1,
      0.1,
    );
    expect(geometry).toMatchObject({ cx: 0.5, cy: 0.5, angle: 30, w: 0.2, h: 0.1 });
  });
});
