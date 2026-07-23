/**
 * 视频参考框「完整卡尔曼滤波」运动预测(纯函数,无 React / 无后端依赖)。
 *
 * 现状的恒速外推只用末两个关键帧,单段噪声直接放大。这里改为遍历当前帧之前
 * **所有**可见关键帧做前向滤波(predict→update),得到平滑后验,再外推到当前帧。
 *
 * 状态向量 `[cx, cy, w, h, vx, vy, vw, vh]` 在恒速模型下四维互不耦合,F/Q/R/P 块对角,
 * 等价于 4 个独立的 1D 恒速卡尔曼(位置 + 变化率),无需 8×8 矩阵求逆——观测是标量,
 * 创新协方差 S 也是标量,增益闭式可算。详见 docs/plans/archive/2026-06-22-v0.17.14-video-reference-kalman.md。
 */
import type { VideoReferencePreset } from "./videoReferencePredict";

/** 中心化关键帧观测(left-top → center 在调用侧转好)。 */
export interface ReferenceKalmanKeyframe {
  frame: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** 末段预测到目标帧后的中心化结果(left-top 转换在调用侧做)。 */
export interface ReferenceKalmanResult {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** 末段预测后各维位置后验标准差(√P00,归一化坐标)——预测不确定度,随外推距离增长。 */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** 过程噪声(白噪声加速度谱密度)/ 观测噪声方差,归一化坐标系下的经验值。 */
interface NoiseParams {
  /** 中心(cx/cy)过程噪声谱密度。 */
  qPos: number;
  /** 尺寸(w/h)过程噪声谱密度(尺寸通常更稳,取更小)。 */
  qSize: number;
  /** 观测噪声方差(关键帧落点抖动)。 */
  r: number;
}

// q/r 比值驱动行为:比值小 → 信模型(平稳、抗噪、跟突变慢);比值大 → 信观测(灵敏、紧跟)。
const PRESETS: Record<VideoReferencePreset, NoiseParams> = {
  stable: { qPos: 1e-6, qSize: 2.5e-7, r: 1e-4 },
  agile: { qPos: 1e-4, qSize: 2.5e-5, r: 1e-5 },
};

// 初值协方差:位置按观测可信(≈r),速度不确定度给大,让滤波在前几帧自行收敛。
const POS_VAR0 = 1e-4;
const VEL_VAR0 = 1e-3;

interface Filter1D {
  p: number;
  v: number;
  P00: number;
  P01: number;
  P11: number;
}

function makeFilter(p0: number, v0: number): Filter1D {
  return { p: p0, v: v0, P00: POS_VAR0, P01: 0, P11: VEL_VAR0 };
}

/** 预测步:F=[[1,dt],[0,1]],P = F P Fᵀ + Q(dt)(连续白噪声加速度模型)。 */
function predict(f: Filter1D, dt: number, q: number): void {
  f.p += f.v * dt;
  const P00 = f.P00 + dt * (2 * f.P01 + dt * f.P11);
  const P01 = f.P01 + dt * f.P11;
  const P11 = f.P11;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  f.P00 = P00 + (q * dt3) / 3;
  f.P01 = P01 + (q * dt2) / 2;
  f.P11 = P11 + q * dt;
}

/** 更新步:观测标量 z(H=[1,0]),创新协方差 S=P00+r,增益 K=[P00/S, P01/S]。 */
function update(f: Filter1D, z: number, r: number): void {
  const S = f.P00 + r;
  const k0 = f.P00 / S;
  const k1 = f.P01 / S;
  const y = z - f.p;
  f.p += k0 * y;
  f.v += k1 * y;
  // P = (I - K H) P(对称性保持:P01' = (1-k0)P01 = P01 - k1·P00)。
  const P00 = f.P00;
  const P01 = f.P01;
  f.P00 = P00 - k0 * P00;
  f.P01 = P01 - k0 * P01;
  f.P11 = f.P11 - k1 * P01;
}

/**
 * 对当前帧之前(升序、长度 ≥ 2)的可见关键帧做前向滤波,再预测到 targetFrame。
 *
 * 调用侧保证 keyframes 已中心化、已按 frame 升序、长度 ≥ 2(不足两个回退最近关键帧)。
 */
export function runReferenceKalman(
  keyframes: ReferenceKalmanKeyframe[],
  targetFrame: number,
  preset: VideoReferencePreset,
): ReferenceKalmanResult {
  const { qPos, qSize, r } = PRESETS[preset];
  const k0 = keyframes[0];
  const k1 = keyframes[1];
  const span = Math.max(1, k1.frame - k0.frame);

  const dims = [
    {
      get: (kf: ReferenceKalmanKeyframe) => kf.cx,
      q: qPos,
      f: makeFilter(k0.cx, (k1.cx - k0.cx) / span),
    },
    {
      get: (kf: ReferenceKalmanKeyframe) => kf.cy,
      q: qPos,
      f: makeFilter(k0.cy, (k1.cy - k0.cy) / span),
    },
    {
      get: (kf: ReferenceKalmanKeyframe) => kf.w,
      q: qSize,
      f: makeFilter(k0.w, (k1.w - k0.w) / span),
    },
    {
      get: (kf: ReferenceKalmanKeyframe) => kf.h,
      q: qSize,
      f: makeFilter(k0.h, (k1.h - k0.h) / span),
    },
  ];

  for (let i = 1; i < keyframes.length; i++) {
    const dt = Math.max(1, keyframes[i].frame - keyframes[i - 1].frame);
    for (const d of dims) {
      predict(d.f, dt, d.q);
      update(d.f, d.get(keyframes[i]), r);
    }
  }

  const dtFinal = Math.max(0, targetFrame - keyframes[keyframes.length - 1].frame);
  for (const d of dims) predict(d.f, dtFinal, d.q);

  return {
    cx: dims[0].f.p,
    cy: dims[1].f.p,
    w: dims[2].f.p,
    h: dims[3].f.p,
    sx: Math.sqrt(Math.max(0, dims[0].f.P00)),
    sy: Math.sqrt(Math.max(0, dims[1].f.P00)),
    sw: Math.sqrt(Math.max(0, dims[2].f.P00)),
    sh: Math.sqrt(Math.max(0, dims[3].f.P00)),
  };
}
