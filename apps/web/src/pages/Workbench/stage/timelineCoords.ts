// 时间轴帧 ↔ 百分比坐标换算的单一来源 (single source of truth)。
//
// v0.21.15 WS1: 从 VideoPlaybackOverlay 的 frameLeft / frameFromPointer / rangeStyle 三处内联
// 公式抽出, 先以固定窗口 {from:0, to:maxFrame} 注入 —— 此步纯重构, 零行为变更。WS2 起窗口可收窄为
// 可见帧子区间 (横向 zoom), 届时点位 / 区间刷选 / 密度条全部经此换算, 保证同一坐标基准。

/** 可见帧窗口 [from, to] (含端点)。全窗口即 {from:0, to:maxFrame}。 */
export interface TimelineWindow {
  from: number;
  to: number;
}

/**
 * 帧 → 沿可见窗口的百分比 [0..100]。窗口跨度 <=0 时返回 0
 * (与旧 `maxFrame > 0 ? … : 0` 分支等价, 避免除零)。
 */
export function frameToPct(frame: number, win: TimelineWindow): number {
  const span = win.to - win.from;
  return span > 0 ? ((frame - win.from) / span) * 100 : 0;
}

/**
 * 指针在轨道内的比例 [0..1] → 帧 (四舍五入, clamp 到窗口 [from, to])。
 * ratio 由调用方以 `(pointerX - rect.left) / rect.width` 算得, 允许越界 (超出即被 clamp)。
 */
export function pctToFrame(ratio: number, win: TimelineWindow): number {
  const span = win.to - win.from;
  const frame = win.from + ratio * span;
  return Math.max(win.from, Math.min(win.to, Math.round(frame)));
}
