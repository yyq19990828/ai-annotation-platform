/**
 * v0.8.3 · polygonGeom 几何工具单测。
 */
import { describe, it, expect } from "vitest";
import {
  isSelfIntersecting,
  projectOnSegment,
  nearestEdge,
  insertVertex,
  removeVertex,
  moveVertex,
  type Pt,
} from "../polygonGeom";

describe("isSelfIntersecting", () => {
  it("三角形 → 不自交", () => {
    expect(
      isSelfIntersecting([
        [0, 0],
        [1, 0],
        [0.5, 1],
      ]).ok,
    ).toBe(true);
  });

  it("< 4 顶点 → 直接 ok", () => {
    expect(isSelfIntersecting([[0, 0], [1, 1], [2, 0]]).ok).toBe(true);
  });

  it("蝴蝶结 → 自交", () => {
    const r = isSelfIntersecting([
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    expect(r.ok).toBe(false);
    expect(r.edges).toBeDefined();
  });

  it("正方形 → 不自交", () => {
    expect(
      isSelfIntersecting([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]).ok,
    ).toBe(true);
  });
});

describe("projectOnSegment", () => {
  it("中点投影", () => {
    const r = projectOnSegment([0.5, 1], [0, 0], [1, 0]);
    expect(r.t).toBeCloseTo(0.5);
    expect(r.proj[0]).toBeCloseTo(0.5);
    expect(r.dist).toBeCloseTo(1);
  });

  it("端点外 → clamp 到 0", () => {
    const r = projectOnSegment([-1, 0], [0, 0], [1, 0]);
    expect(r.t).toBe(0);
  });

  it("退化段（a=b） → t=0", () => {
    const r = projectOnSegment([0.5, 0.5], [0, 0], [0, 0]);
    expect(r.t).toBe(0);
  });
});

describe("nearestEdge", () => {
  it("找到最近边", () => {
    const sq: Pt[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const r = nearestEdge(sq, [0.5, -0.5]);
    expect(r).not.toBeNull();
    // 离上边 (y=0) 最近
    expect(r!.proj[1]).toBeCloseTo(0);
  });

  it("< 3 顶点 → null", () => {
    expect(nearestEdge([[0, 0], [1, 0]], [0, 0])).toBeNull();
  });
});

describe("insertVertex / removeVertex / moveVertex", () => {
  it("insertVertex 在指定边后插入", () => {
    const out = insertVertex(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      0,
      [0.5, 0],
    );
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual([0.5, 0]);
  });

  it("removeVertex ≤ 3 顶点 → 不动", () => {
    const orig: Pt[] = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ];
    expect(removeVertex(orig, 0)).toBe(orig);
  });

  it("removeVertex 4 顶点 → 减一", () => {
    const out = removeVertex(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      2,
    );
    expect(out).toHaveLength(3);
  });

  it("moveVertex clamp 到 [0,1]", () => {
    const out = moveVertex(
      [
        [0.5, 0.5],
        [1, 0],
        [0, 1],
      ],
      0,
      [-1, 2],
    );
    expect(out[0]).toEqual([0, 1]);
  });
});
