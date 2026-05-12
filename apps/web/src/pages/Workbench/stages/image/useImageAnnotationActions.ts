import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Annotation, AnnotationResponse, PredictionResponse } from "@/types";
import type { AnnotationPayload } from "@/api/tasks";
import { useAcceptPrediction } from "@/hooks/usePredictions";
import { buildIoUIndex } from "../../stage/iou-index";
import { iouShape } from "../../stage/iou";
import type { useAnnotationHistory } from "../../state/useAnnotationHistory";
import type { UseInteractiveAIReturn } from "../../state/useInteractiveAI";
import { geometryToShape, polygonBounds, predictionsToBoxes, type AiBox } from "../../state/transforms";
import { useClipboard } from "../../state/useClipboard";
import {
  useWorkbenchAnnotationActions,
  type AnnotationMutations,
} from "../../state/useWorkbenchAnnotationActions";
import type { useWorkbenchState } from "../../state/useWorkbenchState";

type Geom = { x: number; y: number; w: number; h: number };
type StageGeometry = { imgW: number; imgH: number; vpSize: { w: number; h: number } };

interface ToastInput {
  msg: string;
  sub?: string;
  kind?: "success" | "warning" | "error" | "";
}

interface UseImageAnnotationActionsArgs {
  taskId: string | undefined;
  projectId: string | undefined;
  meUserId: string | null | undefined;
  queryClient: QueryClient;
  history: ReturnType<typeof useAnnotationHistory>;
  s: ReturnType<typeof useWorkbenchState>;
  pushToast: (toast: ToastInput) => void;
  recordRecentClass: (cls: string) => void;
  annotationsData: AnnotationResponse[] | undefined;
  annotationsRef: { current: AnnotationResponse[] };
  predictionsData: PredictionResponse[];
  userBoxes: Annotation[];
  stageGeom: StageGeometry;
  iouDedupThreshold: number;
  classes: string[];
  sam: UseInteractiveAIReturn;
  createAnnotationAsync: (payload: AnnotationPayload) => Promise<AnnotationResponse>;
  mutations: AnnotationMutations;
  enqueueOnError: (err: unknown, fallback: () => void) => void;
  isLocked?: boolean;
}

export function getBatchChangeTarget(
  selectedIds: string[],
  userBoxes: Annotation[],
): { geom: Geom; className: string; count: number } | null {
  const firstId = selectedIds[0];
  const firstBox = userBoxes.find((box) => box.id === firstId);
  if (!firstBox) return null;
  return {
    geom: { x: firstBox.x, y: firstBox.y, w: firstBox.w, h: firstBox.h },
    className: firstBox.cls,
    count: selectedIds.length,
  };
}

function acceptedPredictionShapeKeys(annotations: AnnotationResponse[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const ann of annotations ?? []) {
    if (!ann.parent_prediction_id) continue;
    // _shape_index 由后端 accept_prediction 写入 attributes；旧数据可能缺失 → 退回 prediction 维度过滤。
    const idx = (ann.attributes as { _shape_index?: number } | undefined)?._shape_index;
    if (typeof idx === "number") {
      set.add(`pred-${ann.parent_prediction_id}-${idx}`);
    } else {
      set.add(`pred-${ann.parent_prediction_id}-*`);
    }
  }
  return set;
}

export function useImageAnnotationActions({
  taskId,
  projectId,
  meUserId,
  queryClient,
  history,
  s,
  pushToast,
  recordRecentClass,
  annotationsData,
  annotationsRef,
  predictionsData,
  userBoxes,
  stageGeom,
  iouDedupThreshold,
  classes,
  sam,
  createAnnotationAsync,
  mutations,
  enqueueOnError,
  isLocked = false,
}: UseImageAnnotationActionsArgs) {
  const annotationActions = useWorkbenchAnnotationActions({
    taskId,
    projectId,
    meUserId,
    queryClient,
    history,
    s,
    pushToast,
    recordRecentClass,
    annotationsRef,
    enqueueOnError,
    isLocked,
    mutations,
  });
  const {
    createBboxWithClass,
    submitPolygon,
  } = annotationActions;
  const acceptPredictionMut = useAcceptPrediction(taskId ?? "");
  const [batchChanging, setBatchChanging] = useState(false);
  const [samPendingAccept, setSamPendingAccept] = useState<{ idx: number } | null>(null);
  const [dismissedShapeKeys, setDismissedShapeKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissedShapeKeys(new Set());
  }, [taskId]);

  const clipboard = useClipboard({
    userBoxes,
    selectedIds: s.selectedIds,
    clipboard: s.clipboard,
    setClipboard: s.setClipboard,
    createAnnotation: createAnnotationAsync,
    pushBatch: history.pushBatch,
    setSelectedIds: (ids) => s.replaceSelected(ids),
    imgW: stageGeom.imgW,
    imgH: stageGeom.imgH,
  });

  const acceptedShapeKeys = useMemo(
    () => acceptedPredictionShapeKeys(annotationsData),
    [annotationsData],
  );
  const allAiBoxes = useMemo(
    () => predictionsToBoxes(predictionsData),
    [predictionsData],
  );
  const aiBoxes = useMemo(
    () => allAiBoxes.filter((b) => {
      if (b.conf < s.confThreshold) return false;
      if (acceptedShapeKeys.has(b.id)) return false;
      if (acceptedShapeKeys.has(`pred-${b.predictionId}-*`)) return false;
      if (dismissedShapeKeys.has(b.id)) return false;
      return true;
    }),
    [allAiBoxes, s.confThreshold, acceptedShapeKeys, dismissedShapeKeys],
  );
  const aiTakeoverRate = useMemo(() => {
    if (!annotationsData || annotationsData.length === 0) return 0;
    const aiDerived = annotationsData.filter((a) => a.parent_prediction_id).length;
    return Math.round((aiDerived / annotationsData.length) * 100);
  }, [annotationsData]);
  const userIoUIndex = useMemo(() => buildIoUIndex(userBoxes), [userBoxes]);
  const dimmedAiIds = useMemo(() => {
    const out = new Set<string>();
    if (userBoxes.length === 0 || aiBoxes.length === 0) return out;
    for (const a of aiBoxes) {
      const candidates = userIoUIndex.candidatesForBox(a);
      if (candidates.some((u) => iouShape(u, a) > iouDedupThreshold)) out.add(a.id);
    }
    return out;
  }, [userBoxes, aiBoxes, userIoUIndex, iouDedupThreshold]);

  const batchChangeTarget = useMemo(
    () => getBatchChangeTarget(s.selectedIds, userBoxes),
    [s.selectedIds, userBoxes],
  );

  const samPendingGeom = useMemo<Geom | null>(() => {
    if (!samPendingAccept) return null;
    const cand = sam.candidates[samPendingAccept.idx];
    if (!cand) return null;
    if (cand.type === "rectanglelabels" && cand.bbox) {
      return { x: cand.bbox.x, y: cand.bbox.y, w: cand.bbox.width, h: cand.bbox.height };
    }
    if (cand.points && cand.points.length >= 3) return polygonBounds(cand.points);
    return null;
  }, [samPendingAccept, sam.candidates]);

  const samDefaultClass = (
    samPendingAccept &&
    sam.candidates[samPendingAccept.idx]?.label &&
    classes.includes(sam.candidates[samPendingAccept.idx].label)
  )
    ? sam.candidates[samPendingAccept.idx].label
    : s.activeClass;

  const handleSamCommitClass = useCallback(
    (cls: string) => {
      const pending = samPendingAccept;
      if (!pending) return;
      const cand = sam.candidates[pending.idx];
      setSamPendingAccept(null);
      if (!cand || !cls) return;
      s.setActiveClass(cls);
      // v0.9.4 phase 2 · 按 type 分发: rectanglelabels 走 bbox 创建路径，polygonlabels 走 polygon 创建路径。
      if (cand.type === "rectanglelabels" && cand.bbox) {
        createBboxWithClass({ x: cand.bbox.x, y: cand.bbox.y, w: cand.bbox.width, h: cand.bbox.height }, cls);
      } else if (cand.points && cand.points.length >= 3) {
        submitPolygon(cand.points);
      }
      sam.consume(pending.idx);
    },
    [samPendingAccept, sam, s, createBboxWithClass, submitPolygon],
  );

  const handleSamCancelClass = useCallback(() => {
    setSamPendingAccept(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (s.tool !== "sam") return;
      if (sam.candidates.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (samPendingAccept) return;

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        setSamPendingAccept({ idx: sam.activeIdx });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        sam.cancel();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        sam.cycle(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [s.tool, sam, samPendingAccept]);

  const handleBatchDelete = useCallback(() => {
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
    if (ids.length === 0) return;
    const targets = ids
      .map((id) => annotationsRef.current.find((a) => a.id === id))
      .filter(Boolean) as AnnotationResponse[];
    let pending = ids.length;
    let succeeded = 0, failed = 0;
    const cmds: { kind: "delete"; annotation: AnnotationResponse }[] = [];
    targets.forEach((ann) => {
      mutations.delete.mutate(ann.id, {
        onSuccess: () => { succeeded++; cmds.push({ kind: "delete", annotation: ann }); },
        onError: () => { failed++; },
        onSettled: () => {
          pending--;
          if (pending === 0) {
            if (cmds.length > 0) history.pushBatch(cmds);
            pushToast({
              msg: `已删除 ${succeeded}/${targets.length} 个标注`,
              sub: failed ? `${failed} 项失败` : undefined,
              kind: failed ? "error" : "success",
            });
            s.setSelectedId(null);
          }
        },
      });
    });
  }, [s, annotationsRef, mutations.delete, history, pushToast]);

  const handleStartBatchChangeClass = useCallback(() => {
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
    if (ids.length === 0) return;
    setBatchChanging(true);
  }, [s.selectedIds, annotationsRef]);

  const handleCommitBatchChangeClass = useCallback((cls: string) => {
    setBatchChanging(false);
    if (!cls) return;
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
    if (ids.length === 0) return;
    let pending = ids.length;
    let succeeded = 0, failed = 0;
    const cmds: { kind: "update"; annotationId: string; before: { class_name: string }; after: { class_name: string } }[] = [];
    ids.forEach((id) => {
      const ann = annotationsRef.current.find((a) => a.id === id);
      if (!ann || ann.class_name === cls) { pending--; return; }
      const before = { class_name: ann.class_name };
      const after = { class_name: cls };
      mutations.update.mutate(
        { annotationId: id, payload: after },
        {
          onSuccess: () => { succeeded++; cmds.push({ kind: "update", annotationId: id, before, after }); },
          onError: () => { failed++; },
          onSettled: () => {
            pending--;
            if (pending === 0) {
              if (cmds.length > 0) history.pushBatch(cmds);
              s.setActiveClass(cls);
              recordRecentClass(cls);
              pushToast({
                msg: `${succeeded} 个标注已改为 ${cls}`,
                sub: failed ? `${failed} 项失败` : undefined,
                kind: failed ? "error" : "success",
              });
            }
          },
        },
      );
    });
    if (pending === 0) setBatchChanging(false);
  }, [s, annotationsRef, mutations.update, history, pushToast, recordRecentClass]);

  const handleCancelBatchChange = useCallback(() => setBatchChanging(false), []);

  const handleRejectPrediction = useCallback((box: AiBox) => {
    setDismissedShapeKeys((prev) => {
      if (prev.has(box.id)) return prev;
      const next = new Set(prev);
      next.add(box.id);
      return next;
    });
  }, []);

  const handleAcceptPrediction = useCallback((box: AiBox) => {
    if (!box.predictionId) return;
    acceptPredictionMut.mutate(
      { predictionId: box.predictionId, shapeIndex: box.shapeIndex },
      {
        onSuccess: (created) => {
          const ids = created.map((a) => a.id);
          history.push({ kind: "acceptPrediction", predictionId: box.predictionId, createdAnnotationIds: ids });
          pushToast({ msg: "已采纳 AI 标注", sub: `${box.cls} · 置信度 ${(box.conf * 100).toFixed(0)}%`, kind: "success" });
        },
      },
    );
  }, [acceptPredictionMut, history, pushToast]);

  const handleAcceptAll = useCallback(() => {
    if (aiBoxes.length === 0) return;
    const totalBoxes = aiBoxes.length;
    let succeeded = 0;
    let failed = 0;
    let pending = aiBoxes.length;
    aiBoxes.forEach((box) => {
      acceptPredictionMut.mutate(
        { predictionId: box.predictionId, shapeIndex: box.shapeIndex },
        {
          onSuccess: (created) => {
            succeeded++;
            history.push({
              kind: "acceptPrediction",
              predictionId: box.predictionId,
              createdAnnotationIds: created.map((a) => a.id),
            });
          },
          onError: () => { failed++; },
          onSettled: () => {
            pending--;
            if (pending === 0) {
              pushToast({
                msg: `采纳 ${succeeded}/${totalBoxes} 个 AI 框`,
                sub: failed ? `${failed} 项失败` : undefined,
                kind: failed ? "error" : "success",
              });
            }
          },
        },
      );
    });
  }, [aiBoxes, acceptPredictionMut, history, pushToast]);

  const handleCommitDrawing = useCallback((geo: Geom) => {
    s.setPendingDrawing({ geom: geo });
  }, [s]);

  const handleStartChangeClass = useCallback((annotationId: string) => {
    const ann = annotationsRef.current.find((a) => a.id === annotationId);
    if (!ann) return;
    const isVideoGeometry = ann.geometry.type === "video_bbox" || ann.geometry.type === "video_track";
    const geom = isVideoGeometry ? geometryToShape(ann.geometry) : ann.geometry as Geom;
    const anchor = isVideoGeometry && typeof window !== "undefined"
      ? { left: Math.max(16, window.innerWidth - 340), top: 96 }
      : undefined;
    s.setEditingClass({
      annotationId,
      geom,
      currentClass: ann.class_name,
      anchor,
    });
  }, [s, annotationsRef]);

  const handleCommitChangeClass = useCallback((cls: string) => {
    const editing = s.editingClass;
    if (!editing || !cls || cls === editing.currentClass) {
      s.setEditingClass(null);
      return;
    }
    const before = { class_name: editing.currentClass };
    const after = { class_name: cls };
    s.setEditingClass(null);
    s.setActiveClass(cls);
    recordRecentClass(cls);
    mutations.update.mutate(
      { annotationId: editing.annotationId, payload: after },
      {
        onSuccess: () => {
          history.push({
            kind: "update", annotationId: editing.annotationId,
            before, after,
          });
          pushToast({ msg: `已改为 ${cls}`, kind: "success" });
        },
      },
    );
  }, [s, mutations.update, history, pushToast, recordRecentClass]);

  const handleCancelChangeClass = useCallback(() => {
    s.setEditingClass(null);
  }, [s]);

  return {
    ...annotationActions,
    aiBoxes,
    aiTakeoverRate,
    dimmedAiIds,
    clipboard,
    batchChanging,
    setBatchChanging,
    batchChangeTarget,
    samPendingGeom,
    samDefaultClass,
    handleBatchDelete,
    handleStartBatchChangeClass,
    handleCommitBatchChangeClass,
    handleCancelBatchChange,
    handleRejectPrediction,
    handleAcceptPrediction,
    handleAcceptAll,
    handleCommitDrawing,
    handleStartChangeClass,
    handleCommitChangeClass,
    handleCancelChangeClass,
    handleSamCommitClass,
    handleSamCancelClass,
  };
}
