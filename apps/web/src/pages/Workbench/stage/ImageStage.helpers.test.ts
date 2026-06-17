// v0.16.x 第 2 批 · ImageStage 纯几何函数测试守护(伴随从 toImg 提炼,锁定逆变换公式)。
import { describe, it, expect } from "vitest";
import { normalizeImageCoordinate } from "./ImageStage.helpers";

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
