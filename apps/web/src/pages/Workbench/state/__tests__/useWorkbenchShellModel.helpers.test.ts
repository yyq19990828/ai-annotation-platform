// v0.16.x 第 2 批 · useWorkbenchShellModel 纯函数测试守护(伴随逻辑提炼,锁定坐标公式行为)。
import { describe, it, expect } from "vitest";
import { resolvePinViewport } from "../useWorkbenchShellModel.helpers";

describe("resolvePinViewport", () => {
  it("把归一 anchor 对应像素点平移到视口中心,保留 scale", () => {
    const out = resolvePinViewport(
      { scale: 2, tx: 0, ty: 0 },
      { x: 0.5, y: 0.5 },
      100,
      200,
      { w: 800, h: 600 },
    );
    // tx = 800/2 - 0.5*100*2 = 300 ; ty = 600/2 - 0.5*200*2 = 100
    expect(out).toEqual({ scale: 2, tx: 300, ty: 100 });
  });

  it("anchor 在原点时只居中,保留其它视口字段", () => {
    const out = resolvePinViewport(
      { scale: 1, tx: 5, ty: 7 },
      { x: 0, y: 0 },
      100,
      100,
      { w: 400, h: 400 },
    );
    expect(out).toEqual({ scale: 1, tx: 200, ty: 200 });
  });
});
