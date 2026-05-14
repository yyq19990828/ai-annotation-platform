// v0.10.7 M4-δ · I11 · maskToPolygon 单测：
// - 空 mask → 空
// - 矩形 mask → 顶点紧绕外环（≥3，闭合后去重）
// - 圆形 mask → 顶点数远小于 perimeter（RDP 起效）
// - 多连通 mask → 取最大分量；multipleComponents=true
// - 顶点无重复（去重生效）

import { describe, expect, it } from "vitest";
import { MaskBuffer } from "./maskBuffer";
import { maskToPolygon } from "./maskToPolygon";

function makeRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): MaskBuffer {
  const m = new MaskBuffer({ width: w, height: h });
  m.fromPolygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  return m;
}

describe("maskToPolygon", () => {
  it("空 mask → 空 points", () => {
    const m = new MaskBuffer({ width: 20, height: 20 });
    const out = maskToPolygon(m);
    expect(out.points).toEqual([]);
    expect(out.multipleComponents).toBe(false);
  });

  it("矩形 mask → polygon 形状贴近", () => {
    const m = makeRect(50, 50, 10, 10, 30, 30);
    const out = maskToPolygon(m, { simplifyEpsilon: 0.5 });
    expect(out.points.length).toBeGreaterThanOrEqual(4);
    // bounding box 应该接近 (10..30, 10..30)
    const xs = out.points.map((p) => p[0]);
    const ys = out.points.map((p) => p[1]);
    expect(Math.min(...xs)).toBeLessThanOrEqual(11);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(29);
    expect(Math.min(...ys)).toBeLessThanOrEqual(11);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(29);
    expect(out.multipleComponents).toBe(false);
  });

  it("圆形 mask → 简化后顶点数远小于 perimeter", () => {
    const m = new MaskBuffer({ width: 80, height: 80 });
    m.brush(40, 40, 20);
    const out = maskToPolygon(m, { simplifyEpsilon: 1.5 });
    // 半径 20 圆周 ≈ 125 像素；简化后应 < 60
    expect(out.points.length).toBeGreaterThan(8);
    expect(out.points.length).toBeLessThan(60);
  });

  it("两个分量 → 取面积更大的；multipleComponents=true", () => {
    const m = new MaskBuffer({ width: 60, height: 60 });
    // 大方块 20x20
    m.fromPolygon([[5, 5], [25, 5], [25, 25], [5, 25]]);
    // 小方块 5x5
    m.fromPolygon([[40, 40], [45, 40], [45, 45], [40, 45]]);
    const out = maskToPolygon(m, { simplifyEpsilon: 0.5 });
    expect(out.multipleComponents).toBe(true);
    // 取的应该是大方块（x 范围在 0..30）
    const xs = out.points.map((p) => p[0]);
    expect(Math.max(...xs)).toBeLessThan(30);
  });

  it("输出顶点无连续重复", () => {
    const m = makeRect(40, 40, 5, 5, 35, 35);
    const out = maskToPolygon(m);
    for (let i = 1; i < out.points.length; i++) {
      const a = out.points[i - 1];
      const b = out.points[i];
      expect(a[0] === b[0] && a[1] === b[1]).toBe(false);
    }
  });

  it("threshold 控制实心判定", () => {
    const m = new MaskBuffer({ width: 20, height: 20 });
    // 单点画半径 3 → alpha=255
    m.brush(10, 10, 3);
    // threshold=200 应找到分量；threshold=300（>255）则没像素 → 空
    expect(maskToPolygon(m, { threshold: 200 }).points.length).toBeGreaterThan(0);
    expect(maskToPolygon(m, { threshold: 300 }).points).toEqual([]);
  });

  it("simplifyEpsilon=0 跳过简化", () => {
    const m = new MaskBuffer({ width: 80, height: 80 });
    m.brush(40, 40, 20);
    const off = maskToPolygon(m, { simplifyEpsilon: 0 });
    const on = maskToPolygon(m, { simplifyEpsilon: 1.5 });
    expect(off.points.length).toBeGreaterThan(on.points.length);
  });
});
