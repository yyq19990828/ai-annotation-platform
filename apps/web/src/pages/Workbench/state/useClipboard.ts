import { useCallback } from "react";
import type { Annotation, AnnotationResponse, Geometry } from "@/types";
import type { AnnotationPayload } from "@/api/tasks";

interface UseClipboardArgs {
  userBoxes: Annotation[];
  selectedIds: string[];
  clipboard: Annotation[];
  setClipboard: (b: Annotation[]) => void;
  createAnnotation: (payload: AnnotationPayload) => Promise<AnnotationResponse>;
  pushBatch: (cmds: { kind: "create"; annotationId: string; payload: AnnotationPayload }[]) => void;
  /** 已落库后回选这些新框（用于"粘贴后即选中副本"语义）。 */
  setSelectedIds?: (ids: string[]) => void;
  imgW: number;
  imgH: number;
}

const PIXEL_OFFSET = 10;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function translatePoints(
  points: [number, number][],
  offX: number,
  offY: number,
): [number, number][] {
  return points.map(([x, y]) => [clamp01(x + offX), clamp01(y + offY)]);
}

function translateGeometry(
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

/** 把 Annotation 列表按 (+10px, +10px) 偏移粘贴到当前任务，落库后 batch 进 history。 */
export function useClipboard({
  userBoxes, selectedIds, clipboard, setClipboard,
  createAnnotation, pushBatch, setSelectedIds, imgW, imgH,
}: UseClipboardArgs) {
  const offX = imgW > 0 ? PIXEL_OFFSET / imgW : 0;
  const offY = imgH > 0 ? PIXEL_OFFSET / imgH : 0;

  const copyAnnotations = useCallback((targets: Annotation[]) => {
    if (targets.length === 0) return 0;
    setClipboard(targets);
    return targets.length;
  }, [setClipboard]);

  const copySelection = useCallback(() => {
    if (selectedIds.length === 0) return 0;
    const targets = userBoxes.filter((b) => selectedIds.includes(b.id));
    return copyAnnotations(targets);
  }, [copyAnnotations, selectedIds, userBoxes]);

  const pasteFrom = useCallback(async (sources: Annotation[]) => {
    if (sources.length === 0) return [];
    const cmds: { kind: "create"; annotationId: string; payload: AnnotationPayload }[] = [];
    const newIds: string[] = [];
    for (const b of sources) {
      const { geometry, annotationType } = translateGeometry(b, offX, offY);
      const payload: AnnotationPayload = {
        annotation_type: annotationType,
        class_name: b.cls,
        geometry,
        confidence: 1,
      };
      try {
        const created = await createAnnotation(payload);
        cmds.push({ kind: "create", annotationId: created.id, payload });
        newIds.push(created.id);
      } catch { /* 单条失败不阻塞其他 */ }
    }
    if (cmds.length > 0) pushBatch(cmds);
    if (newIds.length > 0) setSelectedIds?.(newIds);
    return newIds;
  }, [offX, offY, createAnnotation, pushBatch, setSelectedIds]);

  /** Ctrl+V：从 clipboard 粘贴。 */
  const paste = useCallback(() => pasteFrom(clipboard), [pasteFrom, clipboard]);

  /** Ctrl+D：原地复制当前选中（不消费/写入 clipboard）。 */
  const duplicateSelection = useCallback(() => {
    const targets = userBoxes.filter((b) => selectedIds.includes(b.id));
    return pasteFrom(targets);
  }, [userBoxes, selectedIds, pasteFrom]);

  return { copySelection, copyAnnotations, paste, duplicateSelection, hasClipboard: clipboard.length > 0 };
}
