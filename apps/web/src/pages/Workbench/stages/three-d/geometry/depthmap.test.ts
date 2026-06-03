import { describe, it, expect } from "vitest";
import type { SensorCalibration } from "@/types";
import { buildDepthRaster, sampleDepth } from "./depthmap";

/* 极简标定:extrinsic=单位阵,intrinsic=[[1,0,0],[0,1,0],[0,0,1]]
 * ⇒ 点 (x,y,z) → u=x/z, v=y/z, depth=z。 */
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const CALIB: SensorCalibration = {
  extrinsic: IDENTITY4 as unknown as SensorCalibration["extrinsic"],
  intrinsic: [1, 0, 0, 0, 1, 0, 0, 0, 1] as unknown as SensorCalibration["intrinsic"],
};

describe("buildDepthRaster + sampleDepth", () => {
  it("最近点深度落到对应格,可被采样到", () => {
    // 点 (2,2,4) → u=0.5,v=0.5,depth=4。cell=1 ⇒ 格(0,0)。
    const r = buildDepthRaster(new Float32Array([2, 2, 4]), CALIB, 4, 4, 1);
    const hit = sampleDepth(r, 0.5, 0.5);
    expect(hit).not.toBeNull();
    expect(hit!.depth).toBeCloseTo(4, 5);
    expect(hit!.point[0]).toBeCloseTo(2, 5);
  });

  it("同格多点取最近(depth 最小)者", () => {
    // 两点都投到 (0.5,0.5): (2,2,4) depth=4, (4,4,8) depth=8 → 取 depth=4。
    const r = buildDepthRaster(new Float32Array([2, 2, 4, 4, 4, 8]), CALIB, 4, 4, 1);
    const hit = sampleDepth(r, 0.5, 0.5);
    expect(hit!.depth).toBeCloseTo(4, 5);
  });

  it("相机后方 (depth<=0) 的点不入栅格", () => {
    const r = buildDepthRaster(new Float32Array([2, 2, -4]), CALIB, 4, 4, 1);
    expect(isFinite(r.minDepth)).toBe(false); // 无命中
    expect(sampleDepth(r, 0.5, 0.5)).toBeNull();
  });

  it("出框的点不入栅格", () => {
    // (20,20,4) → u=5,v=5 出框(>=4)。
    const r = buildDepthRaster(new Float32Array([20, 20, 4]), CALIB, 4, 4, 1);
    expect(sampleDepth(r, 0.5, 0.5)).toBeNull();
  });

  it("空区(邻域无点)返回 null", () => {
    // 点在 (0,0) 格;查远处 (3.5,3.5) 邻域无点。
    const r = buildDepthRaster(new Float32Array([0.5, 0.5, 1]), CALIB, 4, 4, 1);
    expect(sampleDepth(r, 3.5, 3.5)).toBeNull();
  });

  it("空格但 1 环内有点 → 取邻格", () => {
    // 点投到格(0,0);查格(1,1)(空),1 环含(0,0) → 命中。
    const r = buildDepthRaster(new Float32Array([0.2, 0.2, 1]), CALIB, 4, 4, 1);
    const hit = sampleDepth(r, 1.5, 1.5); // 格(1,1)
    expect(hit).not.toBeNull();
    expect(hit!.depth).toBeCloseTo(1, 5);
  });
});
