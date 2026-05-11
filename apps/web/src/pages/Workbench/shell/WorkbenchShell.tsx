import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import {
  useTaskList, useAnnotations, useCreateAnnotation, useDeleteAnnotation,
  useUpdateAnnotation, useSubmitTask,
  useVideoManifest,
} from "@/hooks/useTasks";
import { usePredictions } from "@/hooks/usePredictions";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import { tasksApi } from "@/api/tasks";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { predictionsApi } from "@/api/predictions";
import type { TaskResponse, AnnotationResponse } from "@/types";

import { useWorkbenchState } from "../state/useWorkbenchState";
import { useViewportTransform } from "../state/useViewportTransform";
import { useAnnotationHistory } from "../state/useAnnotationHistory";
import { useRecentClasses } from "../state/useRecentClasses";
import { useSessionStats } from "../state/useSessionStats";
import { useWorkbenchHotkeys } from "../state/useWorkbenchHotkeys";
import { useCanvasDraftPersistence } from "../state/useCanvasDraftPersistence";
import { useWorkbenchTaskFlow } from "../state/useWorkbenchTaskFlow";
import { useInteractiveAI } from "../state/useInteractiveAI";
import { useHoveredCommentStore } from "../state/useHoveredCommentStore";
import { annotationToBox } from "../state/transforms";
import { applyVideoKeyframeToGeometry } from "../state/videoTrackCommands";
import { useAnnotateMode } from "../modes/useAnnotateMode";
import { useReviewMode } from "../modes/useReviewMode";
import { setActiveClassesConfig, sortClassesByConfig, UNKNOWN_CLASS } from "../stage/colors";
import type { VideoStageControls } from "../stage/VideoStage";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { WorkbenchOverlays } from "./WorkbenchOverlays";
import { WorkbenchLayout } from "./WorkbenchLayout";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAuthStore } from "@/stores/authStore";
import {
  getRememberedWorkbenchTask,
  rememberWorkbenchTask,
  resolveWorkbenchReturnTo,
  updateWorkbenchUrlSearch,
} from "@/utils/workbenchNavigation";
import {
  getAll as offlineQueueGetAll,
  removeById as offlineQueueRemoveById,
} from "../state/offlineQueue";
import { useWorkbenchOfflineQueue } from "../state/useWorkbenchOfflineQueue";
import { WorkbenchSkeleton } from "./WorkbenchSkeleton";
import { useImageAnnotationActions } from "../stages/image/useImageAnnotationActions";
import { useVideoAnnotationActions } from "../stages/video/useVideoAnnotationActions";

export function WorkbenchShell({ mode = "annotate" }: { mode?: "annotate" | "review" }) {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const returnTo = searchParams.get("returnTo");
  const requestedBatchId = searchParams.get("batch");
  const requestedTaskId = searchParams.get("task");
  const backTarget = useMemo(
    () => resolveWorkbenchReturnTo(returnTo, currentPath),
    [returnTo, currentPath],
  );
  const onBack = useCallback(() => navigate(backTarget), [navigate, backTarget]);
  const updateUrl = useCallback(
    (opts: { batchId?: string | null; taskId?: string | null; replace?: boolean }) => {
      const nextUrl = updateWorkbenchUrlSearch(location, opts);
      if (nextUrl !== currentPath) {
        navigate(nextUrl, { replace: opts.replace ?? false });
      }
    },
    [currentPath, location, navigate],
  );
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
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(requestedBatchId);
  useEffect(() => {
    setSelectedBatchId((prev) => (prev === requestedBatchId ? prev : requestedBatchId));
  }, [requestedBatchId]);
  const { data: batchList } = useBatches(projectId ?? "", undefined);
  // v0.9.13 · batch 状态实时同步 (B-15): 标注员触发 in_progress → batch
  // active/pre_annotated → annotating, 工作台无需手动刷新即可见状态变化
  useBatchEventsSocket(projectId);
  const isOwner = useIsProjectOwner(currentProject ?? null);
  const activeBatches = useMemo(() => {
    // v0.6.8 B-15：owner 视角额外纳入 draft（数据集导入自动建的「{ds} 默认包」），
    // 让管理员一进 /annotate 就能看到批次结构、不至于以为「没批次」。
    // v0.7.0：成员视角额外纳入 rejected（被分派标注员可看到 reviewer 留言并继续重做）。
    // v0.9.6 · pre_annotated 加入两类视图: admin 跑完预标后能在工作台看到该批次, 标注员也能接管
    // M2 · review 模式展示有待审任务的批次（annotating/reviewing 态）供审核员按批次过滤
    if (mode === "review") {
      return (batchList ?? []).filter((b) =>
        ["annotating", "reviewing", "active"].includes(b.status),
      );
    }
    const ownerStatuses = ["draft", "active", "pre_annotated", "annotating", "rejected"];
    const memberStatuses = ["active", "pre_annotated", "annotating", "rejected"];
    if (isOwner || !meUserId) {
      return (batchList ?? []).filter((b) => ownerStatuses.includes(b.status));
    }
    return (batchList ?? [])
      .filter((b) => memberStatuses.includes(b.status))
      .filter((b) => b.annotator_id === meUserId);
  }, [batchList, isOwner, meUserId, mode]);

  const taskListParams = useMemo(
    () => ({
      ...(mode === "review" ? { status: "review" as const } : {}),
      ...(selectedBatchId ? { batch_id: selectedBatchId } : {}),
    }),
    [mode, selectedBatchId],
  );
  const { data: taskListData, hasNextPage, isFetchingNextPage, fetchNextPage } = useTaskList(projectId, taskListParams);
  const tasks = taskListData?.pages.flatMap((p) => p.items) ?? [];
  const tasksTotal = taskListData?.pages[0]?.total ?? tasks.length;

  const s = useWorkbenchState();
  const currentTaskId = s.currentTaskId;
  const setCurrentTaskId = s.setCurrentTaskId;
  const setSelectedId = s.setSelectedId;
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
    () => tasks.find((t) => t.id === currentTaskId) ?? tasks[0],
    [tasks, currentTaskId],
  );
  const taskId = task?.id;
  const taskIdx = tasks.findIndex((t) => t.id === taskId);
  const selectTask = useCallback(
    (id: string, opts: { replace?: boolean } = {}) => {
      setCurrentTaskId(id);
      setSelectedId(null);
      updateUrl({ batchId: selectedBatchId, taskId: id, replace: opts.replace });
    },
    [selectedBatchId, setCurrentTaskId, setSelectedId, updateUrl],
  );
  const imageWidth = task?.image_width ?? null;
  const imageHeight = task?.image_height ?? null;
  // B-19：file_url 是 MinIO presigned URL，每次任务列表 refetch 都会换签名。
  // 直接当 prop 传给 ImageStage 会让 useImage 重载图片，并触发 fileUrl 变化分支
  // 把 fittedRef 重置 → 视口跳回 fit。按 task.id 锁定，保证同一任务期间 URL 稳定。
  const fileUrl = useMemo(() => task?.file_url ?? null, [task?.id]);
  const blurhash = useMemo(() => task?.blurhash ?? null, [task?.id]);
  const thumbnailUrl = useMemo(() => task?.thumbnail_url ?? null, [task?.id]);
  const isVideoTask = task?.file_type === "video" || currentProject?.type_key === "video-track";
  const stageKind = currentProject?.type_key === "lidar" ? "3d" : isVideoTask ? "video" : "image";
  const videoManifest = useVideoManifest(taskId, isVideoTask);

  // v0.7.1 · 支持 /annotate 深链 ?batch=&task= 自动选中任务
  // B-23 · 无 task 参数时按 batch 恢复上次打开的任务，避免每次进批次都回到第一题。
  useEffect(() => {
    if (tasks.length === 0) return;
    if (requestedTaskId && tasks.some((t) => t.id === requestedTaskId)) {
      if (currentTaskId !== requestedTaskId) {
        setCurrentTaskId(requestedTaskId);
        setSelectedId(null);
      }
      return;
    }
    if (!requestedTaskId && currentTaskId && tasks.some((t) => t.id === currentTaskId)) return;

    const rememberedTaskId = getRememberedWorkbenchTask(selectedBatchId, undefined, mode);
    const nextTaskId =
      rememberedTaskId && tasks.some((t) => t.id === rememberedTaskId)
          ? rememberedTaskId
          : tasks[0].id;
    selectTask(nextTaskId, { replace: true });
  }, [
    tasks,
    currentTaskId,
    requestedTaskId,
    selectedBatchId,
    setCurrentTaskId,
    setSelectedId,
    selectTask,
    mode,
  ]);

  useEffect(() => {
    if (currentTaskId !== taskId) return;
    rememberWorkbenchTask(selectedBatchId, taskId, undefined, mode);
  }, [selectedBatchId, taskId, currentTaskId, mode]);

  const handleSelectBatch = useCallback(
    (batchId: string | null) => {
      setSelectedBatchId(batchId);
      setCurrentTaskId(null);
      setSelectedId(null);
      updateUrl({ batchId, taskId: null });
    },
    [setCurrentTaskId, setSelectedId, updateUrl],
  );

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

  const createAnnotation = useCreateAnnotation(taskId);
  const deleteAnnotationMut = useDeleteAnnotation(taskId);
  const conflictCbRef = useRef<(annotationId: string, version: number) => void>(() => {});
  const updateAnnotationMut = useUpdateAnnotation(taskId, (...args) => conflictCbRef.current(...args));
  const submitTaskMut = useSubmitTask();
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
  useEffect(() => {
    if (!isVideoTask) return;
    if (s.tool !== "box" && s.tool !== "hand") s.setTool("box");
  }, [isVideoTask, s.tool, s.setTool]);

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
    updateVideoKeyframe: async (id, frameIndex, keyframe) => {
      // undo/redo 按当前轨迹 geometry 合并目标 keyframe；若轨迹已被整体改写，会保留当前其他帧状态。
      const ann = annotationsRef.current.find((a) => a.id === id);
      if (!ann || ann.geometry.type !== "video_track") throw new Error("Video track not found");
      const geometry = applyVideoKeyframeToGeometry(ann.geometry, frameIndex, keyframe);
      await updateAnnotationMut.mutateAsync({ annotationId: id, payload: { geometry } });
    },
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

  // ── 离线队列接线（v0.6.3 P1 抽 hook）：online / executeOp / flushAll / drawer ──
  const offlineQ = useWorkbenchOfflineQueue({ history, queryClient, pushToast });
  const { online, queueCount, enqueueOnError, flushOne: executeOp, flushAll: flushOffline,
    drawerOpen: offlineDrawerOpen, openDrawer: openOfflineDrawer, closeDrawer: closeOfflineDrawer } = offlineQ;

  // ── image stage action hook（bbox / polygon / SAM / AI 候选 / 批量操作 / 剪贴板）──
  const isLockedForActions = mode === "review"
    ? task?.status === "completed"
    : task?.status === "review" || task?.status === "completed";
  const imageActions = useImageAnnotationActions({
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
    iouDedupThreshold: currentProject?.iou_dedup_threshold ?? 0.7,
    classes,
    sam,
    createAnnotationAsync: (payload) => createAnnotation.mutateAsync(payload),
    isLocked: isLockedForActions,
    enqueueOnError,
    mutations: {
      create: createAnnotation,
      update: { mutate: (vars, opts) => updateAnnotationMut.mutate(vars, opts) },
      delete: { mutate: (id, opts) => deleteAnnotationMut.mutate(id, opts) },
    },
  });
  const {
    aiBoxes,
    aiTakeoverRate,
    dimmedAiIds,
    clipboard,
    batchChanging,
    setBatchChanging,
    batchChangeTarget,
    samPendingGeom,
    samDefaultClass,
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
  } = imageActions;


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

  const handleRunAi = useCallback(() => {
    if (!projectId) return;
    // B-8: 工作台 AI 一键预标 — 单图触发要求项目已绑定 ML backend
    const mlBackendId = currentProject?.ml_backend_id;
    if (!mlBackendId) {
      pushToast({
        msg: "AI 一键预标暂不可用",
        sub: "项目尚未绑定 ML 推理后端,请到「项目设置 → AI 配置」注册并选择",
        kind: "error",
      });
      return;
    }
    // B-12 · DINO 后端要求 prompt 非空 (无 prompt 直接 422); 用项目所有 alias
    // 拼成默认 prompt, 让"一键预标注"自带"识别所有已配类别"的语义.
    const aliases: string[] = [];
    const cfg = currentProject?.classes_config ?? {};
    for (const entry of Object.values(cfg)) {
      const alias = (entry as { alias?: string | null } | undefined)?.alias;
      if (typeof alias === "string" && alias.trim()) aliases.push(alias.trim());
    }
    if (aliases.length === 0) {
      pushToast({
        msg: "AI 一键预标暂不可用",
        sub: "项目类别未配置英文 alias,请到「项目设置 → 类别管理」补全",
        kind: "error",
      });
      return;
    }
    const prompt = aliases.join(", ");
    pushToast({ msg: "AI 正在分析图像...", sub: `${aiModel} · ${aliases.length} 个类别` });
    triggerPreannotation.mutate(
      {
        ml_backend_id: mlBackendId,
        task_ids: taskId ? [taskId] : undefined,
        prompt,
      },
      {
        onError: (err) => pushToast({ msg: "AI 预标注失败", sub: String(err), kind: "error" }),
      },
    );
  }, [projectId, currentProject, aiModel, taskId, triggerPreannotation, pushToast]);

  const {
    handleVideoCreate,
    handleVideoPendingDraw,
    handlePickVideoPendingClass,
    handleVideoUpdate,
    handleVideoRename,
    handleVideoSetSelectedClass,
    handleVideoConvertToBboxes,
  } = useVideoAnnotationActions({
    taskId,
    queryClient,
    history,
    s,
    annotationsRef,
    pushToast,
    recordRecentClass,
    optimisticEnqueueCreate,
    enqueueOnError,
    mutations: {
      create: createAnnotation,
      update: { mutate: (vars, opts) => updateAnnotationMut.mutate(vars, opts) },
    },
  });

  const handlePickPendingClassAny = useCallback((cls: string) => {
    if (handlePickVideoPendingClass(cls)) return;
    handlePickPendingClass(cls);
  }, [handlePickPendingClass, handlePickVideoPendingClass]);

  const handleCancelPending = useCallback(() => {
    // 画完框未选类别时（Esc / 点外部）不丢弃，按 __unknown 落库为灰色框；
    // 用户后续可通过「改类别」补类。
    if (s.pendingDrawing) handlePickPendingClassAny(UNKNOWN_CLASS);
    else s.setPendingDrawing(null);
  }, [s, handlePickPendingClassAny]);

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

  // v0.6.6 · 切题 + 提交流程拆到 hook（navigateTask / smartNext / handleSubmitTask）
  const { navigateTask, smartNext, handleSubmitTask } = useWorkbenchTaskFlow({
    taskId, task, tasks,
    hasNextPage, isFetchingNextPage, fetchNextPage,
    annotationsRef,
    annotationsData,
    currentProject,
    userBoxesCount: userBoxes.length,
    setCurrentTaskId: selectTask,
    setSelectedId: s.setSelectedId,
    pushToast,
    submitTaskMut,
  });

  const videoControlsRef = useRef<VideoStageControls | null>(null);

  const annotateModeState = useAnnotateMode({
    mode,
    taskId,
    task,
    navigateTask,
    smartNext,
    onSubmit: handleSubmitTask,
    isSubmitting: submitTaskMut.isPending,
    pushToast,
  });
  const reviewModeState = useReviewMode({
    mode,
    taskId,
    task,
    navigateTask,
    pushToast,
  });
  const modeState = mode === "review" ? reviewModeState : annotateModeState;
  const { topbarActions, bannerActions } = modeState;
  const isLocked = modeState.isLocked;

  // v0.6.5: canvas 草稿持久化（sessionStorage 5min TTL + beforeunload guard）
  useCanvasDraftPersistence({
    taskId,
    canvasDraft: s.canvasDraft,
    beginCanvasDraft: s.beginCanvasDraft,
  });

  // ── 键盘快捷键（v0.6.4 P1 抽 hook） ───────────────────────────────────
  const { spacePan, nudgeMap } = useWorkbenchHotkeys({
    s, history, classes, currentProject, annotationsRef,
    batchChanging, setBatchChanging, showHotkeys,
    navigateTask, smartNext, setFitTick,
    recordRecentClass, handleDeleteBox, handleBatchDelete,
    handleStartChangeClass, handleStartBatchChangeClass,
    handleSubmitTask, handleAcceptPrediction, handleRejectPrediction, handleUpdateAttributes,
    handleVideoSetSelectedClass,
    aiBoxes, setShowHotkeys, clipboard, pushToast, stageGeom,
    polygonDraftPoints, setPolygonDraftPoints, submitPolygon,
    updateMutation: { mutate: (vars) => updateAnnotationMut.mutate(vars) },
    taskId,
    videoMode: isVideoTask,
    videoControlsRef,
  });
  if (isProjectLoading) {
    return <WorkbenchSkeleton />;
  }

  if (!currentProject) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, color: "var(--color-fg-muted)" }}>
        <Icon name="warning" size={40} />
        <div style={{ fontSize: 15 }}>项目不存在或无访问权限</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回</Button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, color: "var(--color-fg-muted)" }}>
        <Icon name="inbox" size={40} />
        <div style={{ fontSize: 15 }}>该项目暂无任务</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回</Button>
      </div>
    );
  }

  // 窄屏强制收两侧
  const leftOpen = isNarrow ? false : s.leftOpen;
  const rightOpen = isNarrow ? false : s.rightOpen;

  return (
    <WorkbenchLayout
      gridTemplateColumns={`${leftOpen ? `${s.leftWidth}px` : "32px"} 48px 1fr ${rightOpen ? `${s.rightWidth}px` : "32px"}`}
      taskQueue={{
        open: leftOpen, projectName, projectDisplayId, classes, classesConfig: currentProject?.classes_config,
        activeClass: s.activeClass, recentClasses, tasks, taskId, taskIdx, hasNextPage,
        isFetchingNextPage, onFetchNextPage: fetchNextPage, onBack, onToggle: () => s.setLeftOpen(!s.leftOpen),
        onSelectTask: selectTask, batches: activeBatches, selectedBatchId, onSelectBatch: handleSelectBatch,
        totalCount: tasksTotal, isOwner, onGoToBatchSettings: () => { if (projectId) navigate(`/projects/${projectId}/settings?section=batches`); },
        width: s.leftWidth, onResize: s.setLeftWidth,
      }}
      toolDock={{
        tool: s.tool, onSetTool: s.setTool, videoTool: s.videoTool, onSetVideoTool: s.setVideoTool,
        samSubTool: s.samSubTool, onSetSamSubTool: s.setSamSubTool, samPolarity: s.samPolarity,
        onSetSamPolarity: s.setSamPolarity, reviewMode: mode === "review", videoMode: isVideoTask,
      }}
      banners={{
        mode, task, lockError, claimInfo: modeState.claimInfo, canWithdraw: bannerActions.canWithdraw,
        isWithdrawing: bannerActions.isWithdrawing, isReopening: bannerActions.isReopening,
        isAcceptingRejection: bannerActions.isAcceptingRejection, onWithdraw: bannerActions.onWithdraw,
        onReopen: bannerActions.onReopen, onAcceptRejection: bannerActions.onAcceptRejection,
      }}
      topbar={{
        task, taskIdx, taskTotal: tasks.length, aiRunning, batchStatus: currentBatchStatus,
        isSubmitting: topbarActions.isSubmitting ?? submitTaskMut.isPending, confThreshold: s.confThreshold,
        onShowHotkeys: () => setShowHotkeys(true), onRunAi: handleRunAi, aiDisabled: isVideoTask,
        onPrev: () => navigateTask("prev"), onNext: () => navigateTask("next"),
        onSubmit: topbarActions.onSubmit ?? handleSubmitTask, onSmartNextOpen: topbarActions.onSmartNextOpen,
        onSmartNextUncertain: topbarActions.onSmartNextUncertain, overflowSlot: <ThemeSwitcher />,
        canWithdraw: topbarActions.canWithdraw, canReopen: topbarActions.canReopen,
        isWithdrawing: topbarActions.isWithdrawing, isReopening: topbarActions.isReopening,
        onWithdraw: topbarActions.onWithdraw, onReopen: topbarActions.onReopen,
        isSkipping: topbarActions.isSkipping, onSkip: topbarActions.onSkip, mode,
        onApprove: topbarActions.onApprove, onReject: topbarActions.onReject,
        isApproving: topbarActions.isApproving, isRejecting: topbarActions.isRejecting,
        reviewInfoSlot: topbarActions.reviewInfoSlot,
      }}
      stageHost={{
        stageKind, readOnly: isLocked, activeClass: s.activeClass, selectedId: s.selectedId,
        annotations: annotationsData ?? [], onSelectBox: handleSelectBox, onCursorMove: setCursor,
        videoManifest: videoManifest.data, videoManifestLoading: videoManifest.isLoading,
        videoManifestError: videoManifest.error, videoTool: s.videoTool, onVideoCreate: handleVideoCreate,
        onVideoPendingDraw: handleVideoPendingDraw, onVideoUpdate: handleVideoUpdate,
        onVideoRename: handleVideoRename, onVideoConvertToBboxes: handleVideoConvertToBboxes,
        fileUrl, blurhash, thumbnailUrl, tool: s.tool, selectedIds: s.selectedIds, fadedAiIds: dimmedAiIds,
        nudgeMap, userBoxes: modeState.diffMode === "raw" ? [] : userBoxes,
        aiBoxes: modeState.diffMode === "final" ? [] : aiBoxes, spacePan, vp, setVp, fitTick, setFitTick,
        pendingDrawing: s.pendingDrawing, onAcceptPrediction: handleAcceptPrediction,
        onRejectPrediction: handleRejectPrediction, onDeleteUserBox: handleDeleteBox,
        onCommitDrawing: handleCommitDrawing,
        onSamPrompt: (prompt) => prompt.kind === "point" ? sam.runPoint(prompt.pt, prompt.alt ? 0 : 1) : sam.runBbox(prompt.bbox),
        samCandidates: sam.candidates, samActiveIdx: sam.activeIdx, samSubTool: s.samSubTool,
        samPolarity: s.samPolarity, onCommitMove: handleCommitMove, onCommitResize: handleCommitResize,
        onCommitPolygonGeometry: handleCommitPolygonGeometry, onChangeUserBoxClass: handleStartChangeClass,
        onBatchDelete: handleBatchDelete, onBatchChangeClass: handleStartBatchChangeClass,
        onStageGeometry: setStageGeom, polygonDraft: s.tool === "polygon" ? polygonHandle : undefined,
        canvasShapes: s.canvasDraft.shapes, canvasEditable: s.canvasDraft.active, canvasStroke: s.canvasDraft.stroke,
        onCanvasStrokeCommit: (points, stroke) => s.appendCanvasShape({ type: "line", points, stroke }),
        historicalShapes: hoveredCommentShapes ?? undefined, canUndo: history.canUndo, canRedo: history.canRedo,
        onUndo: history.undo, onRedo: history.redo, onSetCanvasStroke: s.setCanvasStroke,
        canvasShapeCount: s.canvasDraft.shapes.length, onUndoCanvasShape: s.undoCanvasShape,
        onClearCanvasShapes: s.clearCanvasShapes, onCancelCanvasDraft: s.cancelCanvasDraft,
        onDoneCanvasDraft: s.endCanvasDraft, stageGeom,
        overlays: (
          <WorkbenchOverlays
            pendingDrawing={s.pendingDrawing}
            editingClass={s.editingClass}
            samPendingGeom={samPendingGeom}
            samDefaultClass={samDefaultClass}
            batchChanging={batchChanging}
            batchChangeTarget={batchChangeTarget}
            imageOverlayEnabled={stageKind === "image"}
            stageGeom={stageGeom}
            vp={vp}
            classes={classes}
            recentClasses={recentClasses}
            activeClass={s.activeClass}
            onPickPendingClass={handlePickPendingClassAny}
            onCancelPending={handleCancelPending}
            onCommitChangeClass={handleCommitChangeClass}
            onCancelChangeClass={handleCancelChangeClass}
            onSamCommitClass={handleSamCommitClass}
            onSamCancelClass={handleSamCancelClass}
            onCommitBatchChangeClass={handleCommitBatchChangeClass}
            onCancelBatchChange={handleCancelBatchChange}
          />
        ),
      }}
      videoControlsRef={videoControlsRef}
      statusBar={{
        userBoxesCount: userBoxes.length, aiBoxesCount: aiBoxes.length, activeClass: s.activeClass,
        imageWidth, imageHeight, cursor, preannotationProgress, preannotationConn, preannotationRetries,
        avgLeadMs: avgMs, remainingTaskCount, offlineQueueCount: queueCount, online,
        onShowQueueDrawer: openOfflineDrawer, lockRemainingMs: remainingMs, lockError,
        diffMode: modeState.diffMode, onSetDiffMode: modeState.onSetDiffMode,
      }}
      inspector={{
        open: rightOpen, width: s.rightWidth, onResize: s.setRightWidth, readOnly: isLocked,
        aiModel, aiRunning, aiBoxes, userBoxes, selectedId: s.selectedId, selectedIds: s.selectedIds,
        dimmedAiIds, confThreshold: s.confThreshold, aiTakeoverRate, imageWidth, imageHeight,
        hasMorePredictions: !!predictionsInfinite.hasNextPage,
        isFetchingMorePredictions: predictionsInfinite.isFetchingNextPage,
        onFetchMorePredictions: () => predictionsInfinite.fetchNextPage(), onToggle: () => s.setRightOpen(!s.rightOpen),
        onRunAi: handleRunAi, onAcceptAll: handleAcceptAll, onSetConfThreshold: s.setConfThreshold,
        onSelect: handleSelectBox, onAcceptPrediction: handleAcceptPrediction, onRejectPrediction: handleRejectPrediction,
        onClearSelection: () => s.setSelectedId(null), onDeleteUserBox: handleDeleteBox,
        onChangeUserBoxClass: handleStartChangeClass, attributeSchema: currentProject?.attribute_schema,
        selectedAnnotation: selectedAnnotationForPanel, onUpdateAttributes: handleUpdateAttributes,
        currentUserId: meUserId, taskFileUrl: task?.file_url, tool: s.tool, onRunSamText: sam.runText,
        samRunning: sam.isRunning, samCandidateCount: sam.candidates.length, projectId,
        projectTypeKey: currentProject?.type_key ?? null, samTextFocusKey: s.samTextFocusKey,
        taskAiCost: taskAiMeta.totalCost, taskAiAvgMs: taskAiMeta.avgMs, taskAiPredictionCount: taskAiMeta.count,
        liveCommentCanvas: {
          active: s.canvasDraft.active,
          result: s.canvasDraft.pendingResult,
          onStart: (initial) => s.beginCanvasDraft(selectedAnnotationForPanel?.id ?? null, initial),
          onConsume: s.consumeCanvasResult,
        },
      }}
      hotkeys={{ open: showHotkeys, onClose: () => setShowHotkeys(false), attributeSchema: currentProject?.attribute_schema }}
      offlineQueue={{ open: offlineDrawerOpen, onClose: closeOfflineDrawer, currentTaskId: taskId, onFlushOne: executeOp, onFlushAll: flushOffline }}
      conflict={{ open: conflictOpen, onReload: handleConflictReload, onOverwrite: handleConflictOverwrite, onClose: () => setConflictOpen(false) }}
      rejectModal={modeState.rejectModal ? {
        open: modeState.rejectModal.open, count: 1, onClose: modeState.rejectModal.onClose,
        onConfirm: modeState.rejectModal.onConfirm, skipReasonHint: modeState.rejectModal.skipReasonHint,
      } : undefined}
    />
  );
}
