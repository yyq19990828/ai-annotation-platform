import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Annotation, AnnotationResponse, PredictionResponse } from "@/types";
import type { AnnotationPayload } from "@/api/tasks";
import type { ToolBindings } from "@/api/projects";
import { useAcceptPrediction, useRejectPrediction } from "@/hooks/usePredictions";
import { buildIoUIndex } from "../../stage/iou-index";
import { iouShape } from "../../stage/iou";
import type { useAnnotationHistory } from "../../state/useAnnotationHistory";
import type { UseInteractiveAIReturn } from "../../state/useInteractiveAI";
import {
  defaultPredictionSourceVisibility,
  emptyPredictionSourceCounts,
  geometryToShape,
  normalizePredictionSource,
  polygonBounds,
  predictionsToBoxes,
  type AiBox,
  type PredictionSourceFilter,
} from "../../state/transforms";
import type { UseMaskEditorReturn } from "../../state/useMaskEditor";
import { tightenBboxFromPolygon } from "../../stage/shared/geometry/bbox";
import { UNKNOWN_CLASS } from "../../stage/colors";
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
  /** v0.10.x · 项目 tool_bindings；用于把 AI 预测 class_name 的英文 alias 归一回原类别名。 */
  toolBindings?: ToolBindings;
  /**
   * 当前激活工具「自身的 unit」是否定义了类别。false 时落框直接以 __unknown 落库,
   * 不弹选类别窗 (修复老项目用无类别工具仍弹窗的 BUG)。来自 useToolBindings.hasOwnClasses。
   */
  activeToolHasOwnClasses?: boolean;
  /** v0.10.28 · 当前 keypoint 单元 schema 节点数，透传给 useWorkbenchAnnotationActions。 */
  keypointNodeCount?: number;
  sam: UseInteractiveAIReturn;
  createAnnotationAsync: (payload: AnnotationPayload) => Promise<AnnotationResponse>;
  mutations: AnnotationMutations;
  enqueueOnError: (err: unknown, fallback: () => void) => void;
  isLocked?: boolean;
  /** v0.10.8 · 由 WorkbenchShell 注入；mask 编辑器状态层。空时 refine/commitMask 返回 false。 */
  maskEditor?: UseMaskEditorReturn;
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
  toolBindings,
  activeToolHasOwnClasses = true,
  keypointNodeCount = 0,
  sam,
  createAnnotationAsync,
  mutations,
  enqueueOnError,
  isLocked = false,
  maskEditor,
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
    keypointNodeCount,
  });
  const {
    createBboxWithClass,
    submitPolygon,
  } = annotationActions;
  const acceptPredictionMut = useAcceptPrediction(taskId ?? "");
  const rejectPredictionMut = useRejectPrediction(taskId ?? "");
  const [batchChanging, setBatchChanging] = useState(false);
  const [samPendingAccept, setSamPendingAccept] = useState<{ idx: number } | null>(null);
  const [dismissedShapeKeys, setDismissedShapeKeys] = useState<Set<string>>(new Set());
  const [predictionSourceVisibility, setPredictionSourceVisibility] = useState(defaultPredictionSourceVisibility);

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
    () => predictionsToBoxes(predictionsData, toolBindings),
    [predictionsData, toolBindings],
  );
  const reviewableAiBoxes = useMemo(
    () => allAiBoxes.filter((b) => {
      if (b.conf < s.confThreshold) return false;
      if (acceptedShapeKeys.has(b.id)) return false;
      if (acceptedShapeKeys.has(`pred-${b.predictionId}-*`)) return false;
      if (dismissedShapeKeys.has(b.id)) return false;
      return true;
    }),
    [allAiBoxes, s.confThreshold, acceptedShapeKeys, dismissedShapeKeys],
  );
  const predictionSourceCounts = useMemo(() => {
    const counts = emptyPredictionSourceCounts();
    for (const box of reviewableAiBoxes) {
      const source = normalizePredictionSource(box.predictionSource);
      if (source) counts[source] += 1;
    }
    return counts;
  }, [reviewableAiBoxes]);
  const aiBoxes = useMemo(
    () => reviewableAiBoxes.filter((b) => {
      const source = normalizePredictionSource(b.predictionSource);
      return source ? predictionSourceVisibility[source] : true;
    }),
    [reviewableAiBoxes, predictionSourceVisibility],
  );
  const handleTogglePredictionSource = useCallback(
    (source: PredictionSourceFilter, visible: boolean) => {
      setPredictionSourceVisibility((prev) => ({ ...prev, [source]: visible }));
    },
    [],
  );
  const predictionSourceFilter = useMemo(
    () => ({
      visibility: predictionSourceVisibility,
      counts: predictionSourceCounts,
      totalCount: reviewableAiBoxes.length,
      onToggle: handleTogglePredictionSource,
    }),
    [handleTogglePredictionSource, predictionSourceCounts, predictionSourceVisibility, reviewableAiBoxes.length],
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
      // v0.10.17 · Magic Box: bbox prompt → polygon → 紧凑外接矩形落 bbox.
      // 不论候选 type 都收紧到 bbox, 跳过 polygon 创建路径.
      if (s.tool === "magic-box") {
        let tight: { x: number; y: number; w: number; h: number } | null = null;
        if (cand.type === "rectanglelabels" && cand.bbox) {
          tight = { x: cand.bbox.x, y: cand.bbox.y, w: cand.bbox.width, h: cand.bbox.height };
        } else if (cand.points && cand.points.length >= 3) {
          tight = tightenBboxFromPolygon(cand.points);
        }
        sam.cancel();
        if (tight) createBboxWithClass(tight, cls);
        return;
      }
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
    // Magic Box 仅有单个候选, 取消后直接清空, 避免 effect 重新弹出 popover.
    if (s.tool === "magic-box") sam.cancel();
  }, [s.tool, sam]);

  // v0.10.17 · Magic Box · SAM 返回候选后弹出类别选择 popover (复用 samPendingAccept),
  // 用户选定类别再收紧成 bbox; 默认类沿用 s.activeClass (见 samDefaultClass).
  useEffect(() => {
    if (s.tool !== "magic-box") return;
    if (sam.isRunning) return;
    if (sam.candidates.length === 0) return;
    if (samPendingAccept) return;
    setSamPendingAccept({ idx: 0 });
  }, [s.tool, sam.isRunning, sam.candidates.length, samPendingAccept]);

  // v0.10.9 · R 键精修走 ref 间接调用,避免在 useEffect 依赖里前向引用未定义的 handleRefineSamCandidate.
  const refineSamRef = useRef<(idx: number) => void>(() => {});

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // v0.10.2 · sam 拆分后, Tab/Enter 候选导航在任一 AI 工具激活下都启用.
      const isAIActive = s.tool === "smart-point" || s.tool === "smart-box" || s.tool === "text-prompt" || s.tool === "exemplar";
      if (!isAIActive) return;
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
        return;
      }
      // v0.10.9 · R 键精修当前 SAM 候选 → Mask 编辑器。仅 polygonlabels 类型有效。
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        e.stopPropagation();
        refineSamRef.current(sam.activeIdx);
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
    // 先本地隐藏，避免等待网络回包
    setDismissedShapeKeys((prev) => {
      if (prev.has(box.id)) return prev;
      const next = new Set(prev);
      next.add(box.id);
      return next;
    });
    // B-37 · 同步持久化到后端, 让刷新 / 切回该 task 时不再出现
    if (!box.predictionId) return;
    rejectPredictionMut.mutate(
      { predictionId: box.predictionId, shapeIndex: box.shapeIndex },
      {
        onError: () => {
          // 失败回滚本地隐藏，提示用户
          setDismissedShapeKeys((prev) => {
            if (!prev.has(box.id)) return prev;
            const next = new Set(prev);
            next.delete(box.id);
            return next;
          });
          pushToast({ msg: "驳回失败", sub: "请稍后重试", kind: "error" });
        },
      },
    );
  }, [rejectPredictionMut, pushToast]);

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

  // v0.10.8 · I11 · Mask 精修：候选/已存 polygon → mask 编辑 → commit 路径按 kind 分流。
  // v0.10.9 · 扩三种 kind：prediction（AI 预标 polygon 行）/ sam（SAM 交互候选，未 Enter）/ user（已落库 polygon，update 替换 geometry）。
  type PendingRefine =
    | { kind: "prediction"; predictionId: string; shapeIndex: number; labelId: string }
    | { kind: "sam"; samIdx: number; labelId: string }
    | { kind: "user"; annotationId: string; beforeGeometry: AnnotationResponse["geometry"]; labelId: string };
  const pendingRefineRef = useRef<PendingRefine | null>(null);

  const initMaskFromNormalizedPoints = useCallback((normPoints: [number, number][]): boolean => {
    if (!maskEditor) {
      pushToast({ msg: "Mask 编辑器未就绪", kind: "warning" });
      return false;
    }
    const { imgW, imgH } = stageGeom;
    if (!imgW || !imgH) {
      pushToast({ msg: "图像尺寸未就绪", kind: "warning" });
      return false;
    }
    if (normPoints.length < 3) {
      pushToast({ msg: "几何顶点 < 3，无法精修", kind: "warning" });
      return false;
    }
    const pxPoints: [number, number][] = normPoints.map(([x, y]) => [x * imgW, y * imgH]);
    maskEditor.initFromPolygon(pxPoints);
    return true;
  }, [maskEditor, pushToast, stageGeom]);

  const handleRefinePrediction = useCallback((box: AiBox) => {
    if (!box.polygon || box.polygon.length < 3) {
      pushToast({ msg: "仅支持 polygon 候选的精修", kind: "warning" });
      return;
    }
    if (!initMaskFromNormalizedPoints(box.polygon)) return;
    pendingRefineRef.current = {
      kind: "prediction",
      predictionId: box.predictionId,
      shapeIndex: box.shapeIndex,
      labelId: box.cls,
    };
    s.setTool("mask");
    s.setSelectedId(null);
  }, [initMaskFromNormalizedPoints, pushToast, s]);

  // v0.10.9 (A) · SAM 交互候选精修：候选未 Enter 时，直接从 sam.candidates[idx] 启动 mask 编辑。
  // commit 时 sam.consume(samIdx) 清候选 + submitPolygon 落库（候选 label 优先；无 label 用工具栏当前 label）。
  const handleRefineSamCandidate = useCallback((idx: number = sam.activeIdx) => {
    const cand = sam.candidates[idx];
    if (!cand) {
      pushToast({ msg: "无可精修的 SAM 候选", kind: "warning" });
      return;
    }
    if (cand.type !== "polygonlabels" || !cand.points || cand.points.length < 3) {
      pushToast({ msg: "仅支持 polygon 类型的 SAM 候选精修", kind: "warning" });
      return;
    }
    if (!initMaskFromNormalizedPoints(cand.points)) return;
    const labelId = (cand.label && classes.includes(cand.label)) ? cand.label : s.activeClass;
    pendingRefineRef.current = { kind: "sam", samIdx: idx, labelId };
    s.setTool("mask");
    s.setSelectedId(null);
  }, [sam, initMaskFromNormalizedPoints, pushToast, classes, s]);

  useEffect(() => { refineSamRef.current = handleRefineSamCandidate; }, [handleRefineSamCandidate]);

  // v0.10.9 (B) · 已落库 user polygon 精修：commit 时走 update mutation 替换原 geometry（in-place）。
  const handleRefineUserPolygon = useCallback((annotationId: string) => {
    const ann = annotationsRef.current.find((a) => a.id === annotationId);
    if (!ann) {
      pushToast({ msg: "未找到该标注", kind: "warning" });
      return;
    }
    if (ann.geometry.type !== "polygon" || ann.geometry.points.length < 3) {
      pushToast({ msg: "仅支持 polygon 标注的精修", kind: "warning" });
      return;
    }
    if (!initMaskFromNormalizedPoints(ann.geometry.points)) return;
    pendingRefineRef.current = {
      kind: "user",
      annotationId: ann.id,
      beforeGeometry: ann.geometry,
      labelId: ann.class_name,
    };
    s.setTool("mask");
    s.setSelectedId(null);
  }, [annotationsRef, initMaskFromNormalizedPoints, pushToast, s]);

  const commitMaskAsPolygon = useCallback(() => {
    if (!maskEditor) return;
    const out = maskEditor.commitToPolygon();
    if (!out) {
      pushToast({ msg: "Mask 为空,无可提交几何", kind: "warning" });
      return;
    }
    const refine = pendingRefineRef.current;
    const labelForCommit = refine ? refine.labelId : s.activeClass;
    if (!labelForCommit) {
      pushToast({ msg: "请先选择类别", kind: "warning" });
      return;
    }
    const { imgW, imgH } = stageGeom;
    // maskToPolygon 输出像素坐标 → 归一化 [0,1]。
    const normPoints: [number, number][] = out.points.map(([x, y]) => [x / imgW, y / imgH]);

    if (refine?.kind === "user") {
      // 原地替换 geometry，走 update mutation + history.push update；不新建 annotation。
      const before = { geometry: refine.beforeGeometry };
      const after = { geometry: { type: "polygon", points: normPoints } as const };
      mutations.update.mutate(
        { annotationId: refine.annotationId, payload: after },
        {
          onSuccess: () => {
            history.push({
              kind: "update",
              annotationId: refine.annotationId,
              before,
              after,
            });
            pushToast({ msg: "已更新 polygon", sub: `${out.points.length} 顶点`, kind: "success" });
          },
        },
      );
    } else {
      // prediction / sam / 空白工具：新建 polygon。
      if (refine?.kind === "prediction") {
        setDismissedShapeKeys((prev) => {
          const next = new Set(prev);
          next.add(`pred-${refine.predictionId}-${refine.shapeIndex}`);
          return next;
        });
      } else if (refine?.kind === "sam") {
        // 立即从 SAM 候选列表移除：避免 commit 后紫虚线还残留一条。
        sam.consume(refine.samIdx);
      }
      // submitPolygon 内部读 s.activeClass；refine 时先临时切到目标 label，再提交。
      if (refine && refine.labelId !== s.activeClass) {
        s.setActiveClass(refine.labelId);
      }
      submitPolygon(normPoints);
    }
    pendingRefineRef.current = null;
    maskEditor.cancel();
    s.setTool("box");
    if (out.multipleComponents) {
      pushToast({ msg: "Mask 含多个连通区，仅落最大外环", kind: "warning" });
    }
  }, [maskEditor, s, submitPolygon, pushToast, stageGeom, mutations.update, history, sam]);

  const cancelMaskEdit = useCallback(() => {
    if (!maskEditor) return;
    maskEditor.cancel();
    pendingRefineRef.current = null;
    s.setTool("box");
  }, [maskEditor, s]);

  const handleAcceptAll = useCallback(() => {
    if (aiBoxes.length === 0) return;
    // 跳过被同类人工框覆盖 (IoU 高于去重阈值) 而淡化的 AI 框，避免采纳出重复标注。
    const target = aiBoxes.filter((box) => !dimmedAiIds.has(box.id));
    const skipped = aiBoxes.length - target.length;
    if (target.length === 0) {
      pushToast({ msg: "无可采纳的 AI 框", sub: `${skipped} 个与人工框重复已跳过` });
      return;
    }
    const totalBoxes = target.length;
    let succeeded = 0;
    let failed = 0;
    let pending = target.length;
    target.forEach((box) => {
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
              const parts = [failed ? `${failed} 项失败` : null, skipped ? `${skipped} 个重复已跳过` : null].filter(Boolean);
              pushToast({
                msg: `采纳 ${succeeded}/${totalBoxes} 个 AI 框`,
                sub: parts.length ? parts.join("，") : undefined,
                kind: failed ? "error" : "success",
              });
            }
          },
        },
      );
    });
  }, [aiBoxes, dimmedAiIds, acceptPredictionMut, history, pushToast]);

  const handleCommitDrawing = useCallback((geo: Geom) => {
    // 当前工具自身的 unit 没有类别定义 → 不弹选类别窗, 直接以 __unknown 落库。
    // 修复老项目用无类别工具落框仍弹窗 (借 bbox/region 类) 的 BUG。
    if (!activeToolHasOwnClasses) {
      annotationActions.createBboxWithClass(geo, UNKNOWN_CLASS);
      return;
    }
    s.setPendingDrawing({ geom: geo });
  }, [s, activeToolHasOwnClasses, annotationActions]);

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
    predictionSourceFilter,
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
    handleRefinePrediction,
    handleRefineSamCandidate,
    handleRefineUserPolygon,
    commitMaskAsPolygon,
    cancelMaskEdit,
    handleAcceptAll,
    handleCommitDrawing,
    handleStartChangeClass,
    handleCommitChangeClass,
    handleCancelChangeClass,
    handleSamCommitClass,
    handleSamCancelClass,
  };
}
