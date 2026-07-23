import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { cullPointsInBoxes, type CullBox } from "./cullDynamicPoints";

const I = () => new THREE.Matrix4();
// 边长 2 → 半边长 1,中心在原点的轴对齐框。
const unitBoxAtOrigin: CullBox = {
  center: [0, 0, 0],
  size: [2, 2, 2],
  rotation: [0, 0, 0],
};

describe("cullPointsInBoxes", () => {
  it("空 boxes 原样返回(零剔除)", () => {
    const pts = new Float32Array([0, 0, 0, 5, 5, 5]);
    const r = cullPointsInBoxes(pts, I(), []);
    expect(r.culledCount).toBe(0);
    expect(r.kept).toBe(pts); // 同引用,未拷贝
  });

  it("框内点剔除、框外点保留", () => {
    const pts = new Float32Array([0, 0, 0 /* 内 */, 5, 0, 0 /* 外 */]);
    const r = cullPointsInBoxes(pts, I(), [unitBoxAtOrigin]);
    expect(r.culledCount).toBe(1);
    expect(Array.from(r.kept)).toEqual([5, 0, 0]);
  });

  it("混合点集只剔框内点,保留顺序不变", () => {
    const pts = new Float32Array([
      0, 0, 0 /* 内 */, 5, 0, 0 /* 外 */, 0.5, 0.5, 0.5 /* 内 */, 9, 9, 9 /* 外 */,
    ]);
    const r = cullPointsInBoxes(pts, I(), [unitBoxAtOrigin]);
    expect(r.culledCount).toBe(2);
    expect(Array.from(r.kept)).toEqual([5, 0, 0, 9, 9, 9]);
  });

  it("旋转改变判定:(1.2,0,0) 在轴对齐框外、在 45° 旋转框内", () => {
    // 半边长 1 的框:沿世界 X 轴 1.2 在轴对齐框外(1.2>1);
    // 绕 Z 转 45° 后框的对角朝向世界轴,(1.2,0,0) 落入菱形足迹内。
    const pt = new Float32Array([1.2, 0, 0]);
    const aa: CullBox = { center: [0, 0, 0], size: [2, 2, 2], rotation: [0, 0, 0] };
    const rot: CullBox = {
      center: [0, 0, 0],
      size: [2, 2, 2],
      rotation: [0, 0, Math.PI / 4],
    };
    expect(cullPointsInBoxes(pt, I(), [aa]).culledCount).toBe(0);
    expect(cullPointsInBoxes(pt, I(), [rot]).culledCount).toBe(1);
  });

  it("margin 放宽剔除区", () => {
    const pt = new Float32Array([1.2, 0, 0]); // 半边长 1 外、1.5 内
    expect(cullPointsInBoxes(pt, I(), [unitBoxAtOrigin]).culledCount).toBe(0);
    expect(cullPointsInBoxes(pt, I(), [unitBoxAtOrigin], { margin: 0.5 }).culledCount).toBe(1);
  });

  it("先施加 relMatrix 再判定:对齐到当前帧后落框内才剔", () => {
    const pt = new Float32Array([0, 0, 0]);
    const rel = new THREE.Matrix4().makeTranslation(10, 0, 0); // 邻帧原点 → 当前帧 (10,0,0)
    const boxAtTen: CullBox = { center: [10, 0, 0], size: [2, 2, 2], rotation: [0, 0, 0] };
    const boxAtOrigin: CullBox = { center: [0, 0, 0], size: [2, 2, 2], rotation: [0, 0, 0] };
    // 对齐后到 (10,0,0):在 boxAtTen 内 → 剔;在 boxAtOrigin 外 → 留。
    expect(cullPointsInBoxes(pt, rel, [boxAtTen]).culledCount).toBe(1);
    const keptCase = cullPointsInBoxes(pt, rel, [boxAtOrigin]);
    expect(keptCase.culledCount).toBe(0);
    // 保留的是原始 ISO ego 坐标 (0,0,0),不是对齐后的坐标。
    expect(Array.from(keptCase.kept)).toEqual([0, 0, 0]);
  });

  it("多框任一命中即剔", () => {
    const pts = new Float32Array([
      3, 0, 0 /* 在 boxB 内 */, 0, 0, 0 /* 在 boxA 内 */, 8, 8, 8 /* 都不在 */,
    ]);
    const boxA: CullBox = { center: [0, 0, 0], size: [2, 2, 2], rotation: [0, 0, 0] };
    const boxB: CullBox = { center: [3, 0, 0], size: [2, 2, 2], rotation: [0, 0, 0] };
    const r = cullPointsInBoxes(pts, I(), [boxA, boxB]);
    expect(r.culledCount).toBe(2);
    expect(Array.from(r.kept)).toEqual([8, 8, 8]);
  });
});
