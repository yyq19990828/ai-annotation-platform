// 归一化 [0,1] 坐标系下按 (offX, offY) 平移一个标注几何。各几何类型逐一处理, 顶点/中心 clamp 到 [0,1]。
// 原在 useClipboard.ts 内 (粘贴偏移用); v0.20.15 抽出供父子 Alt 拖动联动 (ImageStage) 复用同一套平移。
import type { Annotation, Geometry } from "@/types";

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function translatePoints(
  points: [number, number][],
  offX: number,
  offY: number,
): [number, number][] {
  return points.map(([x, y]) => [clamp01(x + offX), clamp01(y + offY)]);
}

export function translateGeometry(
  annotation: Annotation,
  offX: number,
  offY: number,
): { geometry: Geometry; annotationType: string } {
  const geometry = annotation.geometry;
  if (geometry?.type === "polygon") {
    return {
      annotationType: "polygon",
      geometry: {
        type: "polygon",
        points: translatePoints(geometry.points, offX, offY),
        holes: geometry.holes ? geometry.holes.map((ring) => translatePoints(ring, offX, offY)) : undefined,
      },
    };
  }
  if (geometry?.type === "multi_polygon") {
    return {
      annotationType: "polygon",
      geometry: {
        type: "multi_polygon",
        polygons: geometry.polygons.map((polygon) => ({
          type: "polygon",
          points: translatePoints(polygon.points, offX, offY),
          holes: polygon.holes ? polygon.holes.map((ring) => translatePoints(ring, offX, offY)) : undefined,
        })),
      },
    };
  }
  if (geometry?.type === "polyline") {
    return {
      annotationType: "polyline",
      geometry: {
        type: "polyline",
        points: translatePoints(geometry.points, offX, offY),
      },
    };
  }
  if (geometry?.type === "rotated_bbox") {
    return {
      annotationType: "rotated_bbox",
      geometry: {
        ...geometry,
        cx: clamp01(geometry.cx + offX),
        cy: clamp01(geometry.cy + offY),
      },
    };
  }
  if (geometry?.type === "keypoint") {
    return {
      annotationType: "keypoint",
      geometry: {
        type: "keypoint",
        points: geometry.points.map((point) => ({
          ...point,
          x: clamp01(point.x + offX),
          y: clamp01(point.y + offY),
        })),
      },
    };
  }
  if (geometry?.type === "bbox") {
    return {
      annotationType: "bbox",
      geometry: {
        type: "bbox",
        x: Math.max(0, Math.min(1 - geometry.w, geometry.x + offX)),
        y: Math.max(0, Math.min(1 - geometry.h, geometry.y + offY)),
        w: geometry.w,
        h: geometry.h,
      },
    };
  }
  if (annotation.polygon && annotation.polygon.length >= 3) {
    return {
      annotationType: "polygon",
      geometry: {
        type: "polygon",
        points: translatePoints(annotation.polygon, offX, offY),
      },
    };
  }
  return {
    annotationType: "bbox",
    geometry: {
      type: "bbox",
      x: Math.max(0, Math.min(1 - annotation.w, annotation.x + offX)),
      y: Math.max(0, Math.min(1 - annotation.h, annotation.y + offY)),
      w: annotation.w,
      h: annotation.h,
    },
  };
}
