import { useCallback } from "react";
import type { Annotation, AnnotationResponse } from "@/types";
import type { AnnotationPayload } from "@/api/tasks";
import { translateGeometry } from "./geometryTranslate";

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
