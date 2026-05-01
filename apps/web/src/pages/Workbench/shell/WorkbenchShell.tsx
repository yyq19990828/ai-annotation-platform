import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import {
  useTaskList, useAnnotations, useCreateAnnotation, useDeleteAnnotation,
  useUpdateAnnotation, useSubmitTask,
} from "@/hooks/useTasks";
import { usePredictions, useAcceptPrediction } from "@/hooks/usePredictions";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import { tasksApi } from "@/api/tasks";
import { useBatches } from "@/hooks/useBatches";
import { predictionsApi } from "@/api/predictions";
import type { TaskResponse, AnnotationResponse } from "@/types";

import { useWorkbenchState } from "../state/useWorkbenchState";
import { useViewportTransform } from "../state/useViewportTransform";
import { useAnnotationHistory } from "../state/useAnnotationHistory";
import { useRecentClasses } from "../state/useRecentClasses";
import { useSessionStats } from "../state/useSessionStats";
import { useClipboard } from "../state/useClipboard";
import { useWorkbenchAnnotationActions } from "../state/useWorkbenchAnnotationActions";
import { useWorkbenchHotkeys } from "../state/useWorkbenchHotkeys";
import { annotationToBox, predictionsToBoxes, type AiBox } from "../state/transforms";
import { iouShape } from "../stage/iou";
import { setActiveClassesConfig, sortClassesByConfig } from "../stage/colors";
import { getMissingRequired } from "./AttributeForm";
import { ImageStage } from "../stage/ImageStage";
import { CanvasToolbar } from "../stage/CanvasToolbar";
import { Topbar } from "./Topbar";
import { ToolDock } from "./ToolDock";
import { FloatingDock } from "./FloatingDock";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { TaskQueuePanel } from "./TaskQueuePanel";
import { AIInspectorPanel } from "./AIInspectorPanel";
import { StatusBar } from "./StatusBar";
import { ConflictModal } from "@/components/workbench/ConflictModal";
import { HotkeyCheatSheet } from "./HotkeyCheatSheet";
import { ClassPickerPopover } from "./ClassPickerPopover";
import { Minimap } from "../stage/Minimap";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAuthStore } from "@/stores/authStore";
import {
  getAll as offlineQueueGetAll,
  removeById as offlineQueueRemoveById,
} from "../state/offlineQueue";
import { useWorkbenchOfflineQueue } from "../state/useWorkbenchOfflineQueue";
import { OfflineQueueDrawer } from "./OfflineQueueDrawer";
import { WorkbenchSkeleton } from "./WorkbenchSkeleton";

type Geom = { x: number; y: number; w: number; h: number };

export function WorkbenchShell() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const onBack = useCallback(() => navigate("/dashboard"), [navigate]);
  const pushToast = useToastStore((s) => s.push);

  const { data: currentProject, isLoading: isProjectLoading } = useProject(routeId ?? "");
  const projectId = currentProject?.id;
  const rawClasses: string[] = currentProject?.classes ?? [];
  const classesConfig = currentProject?.classes_config;
  const classes: string[] = useMemo(
    () => sortClassesByConfig(rawClasses, classesConfig),
    [rawClasses, classesConfig],
  );

  // 设置全局色板覆盖（让 ImageStage / SelectionOverlay 等无需逐层接 prop）
  useEffect(() => {
    setActiveClassesConfig(classesConfig);
    return () => setActiveClassesConfig(undefined);
  }, [classesConfig]);

  const projectName = currentProject?.name ?? "标注工作台";
  const projectDisplayId = currentProject?.display_id ?? "—";
  const aiModel = currentProject?.ai_model ?? "GroundingDINO + SAM";

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const { data: batchList } = useBatches(projectId ?? "", undefined);
  const activeBatches = useMemo(
    () => (batchList ?? []).filter((b) => ["active", "annotating"].includes(b.status)),
    [batchList],
  );

  const taskListParams = useMemo(
    () => (selectedBatchId ? { batch_id: selectedBatchId } : undefined),
    [selectedBatchId],
  );
  const { data: taskListData, hasNextPage, isFetchingNextPage, fetchNextPage } = useTaskList(projectId, taskListParams);
  const tasks = taskListData?.pages.flatMap((p) => p.items) ?? [];

  const s = useWorkbenchState();
  const { vp, setVp } = useViewportTransform();
  const [fitTick, setFitTick] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [stageGeom, setStageGeom] = useState<{ imgW: number; imgH: number; vpSize: { w: number; h: number } }>({ imgW: 0, imgH: 0, vpSize: { w: 0, h: 0 } });
  const isNarrow = useMediaQuery("(max-width: 1024px)");
  const { recent: recentClasses, record: recordRecentClass } = useRecentClasses(routeId);
  const meUserId = useAuthStore((s) => s.user?.id);

  // 阈值防抖：滑动时前端即时过滤，300ms 后触发服务端查询
  const [debouncedConf, setDebouncedConf] = useState(s.confThreshold);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedConf(s.confThreshold), 300);
    return () => clearTimeout(t);
  }, [s.confThreshold]);

  const task: TaskResponse | undefined = useMemo(
    () => tasks.find((t) => t.id === s.currentTaskId) ?? tasks[0],
    [tasks, s.currentTaskId],
  );
  const taskId = task?.id;
  const taskIdx = tasks.findIndex((t) => t.id === taskId);
  const imageWidth = task?.image_width ?? null;
  const imageHeight = task?.image_height ?? null;

  useEffect(() => {
    if (tasks.length > 0 && !s.currentTaskId) {
      s.setCurrentTaskId(tasks[0].id);
    }
  }, [tasks, s.currentTaskId]);

  useEffect(() => {
    // 默认选最近使用过的类（如果该项目存在），否则取首个
    if (classes.length > 0) {
      const fallback = recentClasses.find((c) => classes.includes(c)) ?? classes[0];
      s.setActiveClass(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const { data: annotationsData } = useAnnotations(taskId);
  const annotationsRef = useRef<AnnotationResponse[]>([]);
  annotationsRef.current = annotationsData ?? [];
  const predictionsInfinite = usePredictions(taskId, undefined, debouncedConf);
  const predictionsPages = predictionsInfinite.data?.pages ?? [];
  const predictionsData = useMemo(
    () => predictionsPages.flatMap((p) => p),
    [predictionsPages],
  );

  const userBoxes = useMemo(
    () => (annotationsData ?? []).map(annotationToBox),
    [annotationsData],
  );
  const allAiBoxes = useMemo(
    () => predictionsToBoxes(predictionsData),
    [predictionsData],
  );
  const aiBoxes = useMemo(
    () => allAiBoxes.filter((b) => b.conf >= s.confThreshold),
    [allAiBoxes, s.confThreshold],
  );

  const aiTakeoverRate = useMemo(() => {
    if (!annotationsData || annotationsData.length === 0) return 0;
    const aiDerived = annotationsData.filter((a) => a.parent_prediction_id).length;
    return Math.round((aiDerived / annotationsData.length) * 100);
  }, [annotationsData]);

  const createAnnotation = useCreateAnnotation(taskId);
  const deleteAnnotationMut = useDeleteAnnotation(taskId);
  const conflictCbRef = useRef<(annotationId: string, version: number) => void>(() => {});
  const updateAnnotationMut = useUpdateAnnotation(taskId, (...args) => conflictCbRef.current(...args));
  const submitTaskMut = useSubmitTask();
  const acceptPredictionMut = useAcceptPrediction(taskId ?? "");
  const triggerPreannotation = useTriggerPreannotation(projectId);
  const { progress: preannotationProgress, connection: preannotationConn, retries: preannotationRetries } =
    usePreannotationProgress(projectId);
  const { lockError, remainingMs } = useTaskLock(taskId);

  const queryClient = useQueryClient();

  // 编辑冲突状态
  const conflictIdRef = useRef<string>("");
  const [conflictOpen, setConflictOpen] = useState(false);
  const handleConflict = useCallback((annotationId: string, _currentVersion: number) => {
    conflictIdRef.current = annotationId;
    setConflictOpen(true);
  }, []);
  // 同步 ref + 供 useUpdateAnnotation 通过 conflictCbRef 回调
  useEffect(() => {
    conflictCbRef.current = handleConflict;
  }, [handleConflict]);

  const handleConflictReload = useCallback(() => {
    setConflictOpen(false);
    queryClient.invalidateQueries({ queryKey: ["annotations", taskId] });
  }, [queryClient, taskId]);

  const handleConflictOverwrite = useCallback(() => {
    setConflictOpen(false);
  }, []);

  // 预取相邻题的 annotations / 第一页 predictions / 图像
  useEffect(() => {
    const idx = tasks.findIndex((t) => t.id === taskId);
    const prefetch = (t: TaskResponse | undefined) => {
      if (!t) return;
      queryClient.prefetchQuery({ queryKey: ["annotations", t.id], queryFn: () => tasksApi.getAnnotations(t.id) });
      queryClient.prefetchInfiniteQuery({
        queryKey: ["predictions", t.id, undefined, debouncedConf, 100],
        initialPageParam: 0,
        queryFn: () => predictionsApi.listByTask(t.id, undefined, debouncedConf, 100, 0),
      });
      if (t.file_url) {
        const img = new Image();
        img.src = t.file_url;
      }
    };
    prefetch(tasks[idx + 1]);
    prefetch(tasks[idx - 1]);
  }, [taskId, tasks, queryClient, debouncedConf]);

  const aiRunning = preannotationProgress?.status === "running" || triggerPreannotation.isPending;

  const history = useAnnotationHistory(taskId, {
    createAnnotation: (payload) => createAnnotation.mutateAsync(payload),
    deleteAnnotation: (id) => deleteAnnotationMut.mutateAsync(id),
    updateAnnotation: (id, payload) =>
      updateAnnotationMut.mutateAsync({ annotationId: id, payload }),
    // v0.6.3 P0：tmpId 上的 create undo 不走远端，仅清 cache + 抹离线队列对应 create op
    removeLocalCreate: async (id: string) => {
      if (!taskId) return;
      queryClient.setQueryData<AnnotationResponse[]>(
        ["annotations", taskId],
        (prev) => (prev ?? []).filter((a) => a.id !== id),
      );
      const all = await offlineQueueGetAll();
      const target = all.find((op) => op.kind === "create" && op.tmpId === id);
      if (target) await offlineQueueRemoveById(target.id);
    },
  });

  // 会话级 ETA：基于切题间隔
  const { avgMs } = useSessionStats(taskId ?? null);
  const remainingTaskCount = useMemo(() => {
    if (!tasks.length) return 0;
    return tasks.filter((t) => t.status !== "completed" && t.id !== taskId).length;
  }, [tasks, taskId]);

  // 剪贴板
  const clipboard = useClipboard({
    userBoxes,
    selectedIds: s.selectedIds,
    clipboard: s.clipboard,
    setClipboard: s.setClipboard,
    createAnnotation: (payload) => createAnnotation.mutateAsync(payload),
    pushBatch: history.pushBatch,
    setSelectedIds: (ids) => s.replaceSelected(ids),
    imgW: stageGeom.imgW,
    imgH: stageGeom.imgH,
  });

  // IoU 视觉去重：与已确认 user 框 IoU > 项目级阈值（默认 0.7）且 class 相同的 AI 框 → 淡化
  const iouDedupThreshold = currentProject?.iou_dedup_threshold ?? 0.7;
  const dimmedAiIds = useMemo(() => {
    const out = new Set<string>();
    if (userBoxes.length === 0 || aiBoxes.length === 0) return out;
    for (const a of aiBoxes) {
      const sameClass = userBoxes.filter((u) => u.cls === a.cls);
      if (sameClass.some((u) => iouShape(u, a) > iouDedupThreshold)) out.add(a.id);
    }
    return out;
  }, [userBoxes, aiBoxes, iouDedupThreshold]);

  // 批量改类 popover：anchor 到 selectedIds 第一个 user 框的 geom
  const [batchChanging, setBatchChanging] = useState(false);

  // ── 离线队列接线（v0.6.3 P1 抽 hook）：online / executeOp / flushAll / drawer ──
  const offlineQ = useWorkbenchOfflineQueue({ history, queryClient, pushToast });
  const { online, queueCount, enqueueOnError, flushOne: executeOp, flushAll: flushOffline,
    drawerOpen: offlineDrawerOpen, openDrawer: openOfflineDrawer, closeDrawer: closeOfflineDrawer } = offlineQ;

  // ── 标注 mutation 接线（v0.6.4 P1 抽 hook） ──
  const annotationActions = useWorkbenchAnnotationActions({
    taskId, projectId, meUserId,
    queryClient, history, s, pushToast, recordRecentClass,
    annotationsRef,
    enqueueOnError,
    mutations: {
      create: createAnnotation,
      update: { mutate: (vars, opts) => updateAnnotationMut.mutate(vars, opts) },
      delete: { mutate: (id, opts) => deleteAnnotationMut.mutate(id, opts) },
    },
  });
  const {
    optimisticEnqueueCreate,
    handlePickPendingClass,
    submitPolygon,
    handleDeleteBox,
    handleCommitMove,
    handleCommitResize,
    handleCommitPolygonGeometry,
    polygonDraftPoints,
    setPolygonDraftPoints,
    polygonHandle,
  } = annotationActions;


  const navigateTask = useCallback((direction: "next" | "prev") => {
    if (tasks.length === 0) return;
    const idx = tasks.findIndex((t) => t.id === taskId);
    const newIdx = direction === "next"
      ? Math.min(idx + 1, tasks.length - 1)
      : Math.max(0, idx - 1);
    // 距末页 10 条时预加载下一页
    if (direction === "next" && newIdx >= tasks.length - 10 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
    s.setCurrentTaskId(tasks[newIdx].id);
    s.setSelectedId(null);
  }, [tasks, taskId, s, hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** Shift+click 多选；普通 click 单选；点 AI 框始终单选。 */
  const handleSelectBox = useCallback((id: string | null, opts?: { shift?: boolean }) => {
    if (!id) { s.setSelectedId(null); return; }
    const isUserBox = annotationsRef.current.some((a) => a.id === id);
    if (opts?.shift && isUserBox) {
      s.toggleSelected(id);
    } else {
      s.setSelectedId(id);
    }
  }, [s]);

  /** N（下一未标注）/ U（下一最不确定，total_predictions desc）。 */
  const smartNext = useCallback((mode: "open" | "uncertain") => {
    if (tasks.length === 0) return;
    const idx = tasks.findIndex((t) => t.id === taskId);
    const after = tasks.slice(idx + 1);
    const target = mode === "open"
      ? after.find((t) => t.status !== "completed" && t.total_annotations === 0)
      : [...after]
          .filter((t) => t.total_predictions > 0 && t.total_annotations === 0)
          .sort((a, b) => b.total_predictions - a.total_predictions)[0];
    if (!target) {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
        pushToast({ msg: "正在加载下一页任务…", kind: "warning" });
      } else {
        pushToast({
          msg: mode === "open" ? "前方已无未标注题目" : "前方已无不确定题目",
          kind: "warning",
        });
      }
      return;
    }
    s.setCurrentTaskId(target.id);
    s.setSelectedId(null);
  }, [tasks, taskId, hasNextPage, isFetchingNextPage, fetchNextPage, s, pushToast]);

  /** 批量删除当前选中的所有 user 框：成功后聚合 1 条 batch 命令进 history。 */
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
      deleteAnnotationMut.mutate(ann.id, {
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
  }, [s, deleteAnnotationMut, history, pushToast]);

  /** 触发批量改类弹窗（实际批量更新由 popover commit 触发）。 */
  const handleStartBatchChangeClass = useCallback(() => {
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
    if (ids.length === 0) return;
    setBatchChanging(true);
  }, [s.selectedIds]);

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
      updateAnnotationMut.mutate(
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
  }, [s, updateAnnotationMut, history, pushToast, recordRecentClass]);

  const handleCancelBatchChange = useCallback(() => setBatchChanging(false), []);

  const handleAcceptPrediction = useCallback((box: AiBox) => {
    if (!box.predictionId) return;
    acceptPredictionMut.mutate(box.predictionId, {
      onSuccess: (created) => {
        const ids = created.map((a) => a.id);
        history.push({ kind: "acceptPrediction", predictionId: box.predictionId, createdAnnotationIds: ids });
        pushToast({ msg: "已采纳 AI 标注", sub: `${box.cls} · 置信度 ${(box.conf * 100).toFixed(0)}%`, kind: "success" });
      },
    });
  }, [acceptPredictionMut, history, pushToast]);

  const handleAcceptAll = useCallback(() => {
    const uniquePredictionIds = [...new Set(aiBoxes.map((b) => b.predictionId))];
    if (uniquePredictionIds.length === 0) return;
    let succeeded = 0;
    let failed = 0;
    let pending = uniquePredictionIds.length;
    uniquePredictionIds.forEach((pid) => {
      acceptPredictionMut.mutate(pid, {
        onSuccess: (created) => {
          succeeded++;
          history.push({
            kind: "acceptPrediction",
            predictionId: pid,
            createdAnnotationIds: created.map((a) => a.id),
          });
        },
        onError: () => { failed++; },
        onSettled: () => {
          pending--;
          if (pending === 0) {
            const totalBoxes = aiBoxes.length;
            pushToast({
              msg: `采纳 ${succeeded}/${uniquePredictionIds.length} 项预测（共 ${totalBoxes} 框）`,
              sub: failed ? `${failed} 项失败` : undefined,
              kind: failed ? "error" : "success",
            });
          }
        },
      });
    });
  }, [aiBoxes, acceptPredictionMut, history, pushToast]);

  const handleRunAi = useCallback(() => {
    if (!projectId) return;
    pushToast({ msg: "AI 正在分析图像...", sub: aiModel });
    triggerPreannotation.mutate(
      { ml_backend_id: "", task_ids: taskId ? [taskId] : undefined },
      {
        onError: (err) => pushToast({ msg: "AI 预标注失败", sub: String(err) }),
      },
    );
  }, [projectId, aiModel, taskId, triggerPreannotation, pushToast]);

  // 画完框 → 进入待选类别 pending 态。class 由 ClassPickerPopover 选定后才落库。
  const handleCommitDrawing = useCallback((geo: Geom) => {
    s.setPendingDrawing({ geom: geo });
  }, [s]);

  const handleCancelPending = useCallback(() => {
    s.setPendingDrawing(null);
  }, [s]);

  // 已落库 user 框 → 改类别
  const handleStartChangeClass = useCallback((annotationId: string) => {
    const ann = annotationsRef.current.find((a) => a.id === annotationId);
    if (!ann) return;
    s.setEditingClass({
      annotationId,
      geom: ann.geometry as Geom,
      currentClass: ann.class_name,
    });
  }, [s]);

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
    updateAnnotationMut.mutate(
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
  }, [s, updateAnnotationMut, history, pushToast, recordRecentClass]);

  const handleCancelChangeClass = useCallback(() => {
    s.setEditingClass(null);
  }, [s]);

  /** 选中态的 AnnotationResponse（驱动右侧栏属性表单）。仅单选 user 框时返回。 */
  const selectedAnnotationForPanel = useMemo<AnnotationResponse | null>(() => {
    if (!s.selectedId || s.selectedIds.length > 1) return null;
    return (annotationsData ?? []).find((a) => a.id === s.selectedId) ?? null;
  }, [s.selectedId, s.selectedIds.length, annotationsData]);

  const handleUpdateAttributes = useCallback((annotationId: string, next: Record<string, unknown>) => {
    const ann = annotationsRef.current.find((a) => a.id === annotationId);
    if (!ann) return;
    const before = { attributes: ann.attributes ?? {} };
    const after = { attributes: next };
    updateAnnotationMut.mutate({ annotationId, payload: after }, {
      onSuccess: () => {
        history.push({ kind: "update", annotationId, before, after });
      },
    });
  }, [updateAnnotationMut, history]);

  /** 计算所有 annotation 中是否有 required 属性未填（驱动提交按钮 disabled）。 */
  const hasMissingRequired = useMemo(() => {
    const schema = currentProject?.attribute_schema;
    if (!schema || !schema.fields || schema.fields.length === 0) return false;
    for (const a of annotationsRef.current) {
      if (getMissingRequired(schema, a.class_name, a.attributes ?? {}).length > 0) return true;
    }
    return false;
    // 当 annotations 列表变化时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsData, currentProject?.attribute_schema]);

  const handleSubmitTask = useCallback(() => {
    if (!taskId) return;
    if (hasMissingRequired) {
      pushToast({ msg: "存在必填属性未填，无法提交", sub: "请检查右侧标注属性表单", kind: "error" });
      return;
    }
    submitTaskMut.mutate(taskId, {
      onSuccess: () => {
        pushToast({
          msg: `已提交 ${task?.display_id} 至质检`,
          sub: `共 ${userBoxes.length} 个标注`,
          kind: "success",
        });
        navigateTask("next");
      },
    });
  }, [taskId, submitTaskMut, pushToast, task?.display_id, userBoxes.length, navigateTask, hasMissingRequired]);

  // ── 键盘快捷键（v0.6.4 P1 抽 hook） ───────────────────────────────────
  const { spacePan, nudgeMap } = useWorkbenchHotkeys({
    s, history, classes, currentProject, annotationsRef,
    batchChanging, setBatchChanging, showHotkeys,
    navigateTask, smartNext, setFitTick,
    recordRecentClass, handleDeleteBox, handleBatchDelete,
    handleStartChangeClass, handleStartBatchChangeClass,
    handleSubmitTask, handleAcceptPrediction, handleUpdateAttributes,
    aiBoxes, setShowHotkeys, clipboard, pushToast, stageGeom,
    polygonDraftPoints, setPolygonDraftPoints, submitPolygon,
    updateMutation: { mutate: (vars) => updateAnnotationMut.mutate(vars) },
    taskId,
  });
  if (isProjectLoading) {
    return <WorkbenchSkeleton />;
  }

  if (!currentProject) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, color: "var(--color-fg-muted)" }}>
        <Icon name="warning" size={40} />
        <div style={{ fontSize: 15 }}>项目不存在或无访问权限</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回总览</Button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, color: "var(--color-fg-muted)" }}>
        <Icon name="inbox" size={40} />
        <div style={{ fontSize: 15 }}>该项目暂无任务</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回总览</Button>
      </div>
    );
  }

  // 窄屏强制收两侧
  const leftOpen = isNarrow ? false : s.leftOpen;
  const rightOpen = isNarrow ? false : s.rightOpen;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${leftOpen ? "260px" : "32px"} 48px 1fr ${rightOpen ? "280px" : "32px"}`,
        height: "100%", overflow: "hidden", background: "var(--color-bg-sunken)",
      }}
    >
      <TaskQueuePanel
        open={leftOpen}
        projectName={projectName}
        projectDisplayId={projectDisplayId}
        classes={classes}
        classesConfig={currentProject?.classes_config}
        activeClass={s.activeClass}
        recentClasses={recentClasses}
        tasks={tasks}
        taskId={taskId}
        taskIdx={taskIdx}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onFetchNextPage={fetchNextPage}
        onBack={onBack}
        onToggle={() => s.setLeftOpen(!s.leftOpen)}
        onSelectTask={(id) => { s.setCurrentTaskId(id); s.setSelectedId(null); }}
        batches={activeBatches}
        selectedBatchId={selectedBatchId}
        onSelectBatch={setSelectedBatchId}
      />

      <ToolDock tool={s.tool} onSetTool={s.setTool} />

      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {lockError && (
          <div
            style={{
              padding: "6px 14px",
              background: "oklch(0.95 0.05 25)",
              borderBottom: "1px solid oklch(0.85 0.10 25)",
              fontSize: 12, color: "oklch(0.45 0.15 25)",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Icon name="warning" size={13} />
            {lockError === "Lock expired" ? "任务锁已过期，请刷新页面" : "该任务正被其他用户编辑"}
          </div>
        )}

        <Topbar
          task={task}
          taskIdx={taskIdx}
          taskTotal={tasks.length}
          aiRunning={aiRunning}
          isSubmitting={submitTaskMut.isPending}
          confThreshold={s.confThreshold}
          onShowHotkeys={() => setShowHotkeys(true)}
          onRunAi={handleRunAi}
          onPrev={() => navigateTask("prev")}
          onNext={() => navigateTask("next")}
          onSubmit={handleSubmitTask}
          onSmartNextOpen={() => smartNext("open")}
          onSmartNextUncertain={() => smartNext("uncertain")}
          overflowSlot={<ThemeSwitcher />}
        />

        <ImageStage
          fileUrl={task?.file_url ?? null}
          blurhash={task?.blurhash ?? null}
          tool={s.tool}
          activeClass={s.activeClass}
          selectedId={s.selectedId}
          selectedIds={s.selectedIds}
          fadedAiIds={dimmedAiIds}
          nudgeMap={nudgeMap}
          userBoxes={userBoxes}
          aiBoxes={aiBoxes}
          spacePan={spacePan}
          vp={vp}
          setVp={setVp}
          fitTick={fitTick}
          pendingDrawing={s.pendingDrawing}
          onSelectBox={handleSelectBox}
          onAcceptPrediction={handleAcceptPrediction}
          onDeleteUserBox={handleDeleteBox}
          onCommitDrawing={handleCommitDrawing}
          onCommitMove={handleCommitMove}
          onCommitResize={handleCommitResize}
          onCommitPolygonGeometry={handleCommitPolygonGeometry}
          onCursorMove={setCursor}
          onChangeUserBoxClass={handleStartChangeClass}
          onBatchDelete={handleBatchDelete}
          onBatchChangeClass={handleStartBatchChangeClass}
          onStageGeometry={setStageGeom}
          polygonDraft={s.tool === "polygon" ? polygonHandle : undefined}
          canvasShapes={s.canvasDraft.shapes}
          canvasEditable={s.canvasDraft.active}
          canvasStroke={s.canvasDraft.stroke}
          onCanvasStrokeCommit={(points, stroke) =>
            s.appendCanvasShape({ type: "line", points, stroke })
          }
          overlay={
            <>
              <FloatingDock
                scale={vp.scale}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onUndo={history.undo}
                onRedo={history.redo}
                onZoomIn={() => setVp((cur) => ({ ...cur, scale: Math.min(8, cur.scale * 1.2) }))}
                onZoomOut={() => setVp((cur) => ({ ...cur, scale: Math.max(0.2, cur.scale / 1.2) }))}
                onFit={() => setFitTick((n) => n + 1)}
              />
              {s.canvasDraft.active && (
                <CanvasToolbar
                  stroke={s.canvasDraft.stroke}
                  onSetStroke={s.setCanvasStroke}
                  shapeCount={s.canvasDraft.shapes.length}
                  onUndo={s.undoCanvasShape}
                  onClear={s.clearCanvasShapes}
                  onCancel={s.cancelCanvasDraft}
                  onDone={s.endCanvasDraft}
                />
              )}
              {s.pendingDrawing && stageGeom.imgW > 0 && (
                <ClassPickerPopover
                  geom={s.pendingDrawing.geom}
                  imgW={stageGeom.imgW}
                  imgH={stageGeom.imgH}
                  vp={vp}
                  classes={classes}
                  recent={recentClasses}
                  defaultClass={s.activeClass}
                  onPick={handlePickPendingClass}
                  onCancel={handleCancelPending}
                />
              )}
              {s.editingClass && stageGeom.imgW > 0 && !s.pendingDrawing && (
                <ClassPickerPopover
                  geom={s.editingClass.geom}
                  imgW={stageGeom.imgW}
                  imgH={stageGeom.imgH}
                  vp={vp}
                  classes={classes}
                  recent={recentClasses}
                  defaultClass={s.editingClass.currentClass}
                  title={`改类别 (当前: ${s.editingClass.currentClass})`}
                  onPick={handleCommitChangeClass}
                  onCancel={handleCancelChangeClass}
                />
              )}
              {batchChanging && stageGeom.imgW > 0 && !s.pendingDrawing && !s.editingClass && (() => {
                const firstId = s.selectedIds[0];
                const firstAnn = annotationsRef.current.find((a) => a.id === firstId);
                if (!firstAnn) return null;
                return (
                  <ClassPickerPopover
                    geom={firstAnn.geometry as Geom}
                    imgW={stageGeom.imgW}
                    imgH={stageGeom.imgH}
                    vp={vp}
                    classes={classes}
                    recent={recentClasses}
                    defaultClass={firstAnn.class_name}
                    title={`批量改类别 (${s.selectedIds.length} 个)`}
                    onPick={handleCommitBatchChangeClass}
                    onCancel={handleCancelBatchChange}
                  />
                );
              })()}
              {stageGeom.imgW > 0 && stageGeom.vpSize.w > 0 && (
                <Minimap
                  imgW={stageGeom.imgW}
                  imgH={stageGeom.imgH}
                  vpSize={stageGeom.vpSize}
                  vp={vp}
                  setVp={setVp}
                  thumbnailUrl={task?.thumbnail_url ?? null}
                  fileUrl={task?.file_url ?? null}
                />
              )}
            </>
          }
        />

        <StatusBar
          userBoxesCount={userBoxes.length}
          aiBoxesCount={aiBoxes.length}
          activeClass={s.activeClass}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          cursor={cursor}
          preannotationProgress={preannotationProgress}
          preannotationConn={preannotationConn}
          preannotationRetries={preannotationRetries}
          avgLeadMs={avgMs}
          remainingTaskCount={remainingTaskCount}
          offlineQueueCount={queueCount}
          online={online}
          onShowQueueDrawer={openOfflineDrawer}
          lockRemainingMs={remainingMs}
          lockError={lockError}
        />
      </div>

      <AIInspectorPanel
        open={rightOpen}
        aiModel={aiModel}
        aiRunning={aiRunning}
        aiBoxes={aiBoxes}
        userBoxes={userBoxes}
        selectedId={s.selectedId}
        selectedIds={s.selectedIds}
        dimmedAiIds={dimmedAiIds}
        confThreshold={s.confThreshold}
        aiTakeoverRate={aiTakeoverRate}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        hasMorePredictions={!!predictionsInfinite.hasNextPage}
        isFetchingMorePredictions={predictionsInfinite.isFetchingNextPage}
        onFetchMorePredictions={() => predictionsInfinite.fetchNextPage()}
        onToggle={() => s.setRightOpen(!s.rightOpen)}
        onRunAi={handleRunAi}
        onAcceptAll={handleAcceptAll}
        onSetConfThreshold={s.setConfThreshold}
        onSelect={handleSelectBox}
        onAcceptPrediction={handleAcceptPrediction}
        onClearSelection={() => s.setSelectedId(null)}
        onDeleteUserBox={handleDeleteBox}
        onChangeUserBoxClass={handleStartChangeClass}
        attributeSchema={currentProject?.attribute_schema}
        selectedAnnotation={selectedAnnotationForPanel}
        onUpdateAttributes={handleUpdateAttributes}
        currentUserId={meUserId}
        taskFileUrl={task?.file_url}
        liveCommentCanvas={{
          active: s.canvasDraft.active,
          result: s.canvasDraft.pendingResult,
          onStart: (initial) => s.beginCanvasDraft(selectedAnnotationForPanel?.id ?? null, initial),
          onConsume: s.consumeCanvasResult,
        }}
      />

      <HotkeyCheatSheet
        open={showHotkeys}
        onClose={() => setShowHotkeys(false)}
        attributeSchema={currentProject?.attribute_schema}
      />
      <OfflineQueueDrawer
        open={offlineDrawerOpen}
        onClose={closeOfflineDrawer}
        currentTaskId={taskId}
        onFlushOne={executeOp}
        onFlushAll={flushOffline}
      />
      <ConflictModal
        open={conflictOpen}
        onReload={handleConflictReload}
        onOverwrite={handleConflictOverwrite}
        onClose={() => setConflictOpen(false)}
      />
    </div>
  );
}
