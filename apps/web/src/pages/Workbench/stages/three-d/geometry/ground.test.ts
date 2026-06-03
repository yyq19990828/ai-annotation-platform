import { describe, it, expect } from "vitest";

import { estimateGroundZ } from "./ground";

/** N 个 (x,y,z) 拼成 Float32Array;x/y 任意,函数只看 z。 */
function pcd(zs: number[]): Float32Array {
  const a = new Float32Array(zs.length * 3);
  zs.forEach((z, i) => {
    a[3 * i + 2] = z;
  });
  return a;
}

describe("estimateGroundZ", () => {
  it("空点集返回 0", () => {
    expect(estimateGroundZ(new Float32Array(0), 0)).toBe(0);
  });

  it("同一高度的点集返回该高度", () => {
    const zs = Array.from({ length: 1000 }, () => -2.5);
    expect(estimateGroundZ(pcd(zs), zs.length)).toBeCloseTo(-2.5, 5);
  });

  it("均匀分布 → 中位数 ≈ 范围中点(直方图 bin 中心精度)", () => {
    const zs: number[] = [];
    for (let i = 0; i < 1000; i++) zs.push(-5 + (10 * i) / 999); // -5 ~ 5 均匀
    const out = estimateGroundZ(pcd(zs), zs.length);
    expect(out).toBeCloseTo(0, 1); // 容差 ~ span/BINS = 10/128 ≈ 0.08
  });

  it("低端噪声不下拉(关键回归):1 个极低离群点 + 大量集中高度,结果仍贴近主体", () => {
    // 1% 分位算法会落到 -50;中位数算法贴 -3。
    const zs: number[] = [-50];
    for (let i = 0; i < 999; i++) zs.push(-3); // 集中在 -3
    const out = estimateGroundZ(pcd(zs), zs.length);
    // 1 个噪声点占比 < 1%, 中位数应落到 -3 附近(BIN 离散精度容差)。
    expect(out).toBeCloseTo(-3, 0); // span=47, bin 宽 ≈ 0.37 → 容差放到 ±0.5
    expect(out).toBeGreaterThan(-4);
  });

  it("地物 + 真地面双峰(车顶 lidar 典型):下半地面 + 上半建筑,中位数靠下", () => {
    // 700 点在 z∈[-4, -3.5] (地面薄层); 300 点在 z∈[0, 3] (远处建筑)。
    const zs: number[] = [];
    for (let i = 0; i < 700; i++) zs.push(-4 + 0.5 * (i / 699)); // 地面
    for (let i = 0; i < 300; i++) zs.push(0 + 3 * (i / 299)); // 建筑
    const out = estimateGroundZ(pcd(zs), zs.length);
    // 累计到 500/1000 时还在地面 bin (前 700 个全是地面),故落地面附近。
    expect(out).toBeGreaterThan(-4);
    expect(out).toBeLessThan(-3); // 在 [-4, -3.5] 子区间
  });

  it("无噪声单值范围(zMin == zMax)走 span <= 0 兜底", () => {
    const zs = [1.5, 1.5, 1.5];
    expect(estimateGroundZ(pcd(zs), zs.length)).toBeCloseTo(1.5, 5);
  });
});
