import type { BboxGeometry, Geometry } from "@/types";

/**
 * 当前单环顶点编辑器无法原子更新内环或多个外环。这类几何必须保留为只读画布形状，
 * 否则提交单个 `points` 会把完整 geometry 降级成无孔的 polygon。
 */
export function isComplexPolygonGeometry(geometry: Geometry | null | undefined): boolean {
  if (!geometry) return false;
  if (geometry.type === "multi_polygon") return true;
  return geometry.type === "polygon" && (geometry.holes?.length ?? 0) > 0;
}

/** 单环 polygon 才能进入现有的 points-only 顶点/整体拖动编辑器。 */
export function supportsSingleRingPolygonEdit(geometry: Geometry | null | undefined): boolean {
  return geometry?.type === "polygon" && !isComplexPolygonGeometry(geometry);
}

/**
 * 方向键 nudge 的既有暂存/提交结构只有 x/y/w/h，不能承载 polygon 系几何。
 * 调用方必须先用此门收窄，禁止把 polygon 强转成 bbox 后覆盖落库。
 */
export function supportsBBoxNudge(geometry: Geometry | null | undefined): geometry is BboxGeometry {
  return geometry?.type === "bbox";
}
