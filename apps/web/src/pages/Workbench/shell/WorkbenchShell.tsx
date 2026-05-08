import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import {
  useTaskList, useAnnotations, useCreateAnnotation, useDeleteAnnotation,
  useUpdateAnnotation, useSubmitTask, useSkipTask, useWithdrawTask, useReopenTask,
} from "@/hooks/useTasks";
import { usePredictions, useAcceptPrediction } from "@/hooks/usePredictions";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import { tasksApi } from "@/api/tasks";
import { ApiError } from "@/api/client";
import { useBatches } from "@/hooks/useBatches";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
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
import { useCanvasDraftPersistence } from "../state/useCanvasDraftPersistence";
import { useWorkbenchTaskFlow } from "../state/useWorkbenchTaskFlow";
import { useInteractiveAI } from "../state/useInteractiveAI";
import { useHoveredCommentStore } from "../state/useHoveredCommentStore";
import { annotationToBox, polygonBounds, predictionsToBoxes, type AiBox } from "../state/transforms";
import { iouShape } from "../stage/iou";
import { buildIoUIndex } from "../stage/iou-index";
import { setActiveClassesConfig, sortClassesByConfig, UNKNOWN_CLASS } from "../stage/colors";
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

  const meUserId = useAuthStore((s) => s.user?.id);
  // v0.7.1 B-17：支持 /annotate?batch=<id> 深链（从 dashboard「我的批次」跳过来）
  const [searchParams] = useSearchParams();
  const initialBatchId = searchParams.get("batch");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(initialBatchId);
  const { data: batchList } = useBatches(projectId ?? "", undefined);
  const isOwner = useIsProjectOwner(currentProject ?? null);
  const activeBatches = useMemo(() => {
    // v0.6.8 B-15：owner 视角额外纳入 draft（数据集导入自动建的「{ds} 默认包」），
    // 让管理员一进 /annotate 就能看到批次结构、不至于以为「没批次」。
    // v0.7.0：成员视角额外纳入 rejected（被分派标注员可看到 reviewer 留言并继续重做）。
    // v0.9.6 · pre_annotated 加入两类视图: admin 跑完预标后能在工作台看到该批次, 标注员也能接管
    const ownerStatuses = ["draft", "active", "pre_annotated", "annotating", "rejected"];
    const memberStatuses = ["active", "pre_annotated", "annotating", "rejected"];
    if (isOwner || !meUserId) {
      return (batchList ?? []).filter((b) => ownerStatuses.includes(b.status));
    }
    return (batchList ?? [])
      .filter((b) => memberStatuses.includes(b.status))
      .filter((b) => b.annotator_id === meUserId);
  }, [batchList, isOwner, meUserId]);

  const taskListParams = useMemo(
    () => (selectedBatchId ? { batch_id: selectedBatchId } : undefined),
    [selectedBatchId],
  );
  const { data: taskListData, hasNextPage, isFetchingNextPage, fetchNextPage } = useTaskList(projectId, taskListParams);
  const tasks = taskListData?.pages.flatMap((p) => p.items) ?? [];
  const tasksTotal = taskListData?.pages[0]?.total ?? tasks.length;

  const s = useWorkbenchState();
  const { vp, setVp } = useViewportTransform();
  const [fitTick, setFitTick] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [stageGeom, setStageGeom] = useState<{ imgW: number; imgH: number; vpSize: { w: number; h: number } }>({ imgW: 0, imgH: 0, vpSize: { w: 0, h: 0 } });
  const isNarrow = useMediaQuery("(max-width: 1024px)");
  const { recent: recentClasses, record: recordRecentClass } = useRecentClasses(routeId);

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
  // B-19：file_url 是 MinIO presigned URL，每次任务列表 refetch 都会换签名。
  // 直接当 prop 传给 ImageStage 会让 useImage 重载图片，并触发 fileUrl 变化分支
  // 把 fittedRef 重置 → 视口跳回 fit。按 task.id 锁定，保证同一任务期间 URL 稳定。
  const fileUrl = useMemo(() => task?.file_url ?? null, [task?.id]);
  const blurhash = useMemo(() => task?.blurhash ?? null, [task?.id]);
  const thumbnailUrl = useMemo(() => task?.thumbnail_url ?? null, [task?.id]);

  // v0.7.1 · 支持 /annotate 深链 ?batch=&task= 自动选中任务
  const initialTaskId = searchParams.get("task");
  useEffect(() => {
    if (tasks.length === 0 || s.currentTaskId) return;
    if (initialTaskId && tasks.some((t) => t.id === initialTaskId)) {
      s.setCurrentTaskId(initialTaskId);
    } else {
      s.setCurrentTaskId(tasks[0].id);
    }
  }, [tasks, s.currentTaskId, initialTaskId]);

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

  // v0.9.5 · 本题累计 AI 费用 / 平均推理时间（PredictionMeta 已 join 进 PredictionResponse）
  const taskAiMeta = useMemo(() => {
    if (predictionsData.length === 0) return { totalCost: 0, avgMs: null as number | null, count: 0 };
    let totalCost = 0;
    let msSum = 0;
    let msCount = 0;
    for (const p of predictionsData) {
      if (p.total_cost != null) totalCost += p.total_cost;
      if (p.inference_time_ms != null) {
        msSum += p.inference_time_ms;
        msCount += 1;
      }
    }
    return {
      totalCost,
      avgMs: msCount > 0 ? Math.round(msSum / msCount) : null,
      count: predictionsData.length,
    };
  }, [predictionsData]);

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
  const withdrawTaskMut = useWithdrawTask();
  const reopenTaskMut = useReopenTask();
  const acceptPredictionMut = useAcceptPrediction(taskId ?? "");
  const triggerPreannotation = useTriggerPreannotation(projectId);
  const { progress: preannotationProgress, connection: preannotationConn, retries: preannotationRetries } =
    usePreannotationProgress(projectId);
  const { lockError, remainingMs } = useTaskLock(taskId);

  const queryClient = useQueryClient();

  // v0.9.2 · SAM 交互式标注
  const sam = useInteractiveAI({
    projectId,
    taskId,
    mlBackendId: currentProject?.ml_backend_id ?? null,
  });
  // 切题清候选；切工具离开 SAM 也清（避免用户切回 box 时仍残留紫虚线）
  useEffect(() => {
    sam.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  useEffect(() => {
    if (s.tool !== "sam" && sam.candidates.length > 0) sam.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tool]);

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

  // v0.9.6 · 当前任务批次状态 (用于 Topbar pre_annotated 视觉提示)
  const currentBatchStatus = useMemo<string | undefined>(() => {
    if (!task?.batch_id || !batchList) return undefined;
    return batchList.find((b) => b.id === task.batch_id)?.status;
  }, [task?.batch_id, batchList]);

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
  const { avgMs } = useSessionStats(taskId ?? null, projectId ?? null, "annotate");
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
  // v0.9.3 · 用 rbush 同类分桶预筛包围盒候选，候选过 iouShape 精确判定，some() 早退保留
  const iouDedupThreshold = currentProject?.iou_dedup_threshold ?? 0.7;
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

  // 批量改类 popover：anchor 到 selectedIds 第一个 user 框的 geom
  const [batchChanging, setBatchChanging] = useState(false);

  // v0.9.2 · SAM 候选接受：用户按 Enter → 锁定一个候选，弹 ClassPicker 选类后落库。
  const [samPendingAccept, setSamPendingAccept] = useState<{ idx: number } | null>(null);

  // ── 离线队列接线（v0.6.3 P1 抽 hook）：online / executeOp / flushAll / drawer ──
  const offlineQ = useWorkbenchOfflineQueue({ history, queryClient, pushToast });
  const { online, queueCount, enqueueOnError, flushOne: executeOp, flushAll: flushOffline,
    drawerOpen: offlineDrawerOpen, openDrawer: openOfflineDrawer, closeDrawer: closeOfflineDrawer } = offlineQ;

  // ── 标注 mutation 接线（v0.6.4 P1 抽 hook；v0.6.5 加 isLocked 守卫） ──
  const isLockedForActions = task?.status === "review" || task?.status === "completed";
  const annotationActions = useWorkbenchAnnotationActions({
    taskId, projectId, meUserId,
    queryClient, history, s, pushToast, recordRecentClass,
    annotationsRef,
    enqueueOnError,
    isLocked: isLockedForActions,
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

  /**
   * 当前 SAM 候选几何 AABB → 用作 ClassPicker 锚点。
   * v0.9.4 phase 2 · polygonlabels 走 polygonBounds; rectanglelabels 直接用 bbox.
   */
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

  const handleSamCommitClass = useCallback(
    (cls: string) => {
      const pending = samPendingAccept;
      if (!pending) return;
      const cand = sam.candidates[pending.idx];
      setSamPendingAccept(null);
      if (!cand || !cls) return;
      s.setActiveClass(cls);
      // v0.9.4 phase 2 · 按 type 分发: rectanglelabels 走 bbox 创建路径 (与用户手画框 + 选类等价).
      if (cand.type === "rectanglelabels" && cand.bbox) {
        s.setPendingDrawing({
          geom: { x: cand.bbox.x, y: cand.bbox.y, w: cand.bbox.width, h: cand.bbox.height },
        });
        handlePickPendingClass(cls);
      } else if (cand.points && cand.points.length >= 3) {
        submitPolygon(cand.points);
      }
      sam.consume(pending.idx);
    },
    [samPendingAccept, sam, s, submitPolygon, handlePickPendingClass],
  );

  const handleSamCancelClass = useCallback(() => {
    setSamPendingAccept(null);
  }, []);

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
    // 画完框未选类别时（Esc / 点外部）不丢弃，按 __unknown 落库为灰色框；
    // 用户后续可通过「改类别」补类。
    if (s.pendingDrawing) handlePickPendingClass(UNKNOWN_CLASS);
    else s.setPendingDrawing(null);
  }, [s, handlePickPendingClass]);

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

  // v0.6.6 · 评论 hover → 历史画布批注叠加
  const hoveredCommentShapes = useHoveredCommentStore((s) => s.shapes);

  // v0.6.6 · 切题 + 提交流程拆到 hook（navigateTask / smartNext / hasMissingRequired / handleSubmitTask）
  const { navigateTask, smartNext, hasMissingRequired, handleSubmitTask } = useWorkbenchTaskFlow({
    taskId, task, tasks,
    hasNextPage, isFetchingNextPage, fetchNextPage,
    annotationsRef,
    annotationsData,
    currentProject,
    userBoxesCount: userBoxes.length,
    setCurrentTaskId: s.setCurrentTaskId,
    setSelectedId: s.setSelectedId,
    pushToast,
    submitTaskMut,
  });

  // v0.6.5 · 任务锁定（提交质检后 / 审核通过后） + 撤回 / 重开
  const isLocked = task?.status === "review" || task?.status === "completed";
  const canWithdraw = task?.status === "review" && !task?.reviewer_claimed_at;
  const canReopen = task?.status === "completed";

  const handleWithdrawTask = useCallback(() => {
    if (!taskId || !canWithdraw) return;
    withdrawTaskMut.mutate(taskId, {
      onSuccess: () => pushToast({ msg: "已撤回提交，可继续编辑", kind: "success" }),
      onError: (err) => {
        const isApi = err instanceof ApiError;
        const reason = isApi ? (err.detailRaw as { reason?: string } | undefined)?.reason : undefined;
        let msg = "撤回失败，请刷新后重试";
        if (reason === "task_already_claimed") msg = "审核员已介入，无法撤回";
        else if (isApi && err.status === 403) msg = "只有任务的指派人可撤回（请联系管理员重新指派）";
        pushToast({ msg, kind: "error" });
      },
    });
  }, [taskId, canWithdraw, withdrawTaskMut, pushToast]);

  // v0.6.5: canvas 草稿持久化（sessionStorage 5min TTL + beforeunload guard）
  useCanvasDraftPersistence({
    taskId,
    canvasDraft: s.canvasDraft,
    beginCanvasDraft: s.beginCanvasDraft,
  });

  const handleReopenTask = useCallback(() => {
    if (!taskId || !canReopen) return;
    reopenTaskMut.mutate(taskId, {
      onSuccess: () => pushToast({ msg: "已重开任务，可继续编辑", sub: "改完记得重新提交质检", kind: "success" }),
      onError: () => pushToast({ msg: "重开失败，请刷新后重试", kind: "error" }),
    });
  }, [taskId, canReopen, reopenTaskMut, pushToast]);

  // v0.8.7 F7 · 跳过任务（图像损坏 / 无目标 / 不清晰）
  const skipTaskMut = useSkipTask();
  const handleSkipTask = useCallback(
    (
      reason: "image_corrupt" | "no_target" | "unclear" | "other",
      note?: string,
    ) => {
      if (!taskId) return;
      skipTaskMut.mutate(
        { taskId, reason, note },
        {
          onSuccess: () => {
            pushToast({ msg: "已跳过本题，等待审核员复核", kind: "success" });
            navigateTask("next");
          },
          onError: (err) => {
            const isApi = err instanceof ApiError;
            const reason = isApi
              ? (err.detailRaw as { reason?: string } | undefined)?.reason
              : undefined;
            let msg = "跳过失败，请刷新后重试";
            if (reason === "task_not_skippable") msg = "当前状态无法跳过";
            else if (reason === "invalid_skip_reason") msg = "原因无效";
            pushToast({ msg, kind: "error" });
          },
        },
      );
    },
    [taskId, skipTaskMut, pushToast, navigateTask],
  );

  // v0.9.2 · SAM 候选模式下拦截 Enter / Esc / Tab。
  // 在 useWorkbenchHotkeys (主 keydown) 之前的 capture 阶段触发；
  // 仅当 tool === "sam" 且有候选时介入，否则透传。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (s.tool !== "sam") return;
      if (sam.candidates.length === 0) return;
      // 焦点在 input/textarea 时不接管（让用户在 AI 助手文本框输入时不被吞键）
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      // ClassPicker 打开时让它独占键盘（避免 Enter 二次触发）
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
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [s.tool, sam, samPendingAccept]);

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
        gridTemplateColumns: `${leftOpen ? `${s.leftWidth}px` : "32px"} 48px 1fr ${rightOpen ? `${s.rightWidth}px` : "32px"}`,
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
        totalCount={tasksTotal}
        isOwner={isOwner}
        onGoToBatchSettings={() => {
          if (projectId) navigate(`/projects/${projectId}/settings?section=batches`);
        }}
        width={s.leftWidth}
        onResize={s.setLeftWidth}
      />

      <ToolDock
        tool={s.tool}
        onSetTool={s.setTool}
        samSubTool={s.samSubTool}
        onSetSamSubTool={s.setSamSubTool}
        samPolarity={s.samPolarity}
        onSetSamPolarity={s.setSamPolarity}
      />

      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {lockError && (
          <div
            style={{
              padding: "6px 14px",
              background: "var(--color-danger-soft)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 12, color: "var(--color-danger)",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Icon name="warning" size={13} />
            {lockError === "Lock expired" ? "任务锁已过期，请刷新页面" : "该任务正被其他用户编辑"}
          </div>
        )}

        {/* v0.6.5 · 任务状态锁定横幅（用 token 化颜色，避免暗色下白字白底） */}
        {task?.status === "review" && (
          <div
            style={{
              padding: "8px 14px",
              background: "var(--color-accent-soft)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 12, color: "var(--color-accent-fg)",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <Icon name="check" size={13} />
            <span style={{ flex: 1 }}>
              已提交质检 · 等待审核
              {task.reviewer_claimed_at && <span style={{ marginLeft: 8, opacity: 0.7 }}>· 审核员已介入</span>}
            </span>
            <Button
              size="sm"
              disabled={!canWithdraw || withdrawTaskMut.isPending}
              onClick={handleWithdrawTask}
              title={canWithdraw ? "撤回提交，回到编辑态" : "审核员已介入，无法撤回"}
            >
              撤回提交
            </Button>
          </div>
        )}
        {task?.status === "completed" && (
          <div
            style={{
              padding: "8px 14px",
              background: "var(--color-success-soft)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 12, color: "var(--color-success)",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <Icon name="check" size={13} />
            <span style={{ flex: 1 }}>
              已通过审核 · 任务已锁定
              {task.reopened_count > 0 && (
                <span style={{ marginLeft: 8, opacity: 0.7 }}>· 历史重开 {task.reopened_count} 次</span>
              )}
            </span>
            <Button
              size="sm"
              disabled={reopenTaskMut.isPending}
              onClick={handleReopenTask}
            >
              继续编辑
            </Button>
          </div>
        )}
        {task?.status === "in_progress" && task.reject_reason && (
          <div
            style={{
              padding: "8px 14px",
              background: "var(--color-danger-soft)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 12, color: "var(--color-danger)",
              display: "flex", alignItems: "flex-start", gap: 8,
            }}
          >
            <Icon name="warning" size={13} />
            <span><b>审核员退回：</b>{task.reject_reason}</span>
          </div>
        )}

        <Topbar
          task={task}
          taskIdx={taskIdx}
          taskTotal={tasks.length}
          aiRunning={aiRunning}
          batchStatus={currentBatchStatus}
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
          canWithdraw={canWithdraw}
          canReopen={canReopen}
          isWithdrawing={withdrawTaskMut.isPending}
          isReopening={reopenTaskMut.isPending}
          onWithdraw={handleWithdrawTask}
          onReopen={handleReopenTask}
          isSkipping={skipTaskMut.isPending}
          onSkip={handleSkipTask}
        />

        <ImageStage
          readOnly={isLocked}
          fileUrl={fileUrl}
          blurhash={blurhash}
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
          onSamPrompt={(prompt) => {
            if (prompt.kind === "point") {
              sam.runPoint(prompt.pt, prompt.alt ? 0 : 1);
            } else {
              sam.runBbox(prompt.bbox);
            }
          }}
          samCandidates={sam.candidates}
          samActiveIdx={sam.activeIdx}
          samSubTool={s.samSubTool}
          samPolarity={s.samPolarity}
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
          historicalShapes={hoveredCommentShapes ?? undefined}
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
              {samPendingGeom && stageGeom.imgW > 0 && !s.pendingDrawing && !s.editingClass && (
                <ClassPickerPopover
                  geom={samPendingGeom}
                  imgW={stageGeom.imgW}
                  imgH={stageGeom.imgH}
                  vp={vp}
                  classes={classes}
                  recent={recentClasses}
                  defaultClass={
                    sam.candidates[samPendingAccept!.idx]?.label &&
                    classes.includes(sam.candidates[samPendingAccept!.idx].label)
                      ? sam.candidates[samPendingAccept!.idx].label
                      : s.activeClass
                  }
                  title="接受 SAM 候选 → 选类别"
                  onPick={handleSamCommitClass}
                  onCancel={handleSamCancelClass}
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
                  thumbnailUrl={thumbnailUrl}
                  fileUrl={fileUrl}
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
        width={s.rightWidth}
        onResize={s.setRightWidth}
        readOnly={isLocked}
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
        tool={s.tool}
        onRunSamText={sam.runText}
        samRunning={sam.isRunning}
        samCandidateCount={sam.candidates.length}
        projectId={projectId}
        projectTypeKey={currentProject?.type_key ?? null}
        samTextFocusKey={s.samTextFocusKey}
        taskAiCost={taskAiMeta.totalCost}
        taskAiAvgMs={taskAiMeta.avgMs}
        taskAiPredictionCount={taskAiMeta.count}
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
