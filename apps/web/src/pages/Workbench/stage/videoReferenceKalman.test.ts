import { describe, expect, it } from "vitest";
import { runReferenceKalman, type ReferenceKalmanKeyframe } from "./videoReferenceKalman";

/** 恒速线性外推(现状算法),仅用末两个关键帧,作为卡尔曼的对照基线。 */
function linearExtrapolateCx(keyframes: ReferenceKalmanKeyframe[], targetFrame: number): number {
  const k2 = keyframes[keyframes.length - 1];
  const k1 = keyframes[keyframes.length - 2];
  const span = Math.max(1, k2.frame - k1.frame);
  const dt = targetFrame - k2.frame;
  return k2.cx + ((k2.cx - k1.cx) / span) * dt;
}

/** 确定性伪随机(LCG),避免 Math.random 让测试不可复现。 */
function makeNoise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff - 0.5) * 2; // [-1, 1)
  };
}

describe("runReferenceKalman", () => {
  it("线性运动 + 噪声:卡尔曼平均误差比两点外推更小(平滑降方差)", () => {
    // 真值:cx 在 vx=0.01/帧 上恒速;两点外推只用末两个噪声样本估速度,方差大。
    // 单一种子上两点外推可能恰好走运,故对多种子求平均绝对误差对比(正确的统计论断)。
    const target = 24;
    const truth = 0.1 + 0.01 * target;
    let kfErr = 0;
    let linearErr = 0;
    const trials = 80;
    for (let seed = 1; seed <= trials; seed++) {
      const noise = makeNoise(seed * 2654435761);
      const keyframes: ReferenceKalmanKeyframe[] = [];
      for (let f = 0; f < 20; f++) {
        keyframes.push({ frame: f, cx: 0.1 + 0.01 * f + noise() * 0.006, cy: 0.5, w: 0.2, h: 0.2 });
      }
      kfErr += Math.abs(runReferenceKalman(keyframes, target, "stable").cx - truth);
      linearErr += Math.abs(linearExtrapolateCx(keyframes, target) - truth);
    }
    expect(kfErr / trials).toBeLessThan(linearErr / trials);
  });

  it("恒速序列:卡尔曼预测收敛到真实位置", () => {
    const keyframes: ReferenceKalmanKeyframe[] = [];
    for (let f = 0; f <= 10; f++) {
      keyframes.push({ frame: f, cx: 0.2 + 0.02 * f, cy: 0.4 - 0.01 * f, w: 0.15, h: 0.15 });
    }
    const kf = runReferenceKalman(keyframes, 15, "stable");
    // 真值:cx = 0.2 + 0.02*15 = 0.5;cy = 0.4 - 0.01*15 = 0.25。
    expect(kf.cx).toBeCloseTo(0.5, 2);
    expect(kf.cy).toBeCloseTo(0.25, 2);
    expect(kf.w).toBeCloseTo(0.15, 2);
  });

  it("阶跃突变:灵敏档比平稳档更紧跟最新关键帧", () => {
    // 前段稳定在 0.3,最后一个关键帧突跳到 0.5。
    const keyframes: ReferenceKalmanKeyframe[] = [
      { frame: 0, cx: 0.3, cy: 0.5, w: 0.2, h: 0.2 },
      { frame: 1, cx: 0.3, cy: 0.5, w: 0.2, h: 0.2 },
      { frame: 2, cx: 0.3, cy: 0.5, w: 0.2, h: 0.2 },
      { frame: 3, cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 },
    ];
    const stable = runReferenceKalman(keyframes, 4, "stable");
    const agile = runReferenceKalman(keyframes, 4, "agile");
    // 灵敏档信观测 → 更靠近 0.5;平稳档信模型 → 更被历史拖住。
    expect(agile.cx).toBeGreaterThan(stable.cx);
  });

  it("不确定度 σ:外推越远越大,且恒正(用于误差椭圆)", () => {
    const keyframes: ReferenceKalmanKeyframe[] = [];
    for (let f = 0; f <= 6; f++) {
      keyframes.push({ frame: f, cx: 0.2 + 0.02 * f, cy: 0.4, w: 0.15, h: 0.15 });
    }
    const near = runReferenceKalman(keyframes, 7, "stable");
    const far = runReferenceKalman(keyframes, 30, "stable");
    expect(near.sx).toBeGreaterThan(0);
    expect(near.sy).toBeGreaterThan(0);
    // 离最后一个关键帧越远,位置后验不确定度越大(Q 累积)。
    expect(far.sx).toBeGreaterThan(near.sx);
  });

  it("输出可被调用侧 clamp:不强制自身归一(预测可越界,由 clampGeom 收口)", () => {
    const keyframes: ReferenceKalmanKeyframe[] = [
      { frame: 0, cx: 0.8, cy: 0.5, w: 0.2, h: 0.2 },
      { frame: 1, cx: 0.9, cy: 0.5, w: 0.2, h: 0.2 },
    ];
    const kf = runReferenceKalman(keyframes, 10, "agile");
    // 恒速 0.1/帧外推到 frame 10 必然 > 1,函数本身不 clamp。
    expect(kf.cx).toBeGreaterThan(1);
  });
});
