import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { boxToMatrix4, psrToCorners } from "./box3d";

/** 把角点排成可比较的有序 [x,y,z] 元组列表 (按坐标字典序排序, 消除顺序差异)。 */
function sortedTuples(pts: THREE.Vector3[]): number[][] {
  return pts
    .map((p) => [p.x, p.y, p.z])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

function expectCornersClose(got: number[][], want: number[][]) {
  expect(got.length).toBe(want.length);
  got.forEach((g, i) => {
    expect(g[0]).toBeCloseTo(want[i][0]);
    expect(g[1]).toBeCloseTo(want[i][1]);
    expect(g[2]).toBeCloseTo(want[i][2]);
  });
}

describe("psrToCorners", () => {
  it("axis-aligned box: 8 corners are the (±l/2, ±w/2, ±h/2) combinations", () => {
    const corners = psrToCorners([0, 0, 0], [2, 4, 6], [0, 0, 0]);
    // size=[2,4,6] → 半边长 (±1, ±2, ±3) 的全 8 组合
    const want = sortedTuples(
      [
        [-1, -2, -3],
        [1, -2, -3],
        [1, 2, -3],
        [-1, 2, -3],
        [-1, -2, 3],
        [1, -2, 3],
        [1, 2, 3],
        [-1, 2, 3],
      ].map((c) => new THREE.Vector3(c[0], c[1], c[2])),
    );
    expectCornersClose(sortedTuples(corners), want);
  });

  it("yaw 90° about Z swaps x/y half-extents", () => {
    // 绕 Z 转 +90°: 局部 +x 轴 → 世界 +y, 局部 +y 轴 → 世界 -x。
    // size=[2,4,6] → 局部半边长 lx=1, ly=2, lz=3。
    // 转 90° 后, 沿世界 x 的半边长来自原局部 y (=2), 沿世界 y 的来自原局部 x (=1)。
    const corners = psrToCorners([0, 0, 0], [2, 4, 6], [0, 0, Math.PI / 2]);

    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const zs = corners.map((c) => c.z);
    expect(Math.max(...xs)).toBeCloseTo(2);
    expect(Math.min(...xs)).toBeCloseTo(-2);
    expect(Math.max(...ys)).toBeCloseTo(1);
    expect(Math.min(...ys)).toBeCloseTo(-1);
    expect(Math.max(...zs)).toBeCloseTo(3);
    expect(Math.min(...zs)).toBeCloseTo(-3);

    // 局部角点 0 = (-0.5,-0.5,-0.5) → 半边长 (-1,-2,-3) → 绕 Z+90°: (x,y)→(-y, x)
    // (-1,-2) → (2,-1), z 不变 = -3
    expect(corners[0].x).toBeCloseTo(2);
    expect(corners[0].y).toBeCloseTo(-1);
    expect(corners[0].z).toBeCloseTo(-3);
  });

  it("center offset translates all corners", () => {
    const center: [number, number, number] = [10, 20, 30];
    const base = psrToCorners([0, 0, 0], [2, 4, 6], [0, 0, 0]);
    const shifted = psrToCorners(center, [2, 4, 6], [0, 0, 0]);
    shifted.forEach((p, i) => {
      expect(p.x).toBeCloseTo(base[i].x + center[0]);
      expect(p.y).toBeCloseTo(base[i].y + center[1]);
      expect(p.z).toBeCloseTo(base[i].z + center[2]);
    });
  });
});

describe("boxToMatrix4 / psrToCorners consistency", () => {
  it("transforming unit-cube corners by boxToMatrix4 equals psrToCorners", () => {
    const center: [number, number, number] = [3, -5, 7];
    const size: [number, number, number] = [2, 4, 6];
    const rotation: [number, number, number] = [0.1, -0.4, 0.9];

    const m = boxToMatrix4(center, size, rotation);
    const unitCorners: [number, number, number][] = [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ];
    const viaMatrix = unitCorners.map((c) =>
      new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(m),
    );
    const viaPsr = psrToCorners(center, size, rotation);

    viaMatrix.forEach((p, i) => {
      expect(p.x).toBeCloseTo(viaPsr[i].x);
      expect(p.y).toBeCloseTo(viaPsr[i].y);
      expect(p.z).toBeCloseTo(viaPsr[i].z);
    });
  });
});
