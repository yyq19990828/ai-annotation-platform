import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { boxAxisWorldDir } from "./box3d";
import {
  VIEW_AXES,
  MIN_SIZE,
  dragEdge,
  dragCorner,
  dragRotation,
  type Psr,
} from "./triview";

const base: Psr = {
  center: [0, 0, 0],
  size: [4, 2, 1.5],
  rotation: [0, 0, 0],
};

describe("VIEW_AXES", () => {
  it("每视图 u/v/normal 是 {0,1,2} 的一个排列 (不重叠)", () => {
    for (const view of ["top", "side", "front"] as const) {
      const { u, v, normal } = VIEW_AXES[view];
      expect(new Set([u, v, normal]).size).toBe(3);
    }
  });
});

describe("dragEdge · 半/全边长口径", () => {
  it("Top 拖 +X 边 +0.5m → size[0]=4.5 (全边长, 非 SUSTech 半边长的 5.0)", () => {
    const r = dragEdge(base, 0, 1, 0.5);
    expect(r.size[0]).toBeCloseTo(4.5); // 全边长直接 +0.5; 若误用半边长口径会得 5.0
    expect(r.size[1]).toBeCloseTo(2); // 其余维不变
    expect(r.size[2]).toBeCloseTo(1.5);
    expect(r.center[0]).toBeCloseTo(0.25); // 中心沿 +X 移半程
    expect(r.center[1]).toBeCloseTo(0);
    expect(r.center[2]).toBeCloseTo(0);
    expect(r.rotation).toEqual([0, 0, 0]);
  });

  it("拖 -X 边 +0.5m (往里推) → size 减 0.5, 中心朝 +X 移 0.25 (对侧 +X 固定)", () => {
    const r = dragEdge(base, 0, -1, 0.5);
    expect(r.size[0]).toBeCloseTo(3.5);
    expect(r.center[0]).toBeCloseTo(0.25);
  });

  it("clamp: 把 X 边往里推超过本身尺寸 → 收敛到 MIN_SIZE", () => {
    const r = dragEdge(base, 0, 1, -100);
    expect(r.size[0]).toBeCloseTo(MIN_SIZE);
  });

  it("旋转后中心沿世界轴移动: yaw 90° 时 local +X 世界方向 = +Y", () => {
    const yawed: Psr = { ...base, rotation: [0, 0, Math.PI / 2] };
    const r = dragEdge(yawed, 0, 1, 0.5);
    expect(r.center[0]).toBeCloseTo(0); // 不再沿世界 X
    expect(r.center[1]).toBeCloseTo(0.25); // 沿世界 Y
  });
});

describe("dragCorner", () => {
  it("Top 拖 (+X,+Y) 角 各 +0.4m → 两维尺寸各 +0.4, 中心各移半程", () => {
    const r = dragCorner(base, 0, 1, 0.4, 1, 1, 0.4);
    expect(r.size[0]).toBeCloseTo(4.4);
    expect(r.size[1]).toBeCloseTo(2.4);
    expect(r.size[2]).toBeCloseTo(1.5);
    expect(r.center[0]).toBeCloseTo(0.2);
    expect(r.center[1]).toBeCloseTo(0.2);
  });
});

describe("dragRotation · 三轴 yaw/pitch/roll", () => {
  it("Top 纯 yaw: rotation[2] 增量, 其余轴不动", () => {
    const start: Psr = { ...base, rotation: [0, 0, 0.3] };
    const r = dragRotation(start, "top", 0.2);
    expect(r.rotation[0]).toBeCloseTo(0);
    expect(r.rotation[1]).toBeCloseTo(0);
    expect(r.rotation[2]).toBeCloseTo(0.5);
    expect(r.size).toEqual(base.size); // 旋转不改尺寸 / 中心
    expect(r.center).toEqual(base.center);
  });

  it.each([
    ["top", 2],
    ["side", 1],
    ["front", 0],
  ] as const)("round-trip: %s 转 dθ 再转 -dθ 复原 (含非零起始姿态)", (view, _axis) => {
    const start: Psr = { ...base, rotation: [0.15, -0.25, 0.35] };
    const there = dragRotation(start, view, 0.3);
    const back = dragRotation(there, view, -0.3);
    // 经四元数往返, 欧拉分量应复原 (用四元数比较避免欧拉多解歧义)。
    const q0 = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...start.rotation, "XYZ"),
    );
    const q1 = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...back.rotation, "XYZ"),
    );
    expect(Math.abs(q0.dot(q1))).toBeCloseTo(1); // 同一朝向 (dot=±1)
  });

  it("非零 pitch 起调 yaw 不串轴: 绕 local Z 转 → Z 轴方向不变, X 轴方向转过 dθ", () => {
    const start: Psr = { ...base, rotation: [0, 0.4, 0] }; // 已有 pitch
    const dTheta = 0.25;
    const r = dragRotation(start, "top", dTheta); // top → 绕 local Z

    const zBefore = boxAxisWorldDir(start.rotation, 2);
    const zAfter = boxAxisWorldDir(r.rotation, 2);
    expect(zAfter.angleTo(zBefore)).toBeCloseTo(0); // 旋转轴方向不变

    const xBefore = boxAxisWorldDir(start.rotation, 0);
    const xAfter = boxAxisWorldDir(r.rotation, 0);
    expect(xAfter.angleTo(xBefore)).toBeCloseTo(dTheta); // X 轴恰转过 dθ
  });
});
