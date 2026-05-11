import type { Annotation, AnnotationResponse, BboxGeometry, Geometry, MultiPolygonGeometry, PolygonGeometry, PredictionResponse } from "@/types";

/** 把 {x,y,w,h} 包装为 bbox geometry。常用于 commit 几何变更时。 */
export function bboxGeom(g: { x: number; y: number; w: number; h: number }): BboxGeometry {
  return { type: "bbox", x: g.x, y: g.y, w: g.w, h: g.h };
}

export function polygonGeom(points: [number, number][]): PolygonGeometry {
  return { type: "polygon", points };
}

/** 计算 polygon 顶点的轴对齐包围盒（归一化）。 */
export function polygonBounds(points: [number, number][]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0][0], maxX = points[0][0];
  let minY = points[0][1], maxY = points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

/**
 * v0.9.14 · 多连通域 polygons 的合并 bounding rect（取所有 polygon 外环顶点的 union AABB）。
 */
function multiPolygonBounds(
  polygons: PolygonGeometry[],
): { x: number; y: number; w: number; h: number } {
  if (polygons.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygons) {
    for (const [px, py] of p.points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

/** v0.9.14 · 多 polygon 中按外环顶点数取最大者作为渲染主环（与单 polygon 编辑路径兼容）。 */
function pickPrimaryPolygon(g: MultiPolygonGeometry): PolygonGeometry {
  let best = g.polygons[0];
  for (let i = 1; i < g.polygons.length; i++) {
    if (g.polygons[i].points.length > best.points.length) best = g.polygons[i];
  }
  return best;
}

/** Geometry → 用于 UI 渲染的 bounding rect + 可选 polygon 顶点 + holes / multiPolygon 透传。
 *
 * v0.9.14 · 多连通域降级策略: ImageStage 编辑路径仅识别单环 polygon, 多连通时取顶点数最多的
 * 主外环作为 `polygon` 字段, 完整 polygons 数组同时挂在 `multiPolygon` 上供 v0.10.x 镂空
 * 渲染升级使用. holes 字段也从 PolygonGeometry 透传, 暂不参与渲染 (v0.10.x 引入 sceneFunc
 * + evenodd 时启用).
 */
export function geometryToShape(g: Geometry): {
  x: number;
  y: number;
  w: number;
  h: number;
  polygon?: [number, number][];
  holes?: [number, number][][];
  multiPolygon?: { points: [number, number][]; holes?: [number, number][][] }[];
} {
  if (g.type === "polygon") {
    const b = polygonBounds(g.points);
    return { ...b, polygon: g.points, holes: g.holes };
  }
  if (g.type === "multi_polygon") {
    const primary = pickPrimaryPolygon(g);
    const b = multiPolygonBounds(g.polygons);
    return {
      ...b,
      polygon: primary.points,
      holes: primary.holes,
      multiPolygon: g.polygons.map((p) => ({ points: p.points, holes: p.holes })),
    };
  }
  if (g.type === "video_bbox") {
    return { x: g.x, y: g.y, w: g.w, h: g.h };
  }
  if (g.type === "video_track") {
    const keyframe = g.keyframes.find((kf) => !kf.absent) ?? g.keyframes[0];
    return keyframe?.bbox ?? { x: 0, y: 0, w: 0, h: 0 };
  }
  return { x: g.x, y: g.y, w: g.w, h: g.h };
}

export function annotationToBox(a: AnnotationResponse): Annotation {
  const shape = geometryToShape(a.geometry);
  return {
    id: a.id,
    ...shape,
    cls: a.class_name,
    conf: a.confidence ?? 1,
    source: a.source as Annotation["source"],
    parent_prediction_id: a.parent_prediction_id,
    lead_time: a.lead_time,
  };
}

export type AiBox = Annotation & { predictionId: string; shapeIndex: number };

export function predictionsToBoxes(predictions: PredictionResponse[]): AiBox[] {
  return predictions.flatMap((p) =>
    p.result.map((shape, i) => {
      const s = geometryToShape(shape.geometry);
      return {
        id: `pred-${p.id}-${i}`,
        predictionId: p.id,
        shapeIndex: i,
        ...s,
        cls: shape.class_name,
        conf: shape.confidence,
        source: "prediction_based" as const,
      };
    }),
  );
}
