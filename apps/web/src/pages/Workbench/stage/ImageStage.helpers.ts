// v0.16.x 第 2 批 · 从 ImageStage 提炼的纯几何函数(无 React/Konva,可单测)。
import type { Viewport } from "../state/useViewportTransform";

// client(视口像素)坐标 → 归一图坐标(0-1):逆 viewport 平移/缩放后再除图尺寸。
export function normalizeImageCoordinate(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  vp: Viewport,
  imgW: number,
  imgH: number,
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - vp.tx) / vp.scale / imgW,
    y: (clientY - rect.top - vp.ty) / vp.scale / imgH,
  };
}
