import type { Annotation, AnnotationResponse, BboxGeometry, Geometry, PolygonGeometry, PredictionResponse } from "@/types";

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

/** Geometry → 用于 UI 渲染的 bounding rect + 可选 polygon 顶点。 */
export function geometryToShape(g: Geometry): { x: number; y: number; w: number; h: number; polygon?: [number, number][] } {
  if (g.type === "polygon") {
    const b = polygonBounds(g.points);
    return { ...b, polygon: g.points };
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

export type AiBox = Annotation & { predictionId: string };

export function predictionsToBoxes(predictions: PredictionResponse[]): AiBox[] {
  return predictions.flatMap((p) =>
    p.result.map((shape, i) => {
      const s = geometryToShape(shape.geometry);
      return {
        id: `pred-${p.id}-${i}`,
        predictionId: p.id,
        ...s,
        cls: shape.class_name,
        conf: shape.confidence,
        source: "prediction_based" as const,
      };
    }),
  );
}
