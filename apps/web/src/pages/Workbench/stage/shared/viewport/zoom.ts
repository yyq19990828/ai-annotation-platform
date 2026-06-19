import type { Viewport } from "../useViewportTransform";

/**
 * 公共 viewport 原语 · 缩放(纯计算)。
 *
 * v0.16.x 画布栈统一地基:把「围绕光标定点缩放」与「缩放上下限」从 ImageStage(`onWheel`)
 * 与 useViewportTransform(`zoomAt` / `MIN_SCALE`/`MAX_SCALE`)的各自内联实现收口成单一来源。
 * 滚轮 deltaY → 缩放因子的映射保留在 imageStageSettings.wheelZoomFactor(已有单测),
 * 本模块只负责「给定目标 scale,围绕屏幕定点求新 vp」与范围 clamp。
 */

/** 缩放上下限(屏幕缩放比)。原 ImageStage `Math.min(8, Math.max(0.2, …))` 与
 *  useViewportTransform `MIN_SCALE=0.2 / MAX_SCALE=8` 两份重复常量的单一来源。 */
export const SCALE_RANGE = { min: 0.2, max: 8 } as const;

export interface ScaleRange {
  min: number;
  max: number;
}

export function clampScale(scale: number, range: ScaleRange = SCALE_RANGE): number {
  return Math.min(range.max, Math.max(range.min, scale));
}

/**
 * 围绕屏幕定点缩放:把当前 vp 调到 `nextScale`(先 clamp 到 range),并平移使屏幕点
 * (cx, cy)(相对 Stage 容器左上的像素坐标)处的世界点保持不动。
 * clamp 后 scale 未变则原样返回(不产生无意义的新对象 / 抖动)。
 */
export function zoomAtPoint(
  vp: Viewport,
  cx: number,
  cy: number,
  nextScale: number,
  range: ScaleRange = SCALE_RANGE,
): Viewport {
  const scale = clampScale(nextScale, range);
  if (scale === vp.scale) return vp;
  const ratio = scale / vp.scale;
  return {
    scale,
    tx: cx - (cx - vp.tx) * ratio,
    ty: cy - (cy - vp.ty) * ratio,
  };
}
