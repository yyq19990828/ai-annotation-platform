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
  useVideoFrameTimetable,
} from "@/hooks/useTasks";
import { usePredictions } from "@/hooks/usePredictions";
import {
  useAnnotationGroup,
  useAnnotationUngroup,
  useAnnotationBulkUpdate,
} from "@/hooks/useAnnotationGroup";
import { useFeedbacks } from "@/hooks/useFeedbacks";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import { tasksApi } from "@/api/tasks";
import type { AnnotationCommentAnchor } from "@/api/comments";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { predictionsApi } from "@/api/predictions";
import type { Annotation, TaskResponse, AnnotationResponse } from "@/types";
import { publishTaskBoxCount } from "@/components/PerfHud/useTaskBoxCount";

import { useWorkbenchState } from "../state/useWorkbenchState";
import { useToolBindings } from "../state/useToolBindings";
import { useViewportTransform } from "../state/useViewportTransform";
import { useAnnotationHistory } from "../state/useAnnotationHistory";
import { useRecentClasses } from "../state/useRecentClasses";
import { useSessionStats } from "../state/useSessionStats";
import { useWorkbenchHotkeys } from "../state/useWorkbenchHotkeys";
import { useCanvasDraftPersistence } from "../state/useCanvasDraftPersistence";
import { useWorkbenchTaskFlow } from "../state/useWorkbenchTaskFlow";
import { useInteractiveAI } from "../state/useInteractiveAI";
import { useMLCapabilities } from "../state/useMLCapabilities";
import { useAiToolParamPrefs } from "../state/useAiToolParamPrefs";
import { deriveDefaults } from "../components/SchemaForm";
import { AIToolDrawer } from "./AIToolDrawer";
import { IssueCreateModal } from "./IssueCreateModal";
import { IssueListPanel } from "./IssueListPanel";
import { isAIToolId } from "../stage/tools";
import { useHoveredCommentStore } from "../state/useHoveredCommentStore";
import { annotationToBox } from "../state/transforms";
import { applyVideoKeyframeToGeometry } from "../state/videoTrackCommands";
import { useAnnotateMode } from "../modes/useAnnotateMode";
import { useReviewMode } from "../modes/useReviewMode";
import { setActiveClassesConfig, UNKNOWN_CLASS } from "../stage/colors";
import type { VideoStageControls } from "../stage/VideoStage";
import { deriveSamplingStep } from "../stage/videoSamplingGrid";
import { VideoChapterSidebar, pickChapterTargetFrame } from "../stage/VideoChapterSidebar";
import { VideoTrackSidebar } from "../stage/VideoTrackSidebar";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import { isVideoBbox, isVideoTrack, resolveTrackAtFrame } from "../stage/videoStageGeometry";
import { useVideoChapters } from "@/hooks/useVideoChapters";
import { useVideoTrackerJobs } from "@/hooks/useVideoTrackerJobs";
import type { VideoTrackAnnotation } from "../stage/videoStageTypes";
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
import { useMaskEditor } from "../state/useMaskEditor";
import { MaskToolbar } from "./MaskToolbar";
import { useVideoAnnotationActions } from "../stages/video/useVideoAnnotationActions";
import styles from "./WorkbenchShell.module.css";

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
  // v0.10.17 · 工作台按当前激活工具映射到 tool_unit 拉取类别 / 属性 schema; 老项目
  // tool_bindings 为空时 fallback 到旧扁平 classes_config. 真正赋值在 s 声明之后.

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
  // v0.10.17 · 按当前激活工具的 tool_unit 派生 classes / classesConfig / attributeSchema.
  const toolView = useToolBindings(currentProject ?? null, s.tool);
  // 工具栏隐藏未启用的普通工具: 收集 tool_bindings 中 enabled 的 unit。
  // 空配置 (老项目无 tool_bindings) → null = 不过滤, 全部显示 (向后兼容)。
  const enabledToolUnits = useMemo<Set<string> | null>(() => {
    const tb = currentProject?.tool_bindings;
    if (!tb || Object.keys(tb).length === 0) return null;
    const set = new Set<string>();
    for (const [unit, binding] of Object.entries(tb)) {
      if (binding?.enabled) set.add(unit);
    }
    return set;
  }, [currentProject?.tool_bindings]);
  const classes = toolView.classes;
  const classesConfig = toolView.classesConfig;
  // toolView.toolUnitId 当前未直接被 shell 用 (POST 时由 useWorkbenchAnnotationActions
  // 内部按 s.tool 派生); 留此变量给后续 review / batch UI 显示用.
  void toolView.toolUnitId;
  // 设置全局色板覆盖 (让 ImageStage / SelectionOverlay 等无需逐层接 prop)
  useEffect(() => {
    setActiveClassesConfig(classesConfig);
    return () => setActiveClassesConfig(undefined);
  }, [classesConfig]);
  // v0.10.17 · 切工具时若 activeClass 不在新 unit 的类别集内, 自动选首个类避免错位标注.
  // 依赖只取 activeClass / classes / setActiveClass, 避免整 s 引用导致每次 state 变都 re-run.
  useEffect(() => {
    if (s.activeClass && classes.length > 0 && !classes.includes(s.activeClass)) {
      s.setActiveClass(classes[0] ?? "");
    }
  }, [s.activeClass, classes, s.setActiveClass]);
  const currentTaskId = s.currentTaskId;
  const setCurrentTaskId = s.setCurrentTaskId;
  const setSelectedId = s.setSelectedId;
  const { vp, setVp } = useViewportTransform();
  const [fitTick, setFitTick] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [aiPopoverOpen, setAiPopoverOpen] = useState(false);
  const [aiPopoverPosition, setAiPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  // B-29 · AI 工具抽屉的"已展开"状态；切到 AI 工具时默认 true，ESC / 外部点击可关闭，
  // 再次点击同一 AI 子工具按钮可再次展开（onSetTool 包装里同步置 true）。
  const [aiDrawerOpen, setAiDrawerOpen] = useState(true);
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
  const videoFrameTimetable = useVideoFrameTimetable(taskId, isVideoTask && !!videoManifest.data);
  const videoDatasetItemId = videoManifest.data?.dataset_item_id ?? null;
  const videoChaptersQuery = useVideoChapters(isVideoTask ? videoDatasetItemId : null);
  const videoChaptersData = videoChaptersQuery.data ?? [];
  const videoTimelineChapters = useMemo(
    () =>
      videoChaptersData.map((c) => ({
        id: c.id,
        startFrame: c.start_frame,
        endFrame: c.end_frame,
        title: c.title,
        color: c.color,
      })),
    [videoChaptersData],
  );
  useEffect(() => {
    if (!isVideoTask) return;
    if (videoChaptersData.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || active.isContentEditable) return;
      }
      const target = pickChapterTargetFrame(
        videoChaptersData,
        s.videoFrameIndex,
        e.key === "PageDown" ? "next" : "prev",
      );
      if (target === null) return;
      e.preventDefault();
      s.setVideoFrameIndex(target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isVideoTask, videoChaptersData, s.videoFrameIndex, s.setVideoFrameIndex]);

  const trackerJobs = useVideoTrackerJobs();
  const [propagateDialog, setPropagateDialog] = useState<{
    annotation: VideoTrackAnnotation;
    submitting: boolean;
  } | null>(null);

  const openPropagateDialog = useCallback((annotation: VideoTrackAnnotation) => {
    setPropagateDialog({ annotation, submitting: false });
  }, []);

  const handlePropagateSubmit = useCallback(
    async (payload: Parameters<typeof trackerJobs.propagate>[2]) => {
      if (!propagateDialog || !taskId) return;
      setPropagateDialog((prev) => (prev ? { ...prev, submitting: true } : prev));
      try {
        await trackerJobs.propagate(taskId, propagateDialog.annotation.id, payload);
        setPropagateDialog(null);
      } catch (e) {
        setPropagateDialog((prev) => (prev ? { ...prev, submitting: false } : prev));
        throw e;
      }
    },
    [propagateDialog, taskId, trackerJobs],
  );

  const videoFrameCount = videoManifest.data?.metadata.frame_count ?? 0;
  const videoFps = videoManifest.data?.metadata.fps ?? null;
  // v0.10.29 · 项目级采样配置 → 软网格导航。step>1 时开启网格键位 (向后兼容: 缺省 step=1 不变)。
  const videoSampling = currentProject?.video_sampling ?? null;
  const samplingStep = useMemo(
    () => (isVideoTask ? deriveSamplingStep(videoSampling, videoFps ?? 0) : 1),
    [isVideoTask, videoSampling, videoFps],
  );
  const samplingActive = samplingStep > 1;
  const videoChapterTimebase = useMemo(
    () =>
      videoFps && videoFrameCount > 0
        ? {
            fps: videoFps,
            frameCount: videoFrameCount,
            source: "estimated" as const,
            ptsMs: null,
          }
        : undefined,
    [videoFps, videoFrameCount],
  );
  const resetVideoStageUi = s.resetVideoStageUi;

  useEffect(() => {
    resetVideoStageUi();
    setAiPopoverOpen(false);
  }, [taskId, resetVideoStageUi]);

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

  // v0.10.18 · 发布当前 task 框数到 PerfHud 浏览器侧指标 store
  useEffect(() => {
    publishTaskBoxCount(annotationsRef.current.length);
  }, [annotationsData]);

  // Shift+T 在视频模式下对选中轨迹打开 propagate 对话框
  useEffect(() => {
    if (!isVideoTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "T" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || active.isContentEditable) return;
      }
      const sel = annotationsRef.current.find((ann) => ann.id === s.selectedId);
      if (!sel || !isVideoTrack(sel)) return;
      e.preventDefault();
      openPropagateDialog(sel as VideoTrackAnnotation);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVideoTask, s.selectedId, openPropagateDialog]);
  const predictionsInfinite = usePredictions(taskId, undefined, debouncedConf);
  const predictionsPages = predictionsInfinite.data?.pages ?? [];
  const predictionsData = useMemo(
    () => predictionsPages.flatMap((p) => p),
    [predictionsPages],
  );

  const userBoxes = useMemo(
    () => (annotationsData ?? [])
      .filter((ann) => !(isVideoTask && ann.geometry.type === "video_track"))
      .map(annotationToBox),
    [annotationsData, isVideoTask],
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
  // I12 · Object Group + 批量编辑 mutations; taskId 缺省时 hook 走空字符串占位, mutation 不会被实际触发 (Ctrl+G 在 useWorkbenchHotkeys 内只在 hasSelection 时消费).
  // bulkUpdate hook 已就位但本切片 UI 未消费 (留 v0.10.20 接 BoxList group 卡片 + AttributeForm 多选 banner).
  const groupAnnotationMut = useAnnotationGroup(taskId ?? "");
  const ungroupAnnotationMut = useAnnotationUngroup(taskId ?? "");
  // v0.10.20 · I12 完整 UI: 多选 AttributeForm.onChange fan-out 走此 mutation; 单条 PATCH 仍走 handleUpdateAttributes.
  const bulkUpdateMut = useAnnotationBulkUpdate(taskId ?? "");

  // I18 · Issue 浮层入口 (v0.10.19 简化版, Konva pin 渲染留 v0.10.20).
  const [issueCreateOpen, setIssueCreateOpen] = useState(false);
  const [issueListOpen, setIssueListOpen] = useState(false);
  // v0.10.20 · I18 IssueLayer · drop-arm 模式 + pin 高亮 + 单击落点预填 anchor.
  const [issuePinDropArmed, setIssuePinDropArmed] = useState(false);
  const [issuePinPrefill, setIssuePinPrefill] = useState<{ x: number; y: number } | null>(null);
  const [highlightIssueId, setHighlightIssueId] = useState<string | null>(null);
  const issueListParams = useMemo(
    () => ({
      project_id: projectId ?? "",
      task_id: taskId,
      kind: "issue" as const,
    }),
    [projectId, taskId],
  );
  const issuesQuery = useFeedbacks(issueListParams, !!projectId && !!taskId);
  const openIssueCount = (issuesQuery.data?.items ?? []).filter((i) => i.status === "open").length;
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
  // v0.10.1 · ML backend 能力协商 (供 ToolDock 置灰 + AIToolDrawer 渲染参数面板)
  const mlCapabilities = useMLCapabilities(
    projectId ?? null,
    currentProject?.ml_backend_id ?? null,
  );
  // 用户级 AI 工具参数偏好 (按 backend 分桶, 多用户隔离不打架)。读取优先级链:
  // 用户保存值 → 后端 /setup 默认。参数是后端级 (非工具级), 在悬浮 AI 面板调整。
  const aiParamPrefs = useAiToolParamPrefs(currentProject?.ml_backend_id ?? null);
  // 切题清候选；切工具离开 AI 工具组也清（避免用户切回 box 时仍残留紫虚线）
  useEffect(() => {
    sam.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  // v0.10.4 I6.2 · 图片任务 + 已绑定 backend 时异步触发 embed 预热（每 (task, backend) 一次）
  // warmup 发的是 type=point 探针; backend 不支持 point (如 sam3) 时跳过, 避免每次开图都打一个
  // 注定 4xx 的无用请求 (encoder 会在首次真实 text/exemplar 交互时懒加载)。
  const warmupPointSupported = mlCapabilities.isPromptSupported("point");
  useEffect(() => {
    if (stageKind !== "image") return;
    if (!taskId || !currentProject?.ml_backend_id) return;
    if (!warmupPointSupported) return;
    sam.warmup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKind, taskId, currentProject?.ml_backend_id, warmupPointSupported]);
  useEffect(() => {
    if (!isAIToolId(s.tool) && sam.candidates.length > 0) sam.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tool]);
  // 切到 text-prompt 工具时 bump 输入焦点。(参数不再随工具重置 — 已是后端级。)
  useEffect(() => {
    if (s.tool === "text-prompt") s.bumpSamTextFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tool]);
  // 后端级 AI 参数 seed: 后端 /setup 能力 + 用户偏好就绪后, 按 用户保存值 → /setup 默认 填入,
  // 每个 backend 只 seed 一次 (避免覆盖用户当前会话内的调整)。
  const aiParamDefaults = useMemo(
    () => deriveDefaults(mlCapabilities.paramsSchema),
    [mlCapabilities.paramsSchema],
  );
  const seededBackendRef = useRef<string | null>(null);
  useEffect(() => {
    const bid = currentProject?.ml_backend_id ?? null;
    if (!bid || !mlCapabilities.paramsSchema || !aiParamPrefs.loaded) return;
    if (seededBackendRef.current === bid) return;
    seededBackendRef.current = bid;
    s.setAiToolParams(aiParamPrefs.savedParams ?? aiParamDefaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.ml_backend_id, mlCapabilities.paramsSchema, aiParamPrefs.loaded, aiParamPrefs.savedParams]);
  // 用户在悬浮 AI 面板调整参数后持久化到用户偏好 (按 backend 分桶, 防抖)。与 /setup 默认一致时不落库,
  // 避免把默认值污染成"用户保存值"; 仅持久化用户实际改动。
  useEffect(() => {
    if (!currentProject?.ml_backend_id) return;
    if (Object.keys(s.aiToolParams).length === 0) return;
    if (JSON.stringify(s.aiToolParams) === JSON.stringify(aiParamDefaults)) return;
    aiParamPrefs.save(s.aiToolParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.aiToolParams, currentProject?.ml_backend_id]);
  // v0.10.2 · 兜底: 能力变化使当前 AI 工具不再支持 → 切回 hand + toast
  useEffect(() => {
    if (mlCapabilities.isLoading) return;
    if (!isAIToolId(s.tool)) return;
    const requiredPrompt = (
      { "smart-point": "point", "smart-box": "bbox", "text-prompt": "text", exemplar: "exemplar" } as const
    )[s.tool as "smart-point" | "smart-box" | "text-prompt" | "exemplar"];
    if (!mlCapabilities.isPromptSupported(requiredPrompt)) {
      s.setTool("hand");
      pushToast({
        msg: "当前后端不支持此 AI 工具",
        sub: "已切回手型；请到项目设置切换后端",
        kind: "warning",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mlCapabilities.prompts.join(","), mlCapabilities.isLoading]);
  useEffect(() => {
    if (!isVideoTask) return;
    if (s.tool !== "box" && s.tool !== "hand") s.setTool("box");
  }, [isVideoTask, s.tool, s.setTool]);

  // B-29 · AI 工具激活时, 按 ESC 仅关闭 AIToolDrawer 子面板, 不切换工具
  // (用户反馈: ESC 直接切到 hand 会丢失 SAM 子工具选择, 只想隐藏遮挡画布的子面板).
  // input/textarea/contentEditable 内的 ESC 不触发, 避免吃掉用户在文本提示框里的 IME 取消等.
  useEffect(() => {
    if (!isAIToolId(s.tool)) return;
    if (!aiDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || active.isContentEditable) return;
      }
      // capture + stopImmediatePropagation 让 useWorkbenchHotkeys 的 cancel 不被触发
      // (用户只想关面板, 不想顺带清掉选中 / pendingDrawing 等).
      e.preventDefault();
      e.stopImmediatePropagation();
      setAiDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [s.tool, aiDrawerOpen]);

  // B-29 · 子面板可见时, 点击画布或其他位置先关闭子面板; 若点击落在画布上还需消耗这次点击,
  // 避免 SAM 子工具误投点 / 误投框. 用 capture 阶段, 在 ImageStage 的 pointerdown 之前拦截.
  useEffect(() => {
    if (!isAIToolId(s.tool)) return;
    if (!aiDrawerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 抽屉内部 / ToolDock 内部的点击不触发关闭 (ToolDock 内含 AI 工具按钮, 再点击会重开抽屉)
      if (target.closest("[data-ai-drawer-root]")) return;
      if (target.closest("[data-workbench-tool-dock]")) return;
      setAiDrawerOpen(false);
      if (target.closest("[data-workbench-stage]")) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [s.tool, aiDrawerOpen]);

  // 切到 AI 工具时, 默认展开子面板 (从其他工具切回 AI 工具是显式意图).
  useEffect(() => {
    if (isAIToolId(s.tool)) setAiDrawerOpen(true);
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
  // v0.10.8 · I11 · Mask 编辑器状态层。width/height 跟 stage 图像像素同步；
  // imgW/imgH 未就绪时 hook 仍返回完整 API（active=false），不影响 box/polygon 等其它工具。
  const maskEditor = useMaskEditor({
    width: stageGeom.imgW || 1,
    height: stageGeom.imgH || 1,
  });

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
    toolBindings: currentProject?.tool_bindings,
    activeToolHasOwnClasses: toolView.hasOwnClasses,
    keypointNodeCount: toolView.keypointSchema?.nodes.length ?? 0,
    sam,
    createAnnotationAsync: (payload) => createAnnotation.mutateAsync(payload),
    isLocked: isLockedForActions,
    enqueueOnError,
    maskEditor,
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
    submitPolyline,
    handleDeleteBox,
    handlePatchShapeFlag,
    handleCommitMove,
    handleCommitResize,
    handleCommitPolygonGeometry,
    handleCommitKeypointGeometry,
    polygonDraftPoints,
    setPolygonDraftPoints,
    polygonHandle,
    polylineHandle,
    keypointHandle,
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
    createRotatedBbox,
    handleCommitRotateBbox,
    handleStartChangeClass,
    handleCommitChangeClass,
    handleCancelChangeClass,
    handleSamCommitClass,
    handleSamCancelClass,
  } = imageActions;
  const imageContextMenuClipboard = useMemo(() => ({
    copyAnnotation: (annotation: Annotation) => clipboard.copyAnnotations([annotation]),
    paste: clipboard.paste,
    hasClipboard: clipboard.hasClipboard,
  }), [clipboard]);


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
    // B-8: 工作台 AI 预标 — 单图触发要求项目已绑定 ML backend
    const mlBackendId = currentProject?.ml_backend_id;
    if (!mlBackendId) {
      pushToast({
        msg: "AI 暂不可用",
        sub: "项目尚未绑定 ML 推理后端,请到「项目设置 → AI 配置」注册并选择",
        kind: "error",
      });
      return;
    }
    // B-12 · DINO 后端要求 prompt 非空 (无 prompt 直接 422); 用项目所有 alias
    // 拼成默认 prompt, 让 AI 预标自带"识别所有已配类别"的语义.
    const aliases: string[] = [];
    const cfg = currentProject?.classes_config ?? {};
    for (const entry of Object.values(cfg)) {
      const alias = (entry as { alias?: string | null } | undefined)?.alias;
      if (typeof alias === "string" && alias.trim()) aliases.push(alias.trim());
    }
    if (aliases.length === 0) {
      pushToast({
        msg: "AI 暂不可用",
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
    handleVideoBatchRename,
    handleVideoBatchDelete,
    handleVideoSetSelectedClass,
    handleVideoConvertToBboxes,
    handleVideoComposeTracks,
    handleUpdateTrackAttributes,
    handleUpdateKeyframeAttributes,
    handlePropagateKeyframe,
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
      delete: { mutate: (id, opts) => deleteAnnotationMut.mutate(id, opts) },
    },
  });

  const handlePickPendingClassAny = useCallback((cls: string) => {
    if (handlePickVideoPendingClass(cls)) return;
    handlePickPendingClass(cls);
  }, [handlePickPendingClass, handlePickVideoPendingClass]);

  const handleCancelPending = useCallback((reason: "escape" | "outside") => {
    // Esc 是明确放弃本次绘制；点外部保留原兜底，落 __unknown 供后续补类。
    if (reason === "escape") {
      s.setPendingDrawing(null);
      return;
    }
    if (s.pendingDrawing) handlePickPendingClassAny(UNKNOWN_CLASS);
    else s.setPendingDrawing(null);
  }, [s, handlePickPendingClassAny]);

  /** 选中态的 AnnotationResponse（驱动右侧栏属性表单）。仅单选 user 框时返回。 */
  const selectedAnnotationForPanel = useMemo<AnnotationResponse | null>(() => {
    if (!s.selectedId || s.selectedIds.length > 1) return null;
    return (annotationsData ?? []).find((a) => a.id === s.selectedId) ?? null;
  }, [s.selectedId, s.selectedIds.length, annotationsData]);

  const videoCommentAnchor = useMemo<AnnotationCommentAnchor | null>(() => {
    const ann = selectedAnnotationForPanel;
    if (!isVideoTask || !ann) return null;
    if (isVideoTrack(ann)) {
      const resolved = resolveTrackAtFrame(ann.geometry, s.videoFrameIndex);
      return {
        kind: "video_frame",
        frameIndex: s.videoFrameIndex,
        trackId: ann.geometry.track_id,
        source: resolved?.source ?? null,
      };
    }
    if (isVideoBbox(ann)) {
      return {
        kind: "video_frame",
        frameIndex: ann.geometry.frame_index,
        source: "legacy",
      };
    }
    return null;
  }, [isVideoTask, s.videoFrameIndex, selectedAnnotationForPanel]);

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

  // I12 · Ctrl+G / Ctrl+Shift+G 触发 group/ungroup; 校验通过后 mutation, 失败 toast.
  const handleAnnotationGroup = useCallback(() => {
    if (!taskId) return;
    const ids = s.selectedIds;
    if (ids.length < 2) {
      pushToast({ msg: "至少选择 2 个标注才能成组", kind: "warning" });
      return;
    }
    groupAnnotationMut.mutate(ids, {
      onSuccess: (resp) => {
        pushToast({ msg: `已成组 (group #${resp.group_id}, ${resp.affected_ids.length} 个)`, kind: "success" });
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "成组失败";
        pushToast({ msg, kind: "error" });
      },
    });
  }, [taskId, s.selectedIds, groupAnnotationMut, pushToast]);

  const handleAnnotationUngroup = useCallback(() => {
    if (!taskId) return;
    const ids = s.selectedIds;
    if (ids.length === 0) {
      pushToast({ msg: "请先选择已成组的标注", kind: "warning" });
      return;
    }
    ungroupAnnotationMut.mutate(ids, {
      onSuccess: (resp) => {
        const extra = resp.auto_cleared_orphans.length > 0
          ? ` (含 ${resp.auto_cleared_orphans.length} 个自动解散的剩 1 个成员)`
          : "";
        pushToast({ msg: `已解组 ${resp.cleared_ids.length} 个${extra}`, kind: "success" });
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "解组失败";
        pushToast({ msg, kind: "error" });
      },
    });
  }, [taskId, s.selectedIds, ungroupAnnotationMut, pushToast]);

  // ── 键盘快捷键（v0.6.4 P1 抽 hook） ───────────────────────────────────
  const { spacePan, nudgeMap } = useWorkbenchHotkeys({
    s, history, classes, currentProject, annotationsRef,
    batchChanging, setBatchChanging, showHotkeys,
    navigateTask, smartNext, setFitTick,
    recordRecentClass, handleDeleteBox, handleBatchDelete, handlePatchShapeFlag,
    handleStartChangeClass, handleStartBatchChangeClass,
    handleSubmitTask, handleAcceptPrediction, handleRejectPrediction, handleUpdateAttributes,
    handleVideoSetSelectedClass,
    aiBoxes, setShowHotkeys, clipboard, pushToast, stageGeom,
    polygonDraftPoints, setPolygonDraftPoints, submitPolygon, submitPolyline,
    updateMutation: { mutate: (vars) => updateAnnotationMut.mutate(vars) },
    taskId,
    videoMode: isVideoTask,
    samplingActive,
    videoControlsRef,
    isPromptSupported: mlCapabilities.isPromptSupported,
    maskEditor,
    commitMaskAsPolygon,
    cancelMaskEdit,
    handleAnnotationGroup,
    handleAnnotationUngroup,
  });
  if (isProjectLoading) {
    return <WorkbenchSkeleton />;
  }

  if (!currentProject) {
    return (
      <div className={styles.emptyState}>
        <Icon name="warning" size={40} />
        <div className={styles.emptyStateText}>项目不存在或无访问权限</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回</Button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Icon name="inbox" size={40} />
        <div className={styles.emptyStateText}>该项目暂无任务</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回</Button>
      </div>
    );
  }

  // 窄屏强制收两侧
  const leftOpen = isNarrow ? false : s.leftOpen;
  const rightOpen = isNarrow ? false : s.rightOpen;

  const propagateDialogTrack = propagateDialog?.annotation ?? null;
  const propagateDialogNextKeyframe = propagateDialogTrack
    ? [...propagateDialogTrack.geometry.keyframes]
        .map((kf) => kf.frame_index)
        .filter((idx) => idx > s.videoFrameIndex)
        .sort((a, b) => a - b)[0] ?? null
    : null;

  return (
    <>
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
        tool: s.tool,
        onSetTool: (next) => {
          s.setTool(next);
          // B-29 · 再次点击 AI 子工具按钮 (即使已激活) 也应重开抽屉.
          // 由于 capture-pointerdown 已经把 aiDrawerOpen 设为 false, 这里同步置回 true.
          if (isAIToolId(next)) setAiDrawerOpen(true);
        },
        videoTool: s.videoTool, onSetVideoTool: s.setVideoTool,
        isPromptSupported: mlCapabilities.isPromptSupported,
        capabilitiesLoading: mlCapabilities.isLoading,
        aiToolDrawer: isAIToolId(s.tool) && aiDrawerOpen ? (
          <AIToolDrawer
            tool={s.tool}
            backendName={mlCapabilities.capability?.name}
            capability={mlCapabilities.capability}
            samPolarity={s.samPolarity}
            onSetSamPolarity={s.setSamPolarity}
            isLoading={mlCapabilities.isLoading}
            isError={mlCapabilities.isError}
            onRunSamText={(text, mode) => sam.runText(text, mode, { ...s.aiVariant, ...s.aiToolParams })}
            samRunning={sam.isRunning}
            samCandidateCount={sam.candidates.length}
            projectId={projectId}
            projectTypeKey={currentProject?.type_key ?? null}
            samTextFocusKey={s.samTextFocusKey}
            exemplarOutputMode={s.exemplarOutputMode}
            onSetExemplarOutputMode={s.setExemplarOutputMode}
          />
        ) : null,
        reviewMode: mode === "review", videoMode: isVideoTask,
        enabledToolUnits,
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
        onShowHotkeys: () => setShowHotkeys(true),
        onRunAi: () => {
          const nextOpen = !aiPopoverOpen;
          setAiPopoverOpen(nextOpen);
          if (nextOpen && !s.rightOpen) s.setRightOpen(true);
        },
        aiDisabled: isVideoTask,
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
        videoFrameTimetable: videoFrameTimetable.data,
        videoChapters: isVideoTask ? videoTimelineChapters : undefined,
        videoSampling,
        videoManifestError: videoManifest.error, videoTool: s.videoTool,
        videoFrameIndex: s.videoFrameIndex,
        videoReviewDisplayMode: mode === "review" ? modeState.diffMode : undefined,
        hiddenVideoTrackIds: s.hiddenVideoTrackIds,
        lockedVideoTrackIds: s.lockedVideoTrackIds,
        onVideoFrameIndexChange: s.setVideoFrameIndex,
        onVideoCreate: handleVideoCreate,
        onVideoPendingDraw: handleVideoPendingDraw, onVideoUpdate: handleVideoUpdate,
        onVideoRename: handleVideoRename, onVideoConvertToBboxes: handleVideoConvertToBboxes,
        onVideoComposeTracks: handleVideoComposeTracks,
        onToggleHiddenVideoTrack: s.toggleHiddenVideoTrack,
        onToggleLockedVideoTrack: s.toggleLockedVideoTrack,
        onPropagateVideoTrack: openPropagateDialog,
        fileUrl, blurhash, thumbnailUrl, tool: s.tool, selectedIds: s.selectedIds, fadedAiIds: dimmedAiIds,
        nudgeMap, userBoxes: modeState.diffMode === "raw" ? [] : userBoxes,
        aiBoxes: modeState.diffMode === "final" ? [] : aiBoxes, spacePan, vp, setVp, fitTick, setFitTick,
        pendingDrawing: s.pendingDrawing, onAcceptPrediction: handleAcceptPrediction,
        onRejectPrediction: handleRejectPrediction, onDeleteUserBox: handleDeleteBox,
        onPatchShapeFlag: handlePatchShapeFlag,
        imageClipboardActions: imageContextMenuClipboard,
        onCommitDrawing: handleCommitDrawing,
        // v0.10.28 · 旋转框 (OBB) 创建 + 旋转角更新.
        onCommitRotatedBbox: createRotatedBbox,
        onCommitRotateBbox: handleCommitRotateBbox,
        onSamPrompt: (prompt) => {
          // v0.10.2 · 按 prompt.kind 路由; exemplar 与 bbox 同手势但走独立 dispatcher.
          // params 透传 (box_threshold 等) — 见 useInteractiveAI.extraParams.
          // v0.10.23 · 会话级模型变体 (aiVariant) 合进 context; tool 级参数 (aiToolParams) 覆盖之.
          const extra = { ...s.aiVariant, ...s.aiToolParams };
          if (prompt.kind === "point") return sam.runPoint(prompt.pt, prompt.alt ? 0 : 1, extra);
          if (prompt.kind === "exemplar") return sam.runExemplar(prompt.bbox, s.exemplarOutputMode, extra);
          return sam.runBbox(prompt.bbox, extra);
        },
        samCandidates: sam.candidates, samActiveIdx: sam.activeIdx, samSubTool: s.samSubTool,
        samPolarity: s.samPolarity, onCommitMove: handleCommitMove, onCommitResize: handleCommitResize,
        onCommitPolygonGeometry: handleCommitPolygonGeometry, onChangeUserBoxClass: handleStartChangeClass,
        onBatchDelete: handleBatchDelete, onBatchChangeClass: handleStartBatchChangeClass,
        onStageGeometry: setStageGeom,
        polygonDraft: s.tool === "polygon" ? polygonHandle : s.tool === "polyline" ? polylineHandle : undefined,
        // v0.10.28 · keypoint 工具草稿 + 骨骼模板 + 节点几何提交.
        keypointDraft: s.tool === "keypoint" ? keypointHandle : undefined,
        keypointSchema: toolView.keypointSchema,
        onCommitKeypointGeometry: handleCommitKeypointGeometry,
        canvasShapes: s.canvasDraft.shapes, canvasEditable: s.canvasDraft.active, canvasStroke: s.canvasDraft.stroke,
        onCanvasStrokeCommit: (points, stroke) => s.appendCanvasShape({ type: "line", points, stroke }),
        historicalShapes: hoveredCommentShapes ?? undefined, canUndo: history.canUndo, canRedo: history.canRedo,
        onUndo: history.undo, onRedo: history.redo, onSetCanvasStroke: s.setCanvasStroke,
        canvasShapeCount: s.canvasDraft.shapes.length, onUndoCanvasShape: s.undoCanvasShape,
        onClearCanvasShapes: s.clearCanvasShapes, onCancelCanvasDraft: s.cancelCanvasDraft,
        onDoneCanvasDraft: s.endCanvasDraft, stageGeom,
        maskEditor,
        onRefineSamCandidate: handleRefineSamCandidate,
        // v0.10.10 · I17.3 · 项目级渲染配置覆盖（合进 useWorkbenchConfig）
        projectRenderingConfig: currentProject?.rendering_config ?? null,
        // v0.10.20 · I18 · pixel-anchored issue 同步到 Konva pin 渲染.
        issuePixelFeedbacks: issuesQuery.data?.items ?? [],
        highlightIssueId: highlightIssueId,
        onIssuePinClick: (id) => {
          setHighlightIssueId(id);
          setIssueListOpen(true);
        },
        issuePinDropArmed: issuePinDropArmed,
        onIssuePinDrop: (x, y) => {
          setIssuePinDropArmed(false);
          setIssuePinPrefill({ x, y });
          setIssueCreateOpen(true);
        },
        overlays: (
          <>
            {s.tool === "mask" && (
              <MaskToolbar
                active={maskEditor.active}
                mode={maskEditor.mode}
                radius={maskEditor.radius}
                dirty={maskEditor.dirty}
                onSetMode={maskEditor.setMode}
                onSetRadius={maskEditor.setRadius}
                onCommit={commitMaskAsPolygon}
                onCancel={cancelMaskEdit}
              />
            )}
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
          </>
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
        aiBoxes: modeState.diffMode !== "final" ? aiBoxes : [],
        userBoxes, selectedId: s.selectedId, selectedIds: s.selectedIds,
        dimmedAiIds,
        imageWidth, imageHeight, onToggle: () => s.setRightOpen(!s.rightOpen),
        onSelect: handleSelectBox,
        onAcceptPrediction: handleAcceptPrediction,
        onRejectPrediction: handleRejectPrediction,
        onRefinePrediction: handleRefinePrediction,
        onRefineUserPolygon: handleRefineUserPolygon,
        onClearSelection: () => s.setSelectedId(null), onDeleteUserBox: handleDeleteBox,
        onChangeUserBoxClass: handleStartChangeClass,
        onToggleUserBoxFlag: (id: string, flag: "is_locked" | "is_hidden" | "is_occluded") => {
          const ann = userBoxes.find((b) => b.id === id);
          if (!ann) return;
          const cur = !!ann[flag];
          handlePatchShapeFlag(id, flag, !cur);
        },
        // v0.10.17 · 按当前激活工具 unit 派生 attribute_schema (替代项目级扁平字段).
        attributeSchema: toolView.attributeSchema,
        selectedAnnotation: selectedAnnotationForPanel, onUpdateAttributes: handleUpdateAttributes,
        // v0.10.20 · I12 完整 UI: 多选 fan-out 到 useAnnotationBulkUpdate; group 卡片头点击 → 整组选中.
        onBulkUpdateAttributes: (ids, patch) => {
          if (!taskId || ids.length === 0) return;
          bulkUpdateMut.mutate({ ids, patch });
        },
        onSelectGroup: (memberIds) => s.replaceSelected(memberIds),
        currentUserId: meUserId, taskFileUrl: task?.file_url,
        hasMorePredictions: modeState.diffMode !== "final" && !!predictionsInfinite.hasNextPage,
        isFetchingMorePredictions: modeState.diffMode !== "final" && predictionsInfinite.isFetchingNextPage,
        onFetchMorePredictions: () => predictionsInfinite.fetchNextPage(),
        currentFrameIndex: isVideoTask ? s.videoFrameIndex : undefined,
        onSeekFrame: isVideoTask ? s.setVideoFrameIndex : undefined,
        commentAnchor: videoCommentAnchor,
        // I4 · 未选中标注时 CommentsPanel 走 task 级降级 (评论/历史汇总该 task 下所有标注).
        taskId: taskId ?? null,
        videoTrackPanel: isVideoTask ? ((frameFilter) => (
          <div className={styles.videoTrackPanel}>
            <VideoTrackSidebar
              annotations={annotationsData ?? []}
              selectedId={s.selectedId}
              selectedIds={s.selectedIds}
              frameIndex={s.videoFrameIndex}
              trackFilter={frameFilter}
              readOnly={isLocked}
              hiddenTrackIds={s.hiddenVideoTrackIds}
              lockedTrackIds={s.lockedVideoTrackIds}
              classes={classes}
              onSelect={(id) => handleSelectBox(id)}
              onToggleHiddenTrack={s.toggleHiddenVideoTrack}
              onToggleLockedTrack={s.toggleLockedVideoTrack}
              onSeekFrame={s.setVideoFrameIndex}
              reviewDisplayMode={mode === "review" ? modeState.diffMode : undefined}
              onChangeUserBoxClass={handleStartChangeClass}
              onRenameTracks={handleVideoBatchRename}
              onDeleteTracks={handleVideoBatchDelete}
              onUpdate={handleVideoUpdate}
              onConvertToBboxes={handleVideoConvertToBboxes}
              onComposeTracks={handleVideoComposeTracks}
              trackerJobsByAnnotation={trackerJobs.byAnnotation}
              onPropagateTrack={openPropagateDialog}
              onCancelTrackerJob={trackerJobs.cancel}
              trackColorOverrides={s.trackColorOverrides}
              onSetTrackColor={s.setVideoTrackColor}
              attributeSchema={toolView.attributeSchema}
              onUpdateTrackAttributes={handleUpdateTrackAttributes}
              onUpdateKeyframeAttributes={handleUpdateKeyframeAttributes}
              onPropagateKeyframe={handlePropagateKeyframe}
              samplingStep={samplingStep}
            />
            <VideoChapterSidebar
              datasetItemId={videoDatasetItemId}
              frameIndex={s.videoFrameIndex}
              maxFrame={Math.max(0, videoFrameCount - 1)}
              timebase={videoChapterTimebase}
              canEdit={!isLocked && isOwner}
              onSeekFrame={s.setVideoFrameIndex}
            />
          </div>
        )) : undefined,
        liveCommentCanvas: {
          active: s.canvasDraft.active,
          result: s.canvasDraft.pendingResult,
          onStart: (initial) => s.beginCanvasDraft(selectedAnnotationForPanel?.id ?? null, initial),
          onConsume: s.consumeCanvasResult,
        },
      }}
      aiPopover={{
        open: aiPopoverOpen && !isVideoTask,
        rightOffset: rightOpen ? s.rightWidth + 44 : 44,
        position: aiPopoverPosition,
        onPositionChange: setAiPopoverPosition,
        aiModel, aiRunning, aiBoxCount: modeState.diffMode !== "final" ? aiBoxes.length : 0,
        confThreshold: s.confThreshold, aiTakeoverRate,
        onClose: () => setAiPopoverOpen(false),
        onRunAi: handleRunAi,
        onAcceptAll: handleAcceptAll,
        onSetConfThreshold: s.setConfThreshold,
        taskAiCost: taskAiMeta.totalCost,
        taskAiAvgMs: taskAiMeta.avgMs,
        taskAiPredictionCount: taskAiMeta.count,
        // v0.10.23 · 设计 A · 会话级模型变体选择 (切工具不丢); /setup.params enum 直接渲染.
        paramsSchema: mlCapabilities.paramsSchema,
        aiVariant: s.aiVariant,
        onSetAiVariant: s.setAiVariant,
        // 后端级推理参数 (阈值等, 非变体字段): 在悬浮 AI 面板用 SchemaForm 渲染, 而非子工具抽屉。
        params: s.aiToolParams,
        onSetParams: s.setAiToolParams,
      }}
      hotkeys={{ open: showHotkeys, onClose: () => setShowHotkeys(false), attributeSchema: toolView.attributeSchema }}
      offlineQueue={{ open: offlineDrawerOpen, onClose: closeOfflineDrawer, currentTaskId: taskId, onFlushOne: executeOp, onFlushAll: flushOffline }}
      conflict={{ open: conflictOpen, onReload: handleConflictReload, onOverwrite: handleConflictOverwrite, onClose: () => setConflictOpen(false) }}
      rejectModal={modeState.rejectModal ? {
        open: modeState.rejectModal.open, count: 1, onClose: modeState.rejectModal.onClose,
        onConfirm: modeState.rejectModal.onConfirm, skipReasonHint: modeState.rejectModal.skipReasonHint,
      } : undefined}
      guidePanel={projectId ? {
        projectId,
        content: (currentProject as unknown as { annotation_guide?: string | null } | undefined)?.annotation_guide ?? null,
      } : undefined}
    />
    <VideoTrackerPropagateDialog
      open={Boolean(propagateDialog)}
      frameIndex={s.videoFrameIndex}
      maxFrame={Math.max(0, videoFrameCount - 1)}
      nextKeyframeAfter={propagateDialogNextKeyframe}
      samplingStep={samplingStep}
      submitting={Boolean(propagateDialog?.submitting)}
      onCancel={() => setPropagateDialog(null)}
      onSubmit={handlePropagateSubmit}
    />
    {/* I18 · Issue 浮动入口 + v0.10.20 Pin drop-arm FAB. */}
    {projectId && taskId && (
      <>
        <button
          type="button"
          aria-label={`查看 issue 列表 (${openIssueCount} 待处理)`}
          title={`Issue: ${openIssueCount} 个待处理`}
          onClick={() => setIssueListOpen(true)}
          className={styles.issueFab}
          data-testid="issue-fab"
        >
          <Icon name="flag" size={14} />
          {openIssueCount > 0 && <span className={styles.issueFabBadge}>{openIssueCount}</span>}
        </button>
        {/* v0.10.20 · drop-arm FAB; 激活后单击图像落点弹 IssueCreateModal 预填 anchor. */}
        {stageKind === "image" && (
          <button
            type="button"
            aria-label={issuePinDropArmed ? "取消像素 issue 落点模式" : "进入像素 issue 落点模式"}
            title={issuePinDropArmed ? "再次点击取消" : "单击图像落点创建像素 issue"}
            onClick={() => setIssuePinDropArmed((v) => !v)}
            className={`${styles.issueFab} ${styles.issuePinFab}${issuePinDropArmed ? " " + styles.issuePinFabArmed : ""}`}
            data-testid="issue-pin-fab"
            data-armed={issuePinDropArmed ? "true" : "false"}
          >
            <Icon name="crosshair" size={14} />
          </button>
        )}
        <IssueListPanel
          open={issueListOpen}
          projectId={projectId}
          taskId={taskId}
          highlightId={highlightIssueId}
          onClose={() => { setIssueListOpen(false); setHighlightIssueId(null); }}
          onCreateNew={() => { setIssueListOpen(false); setIssueCreateOpen(true); }}
        />
        <IssueCreateModal
          open={issueCreateOpen}
          projectId={projectId}
          taskId={taskId}
          listParams={issueListParams}
          prefilledAnchor={issuePinPrefill}
          onClose={() => { setIssueCreateOpen(false); setIssuePinPrefill(null); }}
        />
      </>
    )}
    </>
  );
}
