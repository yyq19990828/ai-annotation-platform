// v0.16.x 第 2 批 · 从 ImageStage 提炼的纯几何函数(无 React/Konva,可单测)。
import type { Viewport } from "../state/useViewportTransform";
import type { Pt } from "./polygonGeom";
import {
  snapPointToCandidates,
  snapPointToSegments,
  type SnapMatch,
  type SnapPointCandidate,
  type SnapSegmentCandidate,
  type SnapViewportTransform,
} from "./shared/geometry/snap";

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

// 取点吸附 / 线段吸附中距离更近者(阈值内)。从 ImageStage.findSnapMatch 提炼;
// wrapper 仍负责 altKey/imgW 守卫、transform 构造与 excludeAnnotationId 过滤。
export function resolveSnapMatch(
  point: Pt,
  candidates: {
    points: readonly SnapPointCandidate[];
    segments: readonly SnapSegmentCandidate[];
  },
  thresholdPx: number,
  transform: SnapViewportTransform,
): SnapMatch | null {
  const pointMatch = snapPointToCandidates(point, candidates.points, thresholdPx, transform);
  const segmentMatch = snapPointToSegments(point, candidates.segments, thresholdPx, transform);
  if (!pointMatch) return segmentMatch;
  if (!segmentMatch) return pointMatch;
  return pointMatch.distancePx <= segmentMatch.distancePx ? pointMatch : segmentMatch;
}
