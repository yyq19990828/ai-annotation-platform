// v0.10.7 M4-δ · I11 · MaskBuffer 单测：brush / erase / clear / fromPolygon / toAlphaImageData / clone。

import { describe, expect, it } from "vitest";
import { MaskBuffer } from "./maskBuffer";

describe("MaskBuffer · 构造与基础", () => {
  it("拒绝非正整数尺寸", () => {
    expect(() => new MaskBuffer({ width: 0, height: 10 })).toThrow();
    expect(() => new MaskBuffer({ width: 10, height: -1 })).toThrow();
    expect(() => new MaskBuffer({ width: 1.5, height: 10 })).toThrow();
  });

  it("初始全 0", () => {
    const m = new MaskBuffer({ width: 10, height: 10 });
    expect(m.countSet()).toBe(0);
  });
});

describe("MaskBuffer · brush / erase / clear", () => {
  it("brush 在 center 画圆，countSet 与理论面积接近", () => {
    const m = new MaskBuffer({ width: 100, height: 100 });
    m.brush(50, 50, 10);
    const n = m.countSet();
    // π * 10² ≈ 314
    expect(n).toBeGreaterThan(250);
    expect(n).toBeLessThan(380);
    // 圆心必中
    expect(m.get(50, 50)).toBe(255);
    // 远点必不中
    expect(m.get(80, 80)).toBe(0);
  });

  it("brush 越界部分被裁，仍能落入合法像素", () => {
    const m = new MaskBuffer({ width: 20, height: 20 });
    m.brush(0, 0, 5);
    // 仅左上 1/4 圆，应有像素被画但不越界
    expect(m.countSet()).toBeGreaterThan(0);
    expect(m.get(0, 0)).toBe(255);
  });

  it("erase 抹掉已画区域", () => {
    const m = new MaskBuffer({ width: 50, height: 50 });
    m.brush(25, 25, 10);
    const before = m.countSet();
    expect(before).toBeGreaterThan(0);
    m.erase(25, 25, 12);
    expect(m.countSet()).toBe(0);
  });

  it("clear 全清零", () => {
    const m = new MaskBuffer({ width: 30, height: 30 });
    m.brush(15, 15, 8);
    expect(m.countSet()).toBeGreaterThan(0);
    m.clear();
    expect(m.countSet()).toBe(0);
  });
});

describe("MaskBuffer · fromPolygon", () => {
  it("矩形 polygon 填出矩形 mask", () => {
    const m = new MaskBuffer({ width: 50, height: 50 });
    m.fromPolygon([[10, 10], [30, 10], [30, 30], [10, 30]]);
    // 20x20 ≈ 400 像素（±5% 容差）
    const n = m.countSet();
    expect(n).toBeGreaterThan(360);
    expect(n).toBeLessThan(450);
    // 中心命中、远处空
    expect(m.get(20, 20)).toBe(255);
    expect(m.get(40, 40)).toBe(0);
  });

  it("三角形 polygon 大致填出三角形面积", () => {
    const m = new MaskBuffer({ width: 100, height: 100 });
    // 直角三角形 边长 40,40 → 面积 = 800
    m.fromPolygon([[10, 10], [50, 10], [10, 50]]);
    const n = m.countSet();
    expect(n).toBeGreaterThan(700);
    expect(n).toBeLessThan(900);
  });

  it("顶点 < 3 时静默不画", () => {
    const m = new MaskBuffer({ width: 20, height: 20 });
    m.fromPolygon([[1, 1], [10, 10]]);
    expect(m.countSet()).toBe(0);
  });

  it("polygon 部分越界仍能填到有效区域", () => {
    const m = new MaskBuffer({ width: 20, height: 20 });
    // 大部分在画布外
    m.fromPolygon([[-10, -10], [25, -10], [25, 25], [-10, 25]]);
    // 应该填满整个画布
    expect(m.countSet()).toBe(20 * 20);
  });
});

describe("MaskBuffer · toAlphaImageData / clone", () => {
  it("toAlphaImageData 仅 alpha 通道有 mask 值", () => {
    const m = new MaskBuffer({ width: 4, height: 4 });
    m.brush(2, 2, 1);
    const out = m.toAlphaImageData();
    expect(out.length).toBe(4 * 4 * 4);
    // 找一个 alpha=255 的像素，对应 R/G/B 必须是 0
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] === 255) {
        expect(out[i]).toBe(0);
        expect(out[i + 1]).toBe(0);
        expect(out[i + 2]).toBe(0);
      }
    }
  });

  it("clone 是独立拷贝", () => {
    const a = new MaskBuffer({ width: 10, height: 10 });
    a.brush(5, 5, 3);
    const before = a.countSet();
    const b = a.clone();
    expect(b.countSet()).toBe(before);
    b.clear();
    expect(b.countSet()).toBe(0);
    // 原 mask 不受影响
    expect(a.countSet()).toBe(before);
  });
});
