// v0.16.x 第 2 批 · ImageStage 纯几何函数测试守护(伴随从 toImg 提炼,锁定逆变换公式)。
import { describe, it, expect } from "vitest";
import { normalizeImageCoordinate, resolveSnapMatch, siblingHighlightChildren } from "./ImageStage.helpers";
import type { Pt } from "./polygonGeom";

describe("siblingHighlightChildren", () => {
  const boxes = [
    { id: "p", parent_annotation_id: null },
    { id: "c1", parent_annotation_id: "p" },
    { id: "c2", parent_annotation_id: "p" },
    { id: "other", parent_annotation_id: "q" },
  ];

  it("单选父框 → 返回其直接子框", () => {
    expect(siblingHighlightChildren(boxes, "p", 1).map((b) => b.id)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("单选无子框的框 → 空", () => {
    expect(siblingHighlightChildren(boxes, "other", 1)).toEqual([]);
  });

  it("多选 → 空 (语义模糊不画环)", () => {
    expect(siblingHighlightChildren(boxes, "p", 2)).toEqual([]);
  });

  it("无选 → 空", () => {
    expect(siblingHighlightChildren(boxes, null, 0)).toEqual([]);
  });
});

describe("normalizeImageCoordinate", () => {
  it("逆 viewport 平移/缩放后归一为图坐标", () => {
    // x = (230 - 10 - 20)/2/100 = 200/200 = 1
    const out = normalizeImageCoordinate(
      230,
      0,
      { left: 10, top: 0 },
      { tx: 20, ty: 0, scale: 2 },
      100,
      100,
    );
    expect(out.x).toBeCloseTo(1);
  });

  it("无平移无缩放时即比例坐标", () => {
    const out = normalizeImageCoordinate(
      50,
      25,
      { left: 0, top: 0 },
      { tx: 0, ty: 0, scale: 1 },
      100,
      50,
    );
    expect(out).toEqual({ x: 0.5, y: 0.5 });
  });
});

const SNAP_T = { imgW: 100, imgH: 100, scale: 1 };
const P = (x: number, y: number): Pt => [x, y];

describe("resolveSnapMatch", () => {
  it("点吸附与线段吸附都命中时取距离更近者", () => {
    const m = resolveSnapMatch(
      P(0.5, 0.5),
      {
        points: [{ point: P(0.51, 0.5) }], // 1px
        segments: [{ a: P(0.5, 0.6), b: P(0.6, 0.6) }], // 10px
      },
      20,
      SNAP_T,
    );
    expect(m?.kind).toBe("point");
    expect(m?.distancePx).toBeCloseTo(1);
  });

  it("只有线段命中时返回 segment", () => {
    const m = resolveSnapMatch(
      P(0.5, 0.5),
      { points: [], segments: [{ a: P(0.5, 0.6), b: P(0.6, 0.6) }] },
      20,
      SNAP_T,
    );
    expect(m?.kind).toBe("segment");
  });

  it("阈值内无候选时返回 null", () => {
    const m = resolveSnapMatch(
      P(0.5, 0.5),
      { points: [{ point: P(0.9, 0.9) }], segments: [] },
      5,
      SNAP_T,
    );
    expect(m).toBeNull();
  });
});
