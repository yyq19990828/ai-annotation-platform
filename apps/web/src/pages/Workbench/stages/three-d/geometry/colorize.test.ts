import { describe, it, expect } from "vitest";
import type { SensorCalibration } from "@/types";
import { colorizePoints, type CameraSample } from "./colorize";

/* ──────────────────────────────────────────────────────────────────────
 * 上色纯函数单测。构造极简标定:extrinsic = 单位阵(相机系=lidar系),
 * intrinsic = [[1,0,cx],[0,1,cy],[0,0,1]] ⇒ 对点 (x,y,z): u=x/z+cx, v=y/z+cy, depth=z。
 * 配小图(每像素塞已知色)断言采样结果。
 * ────────────────────────────────────────────────────────────────────── */

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function calib(cx: number, cy: number): SensorCalibration {
  return {
    extrinsic: IDENTITY4 as unknown as SensorCalibration["extrinsic"],
    intrinsic: [1, 0, cx, 0, 1, cy, 0, 0, 1] as unknown as SensorCalibration["intrinsic"],
  };
}

/** 逐元素近似比较(Float32 存原色会丢精度,如 0.7→0.6999…)。 */
function expectColors(out: Float32Array, expected: number[]) {
  expect(out.length).toBe(expected.length);
  expected.forEach((e, i) => expect(out[i]).toBeCloseTo(e, 5));
}

/** 造 w×h 的 RGBA buffer,fill 用 (px,py)→[r,g,b] 回调(0..255)。 */
function image(w: number, h: number, fill: (px: number, py: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const [r, g, b] = fill(px, py);
      const idx = (py * w + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return data;
}

describe("colorizePoints", () => {
  it("点投到像素 (0,0) 采到该像素颜色", () => {
    // cx=cy=0 ⇒ 点 (0,0,1) → u=0,v=0,depth=1 → 像素(0,0)。
    const cam: CameraSample = {
      calib: calib(0, 0),
      width: 2,
      height: 2,
      data: image(2, 2, (px, py) => (px === 0 && py === 0 ? [255, 0, 0] : [0, 0, 0])),
    };
    const out = colorizePoints(new Float32Array([0, 0, 1]), null, [cam]);
    expect(Array.from(out)).toEqual([1, 0, 0]);
  });

  it("相机后方 (depth<=0) 的点不被上色,回退原色", () => {
    const cam: CameraSample = {
      calib: calib(0, 0),
      width: 2,
      height: 2,
      data: image(2, 2, () => [255, 255, 255]),
    };
    const orig = new Float32Array([0.1, 0.2, 0.3]);
    const out = colorizePoints(new Float32Array([0, 0, -1]), orig, [cam]); // z<0 相机后方
    expectColors(out, [0.1, 0.2, 0.3]);
  });

  it("出框的点回退原色;无原色回退中性灰", () => {
    const cam: CameraSample = {
      calib: calib(0, 0),
      width: 2,
      height: 2,
      data: image(2, 2, () => [255, 255, 255]),
    };
    // 点 (5,5,1) → u=5,v=5 出框(>=2)。
    const out = colorizePoints(new Float32Array([5, 5, 1]), null, [cam]);
    expect(Array.from(out)).toEqual([0.5, 0.5, 0.5]);
  });

  it("无标定相机(空集)全部点取原色", () => {
    const orig = new Float32Array([0.7, 0.8, 0.9]);
    const out = colorizePoints(new Float32Array([0, 0, 1]), orig, []);
    expectColors(out, [0.7, 0.8, 0.9]);
  });

  it("多相机覆盖同点:取归一化中心距更小者的颜色", () => {
    // 点 (0,0,1)。相机 A: cx=cy=0 ⇒ 投到 (0,0) = 角点(中心距大)。
    // 相机 B: cx=cy=1 ⇒ 投到 (1,1) = 3x3 图正中(中心距 0)→ 应取 B 的绿色。
    const camA: CameraSample = {
      calib: calib(0, 0),
      width: 3,
      height: 3,
      data: image(3, 3, () => [255, 0, 0]), // 红
    };
    const camB: CameraSample = {
      calib: calib(1, 1),
      width: 3,
      height: 3,
      data: image(3, 3, () => [0, 255, 0]), // 绿
    };
    const out = colorizePoints(new Float32Array([0, 0, 1]), null, [camA, camB]);
    expect(Array.from(out)).toEqual([0, 1, 0]); // 取 B(更居中)
  });

  it("逐点独立:批量点各取各的颜色", () => {
    const cam: CameraSample = {
      calib: calib(0, 0),
      width: 2,
      height: 2,
      // (0,0)=红 (1,0)=绿 (0,1)=蓝 (1,1)=白
      data: image(2, 2, (px, py) => {
        if (px === 0 && py === 0) return [255, 0, 0];
        if (px === 1 && py === 0) return [0, 255, 0];
        if (px === 0 && py === 1) return [0, 0, 255];
        return [255, 255, 255];
      }),
    };
    // 点1→(0,0)红, 点2→(1,0)绿, 点3→(1,1)白
    const out = colorizePoints(new Float32Array([0, 0, 1, 1, 0, 1, 1, 1, 1]), null, [cam]);
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 1, 0, 1, 1, 1]);
  });
});
