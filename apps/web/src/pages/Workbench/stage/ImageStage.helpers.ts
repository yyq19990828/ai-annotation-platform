// v0.16.x 第 2 批 · 从 ImageStage 提炼的纯几何函数(无 React/Konva,可单测)。
import type { Annotation } from "@/types";
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

export function isNormalizedImagePoint(
  point: { x: number; y: number } | null,
): point is { x: number; y: number } {
  return !!point && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

// v0.20.14 · 父子同胞高亮的子框集: 恰好单选一个框时, 返回其直接子框 (parent_annotation_id ===
// 选中框 id); 多选/无选返回空 (环仅辅助看清单个父框的子框归属)。纯函数, 便于单测。
export function siblingHighlightChildren<T extends { parent_annotation_id?: string | null }>(
  boxes: T[],
  selectedId: string | null,
  selectionSize: number,
): T[] {
  const parentId = selectionSize === 1 ? selectedId : null;
  if (!parentId) return [];
  return boxes.filter((b) => b.parent_annotation_id === parentId);
}

/** raster_mask 由独立像素层渲染，不得落入矢量 KonvaBox 分支。 */
export function shouldRenderImageAnnotationShape(
  annotation: Pick<Annotation, "geometry">,
): boolean {
  return annotation.geometry?.type !== "raster_mask";
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
