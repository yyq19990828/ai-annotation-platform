import {
  useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import {
  useTaskList, useTask, useAnnotations, useCreateAnnotation, useDeleteAnnotation,
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
import {
  resolveCrossFrameNavigation,
  resolveCrossFrameTarget,
} from "./crossFrameTarget";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { predictionsApi } from "@/api/predictions";
import type { Annotation, TaskResponse, AnnotationResponse } from "@/types";
import { ANNOTATION_GUIDE_UI_ENABLED } from "@/config/featureFlags";
import { publishTaskBoxCount } from "@/components/PerfHud/useTaskBoxCount";
import { useWorkbenchState } from "./useWorkbenchState";
import { useToolBindings, classesForUnit } from "./useToolBindings";
import type { ToolUnitId } from "@/constants/toolUnits";
import { useViewportTransform } from "./useViewportTransform";
import { useAnnotationHistory } from "./useAnnotationHistory";
import { useRecentClasses } from "./useRecentClasses";
import { useSessionStats } from "./useSessionStats";
import { useWorkbenchHotkeys } from "./useWorkbenchHotkeys";
import { useCanvasDraftPersistence } from "./useCanvasDraftPersistence";
import { useWorkbenchTaskFlow } from "./useWorkbenchTaskFlow";
import { useInteractiveAI, type TextOutputMode } from "./useInteractiveAI";
import { resolveInitialOutputMode, writeStoredOutputMode } from "./samTextOutput";
import { shouldConfirmAnnotationDelete } from "./deleteConfirmation";
import { usePreannotateConfig } from "@/pages/AIPreAnnotate/components/usePreannotateConfig";
import { useMLBackends } from "@/hooks/useMLBackends";
import { useMLCapabilities } from "./useMLCapabilities";
import {
  useBackendRouting,
  INTERACTIVE_PROMPTS,
  type InteractivePrompt,
} from "./useBackendRouting";
import { useCapabilityValidation } from "./useCapabilityValidation";
import {
  VARIANT_FIELD_KEYS,
} from "../components/SchemaForm";
import { AIToolDrawer } from "../shell/AIToolDrawer";
import { IssueCreateModal } from "../shell/IssueCreateModal";
import { isAIToolId, TOOL_REGISTRY, type ToolId } from "../stage/tools";
import { useHoveredCommentStore, selectEffectiveShapes } from "./useHoveredCommentStore";
import { useActiveIssueStore } from "./useActiveIssueStore";
import { annotationToBox, collectOccludedKeys } from "./transforms";
import { applyVideoKeyframeToGeometry } from "./videoTrackCommands";
import { useAnnotateMode } from "../modes/useAnnotateMode";
import { useReviewMode } from "../modes/useReviewMode";
import { setActiveClassesConfig, UNKNOWN_CLASS } from "../stage/colors";
import type { VideoStageControls } from "../stage/videoStageControls";
import { deriveSamplingStep } from "../stage/videoSamplingGrid";
import { VideoChapterSidebar, pickChapterTargetFrame } from "../stage/VideoChapterSidebar";
import { VideoTrackSidebar } from "../stage/VideoTrackSidebar";
import type { TrackFilter } from "../stage/VideoTrackPanel";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import { isVideoBbox, isVideoTrack, resolveTrackAtFrame } from "../stage/videoStageGeometry";
import type { AnnotationCommentAnchor } from "@/api/comments";
import { useVideoChapters } from "@/hooks/useVideoChapters";
import { useVideoTrackerJobs } from "@/hooks/useVideoTrackerJobs";
import type { VideoTrackAnnotation } from "../stage/videoStageTypes";
import type { StageKind } from "../stages/types";
import { WorkbenchOverlays } from "../shell/WorkbenchOverlays";
import type { ClassPickerAttrEditing } from "../shell/ClassPickerPopover";
import { WorkbenchLayout } from "../shell/WorkbenchLayout";
import {
  SelectionCardPlaceholder,
  type SelectedAnnotationCardProps,
} from "../shell/SelectedAnnotationCard";
import { ImageSelectionCardContent } from "../shell/ImageSelectionCardContent";
import type { FloatingPanelRect } from "../shell/FloatingPanelShell";
import {
  FLOATING_SELECTION_MAX_SIZE,
  FLOATING_SELECTION_MIN_SIZE,
  SIDE_FLOATING_PANEL_MAX_SIZE,
  SIDE_FLOATING_PANEL_MIN_SIZE,
} from "../shell/floatingPanelSizing";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAuthStore } from "@/stores/authStore";
import type { FloatingPanelState, FloatingSelectionState } from "@/api/auth";
import {
  getRememberedWorkbenchTask,
  rememberWorkbenchTask,
  resolveWorkbenchReturnTo,
  updateWorkbenchUrlSearch,
} from "@/utils/workbenchNavigation";
import {
  getAll as offlineQueueGetAll,
  removeById as offlineQueueRemoveById,
} from "./offlineQueue";
import { useWorkbenchOfflineQueue } from "./useWorkbenchOfflineQueue";
import { useImageAnnotationActions } from "../stages/image/useImageAnnotationActions";
import { useMaskEditor } from "./useMaskEditor";
import { MaskToolbar } from "../shell/MaskToolbar";
import { useVideoAnnotationActions } from "../stages/video/useVideoAnnotationActions";
import { AttributeModeBar } from "../shell/AttributeModeBar";
import {
  applyAttributeModeValue,
  canApplyAttributeModeToAnnotation,
  normalizeAttributeModeState,
} from "./attributeMode";
import styles from "../shell/WorkbenchShell.module.css";

const VARIANT_FIELD_SET = new Set<string>(VARIANT_FIELD_KEYS);

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

function omitVariantFields(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!value) return out;
  for (const [key, v] of Object.entries(value)) {
    if (!VARIANT_FIELD_SET.has(key)) out[key] = v;
  }
  return out;
}

function buildPredictParams(
  params: Record<string, unknown> | undefined,
  modelVariants: Record<string, string>,
): Record<string, unknown> | undefined {
  const out = omitVariantFields(params);
  if (Object.keys(modelVariants).length > 0) {
    out.model_variants = modelVariants;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

type WorkbenchShellMode = "annotate" | "review";

export interface UseWorkbenchShellModelParams {
  mode?: WorkbenchShellMode;
}

interface WorkbenchShellIssueSection {
  openIssueCount: number;
  stageKind: StageKind;
  issuePinDropArmed: boolean;
  onOpenList: () => void;
  onToggleIssuePinDrop: () => void;
  createModal: ComponentProps<typeof IssueCreateModal>;
}

interface WorkbenchShellEmptyState {
  kind: "empty";
  emptyState: {
    icon: "warning" | "inbox";
    message: string;
    onBack: () => void;
  };
}

interface WorkbenchShellReadyModel {
  kind: "ready";
  layout: ComponentProps<typeof WorkbenchLayout>;
  propagateDialog: ComponentProps<typeof VideoTrackerPropagateDialog>;
  issueSection?: WorkbenchShellIssueSection;
}

function resolveFloatingPanelRect(
  state: FloatingPanelState,
  defaults: {
    w: number;
    h: number;
    x: (viewportW: number, w: number) => number;
    y: (viewportH: number, h: number) => number;
  },
): FloatingPanelRect {
  const w = Math.max(
    SIDE_FLOATING_PANEL_MIN_SIZE.w,
    Math.min(SIDE_FLOATING_PANEL_MAX_SIZE.w, state.w ?? defaults.w),
  );
  const h = Math.max(
    SIDE_FLOATING_PANEL_MIN_SIZE.h,
    Math.min(SIDE_FLOATING_PANEL_MAX_SIZE.h, state.h ?? defaults.h),
  );
  const viewportW = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 800 : window.innerHeight;
  return {
    x: state.x ?? Math.max(24, defaults.x(viewportW, w)),
    y: state.y ?? Math.max(24, defaults.y(viewportH, h)),
    w,
    h,
  };
}

function resolveFloatingTaskQueueRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 320,
    h: 620,
    x: () => 24,
    y: () => 72,
  });
}

function resolveFloatingClassPaletteRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 320,
    h: 420,
    x: () => 24,
    y: (viewportH, h) => viewportH - h - 40,
  });
}

function resolveFloatingInspectorRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 360,
    h: 600,
    x: (viewportW, w) => viewportW - w - 40,
    y: (viewportH, h) => Math.min(80, viewportH - h - 24),
  });
}

function resolveFloatingDiscussionRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 420,
    h: 560,
    x: (viewportW, w) => viewportW - w - 40,
    y: (viewportH, h) => Math.min(260, viewportH - h - 40),
  });
}

// v0.16.8 · 选中标注浮动信息卡:默认贴画布右上(避开右栏);clamp 用选中卡专属尺寸界。
function resolveFloatingSelectionRect(state: FloatingSelectionState): FloatingPanelRect {
  const w = Math.max(
    FLOATING_SELECTION_MIN_SIZE.w,
    Math.min(FLOATING_SELECTION_MAX_SIZE.w, state.w ?? 340),
  );
  const h = Math.max(
    FLOATING_SELECTION_MIN_SIZE.h,
    Math.min(FLOATING_SELECTION_MAX_SIZE.h, state.h ?? 440),
  );
  const viewportW = typeof window === "undefined" ? 1280 : window.innerWidth;
  return {
    x: state.x ?? Math.max(24, viewportW - w - 40),
    y: state.y ?? 88,
    w,
    h,
  };
}

// v0.14.18 · 工具 → 交互 prompt (text 已归批量线, 映射为 null = 非交互)。供交互后端路由解析。
function promptOfTool(tool: ToolId): InteractivePrompt | null {
  const rp = TOOL_REGISTRY[tool]?.requiredPrompt;
  return rp && rp !== "text" ? rp : null;
}

export type UseWorkbenchShellModelResult =
  | { kind: "loading" }
  | WorkbenchShellEmptyState
  | WorkbenchShellReadyModel;

export function useWorkbenchShellModel({
  mode = "annotate",
}: UseWorkbenchShellModelParams): UseWorkbenchShellModelResult {
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
  const projectTextOutputDefault = (
    currentProject as { text_output_default?: TextOutputMode | null } | null | undefined
  )?.text_output_default;

  const projectName = currentProject?.name ?? "标注工作台";
  const projectDisplayId = currentProject?.display_id ?? "—";

  // v0.14.18 · 多 backend 两条线分流 (见 docs/plans/2026-06-09-v0.14.18-...):
  //   批量线 batchBackendId — 文本/几何/OCR/版面预标, 默认 = 项目默认后端 (ml_backend_id) 回落第一个,
  //     驱动 preCfg / handleRunAi / AI 面板 backend 选择器, 沿用批量页 ProjectDetailPanel 切换语义。
  //   交互线 — point/bbox/exemplar 工具各自按能力路由到交互后端 (见下方 routing / interactiveBackendId)。
  const backendsQ = useMLBackends(projectId);
  const backends = (backendsQ.data ?? []) as unknown as Array<{ id: string; name: string }>;
  const firstBackendId = backends[0]?.id ?? null;
  const [batchBackendId, setBatchBackendId] = useState<string | null>(null);
  // 工作台是常驻 session: 用户在 AI 面板手动选过批量 backend 后, 不能因项目默认后端被外部改动
  // (如另一 Tab "设为默认") 或后端列表顺序变化 (firstBackendId 变) 而被静默重置。
  // 仅切项目时重置手动标记并按默认重新初始化; 同项目内只在用户未手动选过时跟随默认变化补齐。
  const batchManuallyPickedRef = useRef(false);
  const batchProjectRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (batchProjectRef.current !== projectId) {
      batchProjectRef.current = projectId;
      batchManuallyPickedRef.current = false;
      setBatchBackendId(currentProject?.ml_backend_id ?? firstBackendId);
      return;
    }
    if (batchManuallyPickedRef.current) return;
    setBatchBackendId(currentProject?.ml_backend_id ?? firstBackendId);
  }, [projectId, currentProject?.ml_backend_id, firstBackendId]);
  const selectBatchBackend = useCallback((id: string | null) => {
    batchManuallyPickedRef.current = true;
    setBatchBackendId(id);
  }, []);
  const selectedBackend = backends.find((b) => b.id === batchBackendId) ?? null;

  const aiModel = selectedBackend?.name
    ?? (currentProject?.ml_backend_id ? "已接入模型" : "未接入模型");

  const meUserId = useAuthStore((s) => s.user?.id);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(requestedBatchId);
  useEffect(() => {
    setSelectedBatchId((prev) => (prev === requestedBatchId ? prev : requestedBatchId));
  }, [requestedBatchId]);
  const { data: batchList } = useBatches(projectId ?? "", undefined);
  useBatchEventsSocket(projectId);
  const isOwner = useIsProjectOwner(currentProject ?? null);
  const activeBatches = useMemo(() => {
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
  const {
    data: taskListData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading: isTaskListLoading,
  } = useTaskList(projectId, taskListParams);
  const taskPages = taskListData?.pages;
  const tasks = useMemo(
    () => taskPages?.flatMap((p) => p.items) ?? [],
    [taskPages],
  );
  const tasksTotal = taskListData?.pages[0]?.total ?? tasks.length;
  const requestedTaskLoaded = Boolean(
    requestedTaskId && tasks.some((t) => t.id === requestedTaskId),
  );
  const shouldLoadDirectTask = Boolean(requestedTaskId && !requestedTaskLoaded);
  const directTaskQuery = useTask(shouldLoadDirectTask ? requestedTaskId! : "");

  const s = useWorkbenchState();
  // v0.13.x · 点云 3D 项目无对应 2D 工具,按当前 3D 工具显式选择工具单位。
  const is3DProject = currentProject?.type_key === "lidar";
  const setExemplarOutputMode = s.setExemplarOutputMode;
  useEffect(() => {
    if (!projectId) return;
    setExemplarOutputMode(resolveInitialOutputMode(
      projectId,
      currentProject?.type_key,
      projectTextOutputDefault,
      meUserId,
    ));
  }, [projectId, currentProject?.type_key, projectTextOutputDefault, meUserId, setExemplarOutputMode]);
  const handleSetExemplarOutputMode = useCallback((mode: TextOutputMode) => {
    setExemplarOutputMode(mode);
    if (projectId) writeStoredOutputMode(projectId, mode, meUserId);
  }, [projectId, meUserId, setExemplarOutputMode]);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    count: number;
    onConfirm: () => void;
  } | null>(null);
  const threeDToolUnit = s.threeDTool === "point-mask" ? "point_mask_3d" : "lidar_box_3d";
  const toolView = useToolBindings(
    currentProject ?? null,
    s.tool,
    is3DProject ? threeDToolUnit : undefined,
  );
  const enabledToolUnits = useMemo<Set<string> | null>(() => {
    const tb = currentProject?.tool_bindings;
    if (!tb || Object.keys(tb).length === 0) return null;
    const set = new Set<string>();
    for (const [unit, binding] of Object.entries(tb)) {
      if (binding?.enabled) set.add(unit);
    }
    return set;
  }, [currentProject?.tool_bindings]);
  // v0.11.29 · 视频 bbox 单位的单帧/轨迹子开关; null = 两者均可用 (兼容老项目)。
  const videoModes = useMemo<{ box: boolean; track: boolean } | null>(() => {
    const vm = currentProject?.tool_bindings?.bbox?.video_modes;
    if (!vm) return null;
    return { box: vm.box ?? true, track: vm.track ?? true };
  }, [currentProject?.tool_bindings]);
  const classes = toolView.classes;
  const classesConfig = toolView.classesConfig;
  void toolView.toolUnitId;
  // B-57 · 采纳预测选类时, popover 须按预测自身的 tool_unit (如 region) 列出类别, 而非当前
  // 激活工具 (bbox) 的 classes — 后者会让多边形预测只显示矩形框的类, 选不到正确类别 → 反复 422。
  // 非采纳态 / 缺 unit 时退回当前工具 classes, 保持原有改类行为不变。
  const editingAcceptUnit = s.editingClass?.accept?.toolUnitId;
  const editingAcceptClasses = useMemo(() => {
    if (!editingAcceptUnit) return classes;
    return classesForUnit(currentProject?.tool_bindings, editingAcceptUnit as ToolUnitId);
  }, [editingAcceptUnit, currentProject?.tool_bindings, classes]);
  const activeClass = s.activeClass;
  const setActiveClass = s.setActiveClass;
  const tool = s.tool;
  const setTool = s.setTool;
  const videoTool = s.videoTool;
  const setVideoTool = s.setVideoTool;
  const videoFrameIndex = s.videoFrameIndex;
  const setVideoFrameIndex = s.setVideoFrameIndex;
  useEffect(() => {
    setActiveClassesConfig(classesConfig);
    return () => setActiveClassesConfig(undefined);
  }, [classesConfig]);
  useEffect(() => {
    if (activeClass && classes.length > 0 && !classes.includes(activeClass)) {
      setActiveClass(classes[0] ?? "");
    }
  }, [activeClass, classes, setActiveClass]);
  const currentTaskId = s.currentTaskId;
  const setCurrentTaskId = s.setCurrentTaskId;
  const setSelectedId = s.setSelectedId;
  const { vp, setVp } = useViewportTransform();
  const [fitTick, setFitTick] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);
  // v0.15.3 · 工作台设置抽屉(齿轮菜单入口)。
  const [workbenchSettingsOpen, setWorkbenchSettingsOpen] = useState(false);
  const [aiPopoverOpen, setAiPopoverOpen] = useState(false);
  const [aiPopoverPosition, setAiPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  // v0.14.18 · AI 面板可缩放 (与浮出边栏一致); null = 用 CSS 默认尺寸, 用户拖角后置显式 w/h.
  // 持久化到 localStorage (全局 UI 偏好, 非按项目): 刷新后保留拖定的尺寸。
  const aiPopoverSizeKey = "wb:ai-popover-size";
  const [aiPopoverSize, setAiPopoverSize] = useState<{ w: number; h: number } | null>(() => {
    try {
      const raw = localStorage.getItem(aiPopoverSizeKey);
      const v = raw ? JSON.parse(raw) : null;
      return typeof v?.w === "number" && typeof v?.h === "number" ? { w: v.w, h: v.h } : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (aiPopoverSize) localStorage.setItem(aiPopoverSizeKey, JSON.stringify(aiPopoverSize));
      else localStorage.removeItem(aiPopoverSizeKey);
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [aiPopoverSize]);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(true);
  const [stageGeom, setStageGeom] = useState<{ imgW: number; imgH: number; vpSize: { w: number; h: number } }>({ imgW: 0, imgH: 0, vpSize: { w: 0, h: 0 } });
  const isNarrow = useMediaQuery("(max-width: 1024px)");
  const { recent: recentClasses, record: recordRecentClass } = useRecentClasses(
    routeId,
    s.workbenchConfig.common.recentClassesLimit,
  );

  const [debouncedConf, setDebouncedConf] = useState(s.confThreshold);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedConf(s.confThreshold), 300);
    return () => clearTimeout(t);
  }, [s.confThreshold]);

  const task: TaskResponse | undefined = useMemo(() => {
    const loaded = tasks.find((t) => t.id === currentTaskId);
    if (loaded) return loaded;
    const directTask = shouldLoadDirectTask ? directTaskQuery.data : undefined;
    if (
      directTask
      && (directTask.id === requestedTaskId || !currentTaskId || directTask.id === currentTaskId)
    ) {
      return directTask;
    }
    if (requestedTaskId) return undefined;
    return tasks[0];
  }, [
    tasks,
    currentTaskId,
    requestedTaskId,
    shouldLoadDirectTask,
    directTaskQuery.data,
  ]);
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
  const fileUrl = task?.file_url ?? null;
  const blurhash = task?.blurhash ?? null;
  const thumbnailUrl = task?.thumbnail_url ?? null;
  const isVideoTask = task?.file_type === "video" || currentProject?.type_key === "video-track";
  const stageKind = currentProject?.type_key === "lidar" ? "3d" : isVideoTask ? "video" : "image";
  const videoManifest = useVideoManifest(taskId, isVideoTask);
  const videoFrameTimetable = useVideoFrameTimetable(taskId, isVideoTask && !!videoManifest.data);
  const videoDatasetItemId = videoManifest.data?.dataset_item_id ?? null;
  const videoChaptersQuery = useVideoChapters(isVideoTask ? videoDatasetItemId : null);
  const videoChaptersData = useMemo(
    () => videoChaptersQuery.data ?? [],
    [videoChaptersQuery.data],
  );
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
  // v0.11.29 · 当前 videoTool 被 video_modes 过滤掉时, 切到可用工具 (否则默认按钮指向隐藏项)。hand 始终可用。
  useEffect(() => {
    if (!isVideoTask || !videoModes) return;
    if (videoTool === "box" && !videoModes.box) setVideoTool(videoModes.track ? "track" : "hand");
    else if (videoTool === "track" && !videoModes.track) setVideoTool(videoModes.box ? "box" : "hand");
  }, [isVideoTask, videoModes, videoTool, setVideoTool]);
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
        videoFrameIndex,
        e.key === "PageDown" ? "next" : "prev",
      );
      if (target === null) return;
      e.preventDefault();
      setVideoFrameIndex(target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isVideoTask, videoChaptersData, videoFrameIndex, setVideoFrameIndex]);

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
    // 切 task / 切 batch 后, 丢弃指向其它 task 的待补选; 仅当新 task 正是
    // 跨帧 propagate 的目标时保留 (该补选逻辑见下方 annotationsData effect)。
    const pend = pendingCrossFrameSelectRef.current;
    if (pend && pend.taskId !== taskId) {
      pendingCrossFrameSelectRef.current = null;
    }
  }, [taskId, resetVideoStageUi]);

  useEffect(() => {
    if (tasks.length === 0 && !directTaskQuery.data) return;
    if (requestedTaskId && tasks.some((t) => t.id === requestedTaskId)) {
      if (currentTaskId !== requestedTaskId) {
        setCurrentTaskId(requestedTaskId);
        setSelectedId(null);
      }
      return;
    }
    if (requestedTaskId) {
      if (directTaskQuery.data?.id === requestedTaskId) {
        if (currentTaskId !== requestedTaskId) {
          setCurrentTaskId(requestedTaskId);
          setSelectedId(null);
        }
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
    directTaskQuery.data,
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
    if (classes.length > 0) {
      const fallback = recentClasses.find((c) => classes.includes(c)) ?? classes[0];
      s.setActiveClass(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const { data: annotationsData } = useAnnotations(taskId);
  const annotationsRef = useRef<AnnotationResponse[]>([]);
  annotationsRef.current = annotationsData ?? [];
  const [hideOrphanAnnotations, setHideOrphanAnnotations] = useState(false);
  const projectClassNames = useMemo(
    () =>
      currentProject
        ? new Set(Object.keys(currentProject.classes_config ?? {}))
        : null,
    [currentProject],
  );
  const orphanAnnotationIds = useMemo(
    () =>
      new Set(
        (annotationsData ?? [])
          .filter(
            (ann) =>
              projectClassNames != null &&
              // `__unknown`（未分类）是合法 sentinel，并非"类别被删除"的孤儿，
              // 不应判为 orphan / 标记"已删除"。
              ann.class_name !== UNKNOWN_CLASS &&
              !projectClassNames.has(ann.class_name),
          )
          .map((ann) => ann.id),
      ),
    [annotationsData, projectClassNames],
  );
  const visibleAnnotationsData = useMemo(
    () =>
      hideOrphanAnnotations
        ? (annotationsData ?? []).filter((ann) => !orphanAnnotationIds.has(ann.id))
        : (annotationsData ?? []),
    [annotationsData, hideOrphanAnnotations, orphanAnnotationIds],
  );
  const selectedIdsForOrphanFilter = s.selectedIds;
  const replaceSelectedForOrphanFilter = s.replaceSelected;

  useEffect(() => {
    if (!hideOrphanAnnotations || selectedIdsForOrphanFilter.length === 0) return;
    const nextSelectedIds = selectedIdsForOrphanFilter.filter(
      (id) => !orphanAnnotationIds.has(id),
    );
    if (nextSelectedIds.length !== selectedIdsForOrphanFilter.length) {
      replaceSelectedForOrphanFilter(nextSelectedIds);
    }
  }, [
    hideOrphanAnnotations,
    orphanAnnotationIds,
    replaceSelectedForOrphanFilter,
    selectedIdsForOrphanFilter,
  ]);

  useEffect(() => {
    publishTaskBoxCount(annotationsRef.current.length);
  }, [annotationsData]);

  // v0.14.1 · 跨帧 propagate 跳转后, 目标 task 标注加载完成时补选新建的框。
  useEffect(() => {
    const pend = pendingCrossFrameSelectRef.current;
    if (!pend || currentTaskId !== pend.taskId) return;
    if ((annotationsData ?? []).some((a) => a.id === pend.annotationId)) {
      setSelectedId(pend.annotationId);
      pendingCrossFrameSelectRef.current = null;
    }
  }, [annotationsData, currentTaskId, setSelectedId]);

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
  const predictionsData = useMemo(
    () => predictionsInfinite.data?.pages.flatMap((p) => p) ?? [],
    [predictionsInfinite.data?.pages],
  );

  // v0.11.27 · 遮挡样式 key 的跨工具单位并集。userBoxes 含全部单位的标注，而
  // toolView.attributeSchema 仅当前工具单位；故遍历全 tool_bindings 取 style_occluded
  // boolean key 并集，避免切换工具后其他单位的框遮挡视觉丢失。
  const occludedKeys = useMemo(() => {
    const keys = new Set<string>();
    const tb = currentProject?.tool_bindings ?? {};
    for (const binding of Object.values(tb)) {
      for (const k of collectOccludedKeys(binding?.attribute_schema?.fields ?? [])) {
        keys.add(k);
      }
    }
    return keys;
  }, [currentProject]);

  const userBoxes = useMemo(
    () => visibleAnnotationsData
      .filter((ann) => !(isVideoTask && ann.geometry.type === "video_track_bbox"))
      .map((a) => annotationToBox(a, occludedKeys)),
    [visibleAnnotationsData, isVideoTask, occludedKeys],
  );

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
  const groupAnnotationMut = useAnnotationGroup(taskId ?? "");
  const ungroupAnnotationMut = useAnnotationUngroup(taskId ?? "");
  const bulkUpdateMut = useAnnotationBulkUpdate(taskId ?? "");

  const [issueCreateOpen, setIssueCreateOpen] = useState(false);
  const [issuePinDropArmed, setIssuePinDropArmed] = useState(false);
  const [issuePinPrefill, setIssuePinPrefill] = useState<{ x: number; y: number } | null>(null);
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

  // v0.11.4 · DiscussionPanel issues tab ↔ IssueLayer 双向联动 store。
  // 列表单击 → focusTick++ → 定位到对应图钉并高亮。
  //   image: 把视口平移到图钉 (复用现有 vp/setVp + stageGeom)。
  //   video (v0.11.7): 先 seek 到 anchor_position.frame 命中的帧, 该帧的 VideoIssueLayer 图钉再显示。
  const activeIssueHighlightId = useActiveIssueStore((st) => st.highlightId);
  const highlightIssueFromPin = useActiveIssueStore((st) => st.highlightFromPin);
  const requestIssuesTab = useActiveIssueStore((st) => st.requestIssuesTab);
  const issueFocusTick = useActiveIssueStore((st) => st.focusTick);
  const lastIssueFocusRef = useRef(issueFocusTick);
  useEffect(() => {
    if (issueFocusTick === lastIssueFocusRef.current) return;
    lastIssueFocusRef.current = issueFocusTick;
    const target = (issuesQuery.data?.items ?? []).find((i) => i.id === activeIssueHighlightId);
    if (!target?.anchor_position) return;
    if (isVideoTask) {
      const frame = target.anchor_position.frame;
      if (typeof frame === "number") setVideoFrameIndex(frame);
      return;
    }
    const { imgW, imgH, vpSize } = stageGeom;
    if (!imgW || !imgH || !vpSize.w || !vpSize.h) return;
    setVp((cur) => ({
      ...cur,
      tx: vpSize.w / 2 - target.anchor_position!.x * imgW * cur.scale,
      ty: vpSize.h / 2 - target.anchor_position!.y * imgH * cur.scale,
    }));
  }, [issueFocusTick, activeIssueHighlightId, issuesQuery.data, stageGeom, setVp, isVideoTask, setVideoFrameIndex]);
  const submitTaskMut = useSubmitTask();
  const triggerPreannotation = useTriggerPreannotation(projectId);
  const { progress: preannotationProgress, connection: preannotationConn, retries: preannotationRetries } =
    usePreannotationProgress(projectId);
  const { lockError, lockConflict, remainingMs } = useTaskLock(taskId);

  const queryClient = useQueryClient();

  // 预标 (含工作台单图 AI) 完成后失效本 task 预测缓存, 让新框无需手动刷新即时渲染.
  // 单图 trigger 走 Celery 异步, mutation onSuccess 只代表"已派发"; 真正完成靠预标进度
  // WS (status==='completed') 通知, 故在此监听 status 翻转到 completed 时重拉 predictions.
  const lastPreannotateStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = preannotationProgress?.status ?? null;
    if (status === "completed" && lastPreannotateStatusRef.current !== "completed" && taskId) {
      queryClient.invalidateQueries({ queryKey: ["predictions", taskId] });
    }
    lastPreannotateStatusRef.current = status;
  }, [preannotationProgress?.status, taskId, queryClient]);

  // v0.14.1+ · 跨帧目标延续 (Shift+→ / Shift+←): 把选中框 propagate 到同 scene
  // 邻帧 task。目标若不在当前已加载队列里,退化为按 taskId 直开并补选中新框。
  const pendingCrossFrameSelectRef = useRef<{
    taskId: string;
    annotationId: string;
  } | null>(null);
  // v0.14.1 · 并发/重复触发守卫: 按住 Alt+→ auto-repeat 或快速连按时, 防止并发
  // 多个 propagate POST 在目标帧造出共享同一新 group_id 的重复 annotation。
  const crossFrameInFlightRef = useRef(false);
  // v0.15.1 · "scene 无 ego 轨迹,未做运动补偿" 每会话只轻提示一次,避免逐帧刷 toast。
  const motionCompWarnedRef = useRef(false);
  const warnNoMotionCompensation = useCallback(
    (compensated: boolean) => {
      if (compensated || motionCompWarnedRef.current) return;
      motionCompWarnedRef.current = true;
      pushToast({
        msg: "该 scene 无 ego 轨迹,跨帧未做运动补偿(原样复制)",
        kind: "warning",
      });
    },
    [pushToast],
  );
  // 跳到目标帧 task: 已加载队列内直接选中,否则按 taskId 直开。
  const navigateToCrossFrameTask = useCallback(
    (targetTaskId: string) => {
      const nav = resolveCrossFrameNavigation(
        tasks.map((t) => t.id),
        targetTaskId,
      );
      if (nav.kind === "loaded") {
        selectTask(nav.taskId);
      } else {
        setCurrentTaskId(nav.taskId);
        setSelectedId(null);
        updateUrl({ batchId: selectedBatchId, taskId: nav.taskId });
      }
    },
    [tasks, selectTask, setCurrentTaskId, setSelectedId, updateUrl, selectedBatchId],
  );
  const crossFramePropagate = useCallback(
    async (direction: "next" | "prev") => {
      if (!taskId) return;
      if (crossFrameInFlightRef.current) return;
      crossFrameInFlightRef.current = true;
      try {
        const selId = s.selectedId;
        if (!selId) {
          pushToast({ msg: "请先选中一个目标框", kind: "" });
          return;
        }
        // 按需直拉邻帧 (非缓存), propagate 才发请求, 避免给每个 task 都预取。
        let neighbors;
        try {
          neighbors = await tasksApi.getNeighbors(taskId, 1);
        } catch {
          pushToast({ msg: "获取邻帧失败", kind: "error" });
          return;
        }
        const resolution = resolveCrossFrameTarget(neighbors, direction);
        if (resolution.kind === "no-scene") {
          pushToast({ msg: "当前 task 不属于任何 scene, 无法跨帧延续", kind: "warning" });
          return;
        }
        if (resolution.kind === "boundary") {
          pushToast({
            msg: direction === "next" ? "已是该 scene 最后一帧" : "已是该 scene 首帧",
            kind: "",
          });
          return;
        }
        try {
          const { annotation, motion_compensated } = await tasksApi.propagateToTask(
            taskId,
            selId,
            resolution.taskId,
          );
          // 失效目标 task 标注缓存, 跳过去后重新拉到含新框的列表。
          queryClient.invalidateQueries({
            queryKey: ["annotations", resolution.taskId],
          });
          // 源 task 框可能刚被分配 group_id, 失效让本帧高亮同步。
          queryClient.invalidateQueries({ queryKey: ["annotations", taskId] });
          pendingCrossFrameSelectRef.current = {
            taskId: resolution.taskId,
            annotationId: annotation.id,
          };
          navigateToCrossFrameTask(resolution.taskId);
          pushToast({
            msg: `已延续到帧 ${resolution.frameIndex}`,
            kind: "success",
          });
          warnNoMotionCompensation(motion_compensated);
        } catch {
          pushToast({ msg: "跨帧延续失败", kind: "error" });
        }
      } finally {
        crossFrameInFlightRef.current = false;
      }
    },
    [
      taskId,
      s.selectedId,
      navigateToCrossFrameTask,
      pushToast,
      queryClient,
      warnNoMotionCompensation,
    ],
  );

  // v0.15.1 · 批量延续: 当前帧全部 box_3d 一次运动补偿 propagate 到邻帧。
  const crossFramePropagateBatch = useCallback(
    async (direction: "next" | "prev") => {
      if (!taskId) return;
      if (crossFrameInFlightRef.current) return;
      crossFrameInFlightRef.current = true;
      try {
        let neighbors;
        try {
          neighbors = await tasksApi.getNeighbors(taskId, 1);
        } catch {
          pushToast({ msg: "获取邻帧失败", kind: "error" });
          return;
        }
        const resolution = resolveCrossFrameTarget(neighbors, direction);
        if (resolution.kind === "no-scene") {
          pushToast({ msg: "当前 task 不属于任何 scene, 无法跨帧延续", kind: "warning" });
          return;
        }
        if (resolution.kind === "boundary") {
          pushToast({
            msg: direction === "next" ? "已是该 scene 最后一帧" : "已是该 scene 首帧",
            kind: "",
          });
          return;
        }
        try {
          const { items, motion_compensated } = await tasksApi.propagateBatch(
            taskId,
            resolution.taskId,
          );
          queryClient.invalidateQueries({
            queryKey: ["annotations", resolution.taskId],
          });
          queryClient.invalidateQueries({ queryKey: ["annotations", taskId] });
          navigateToCrossFrameTask(resolution.taskId);
          pushToast({
            msg: `${items.length} 个目标已延续到帧 ${resolution.frameIndex}`,
            kind: "success",
          });
          warnNoMotionCompensation(motion_compensated);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          pushToast({
            msg: msg.includes("box_3d") ? "当前帧没有可延续的 3D 框" : "批量延续失败",
            kind: "error",
          });
        }
      } finally {
        crossFrameInFlightRef.current = false;
      }
    },
    [taskId, navigateToCrossFrameTask, pushToast, queryClient, warnNoMotionCompensation],
  );

  // v0.15.1 · 把选中框延续到 scene 内任意帧(插值工作流: 先把链建到区间终点)。
  const crossFramePropagateToTask = useCallback(
    async (targetTaskId: string, targetFrameIndex: number) => {
      if (!taskId) return;
      const selId = s.selectedId;
      if (!selId) {
        pushToast({ msg: "请先选中一个目标框", kind: "" });
        return;
      }
      if (crossFrameInFlightRef.current) return;
      crossFrameInFlightRef.current = true;
      try {
        const { annotation, motion_compensated } = await tasksApi.propagateToTask(
          taskId,
          selId,
          targetTaskId,
        );
        queryClient.invalidateQueries({ queryKey: ["annotations", targetTaskId] });
        queryClient.invalidateQueries({ queryKey: ["annotations", taskId] });
        pendingCrossFrameSelectRef.current = {
          taskId: targetTaskId,
          annotationId: annotation.id,
        };
        navigateToCrossFrameTask(targetTaskId);
        pushToast({ msg: `已延续到帧 ${targetFrameIndex}, 微调后可插值填充`, kind: "success" });
        warnNoMotionCompensation(motion_compensated);
      } catch {
        pushToast({ msg: "跨帧延续失败", kind: "error" });
      } finally {
        crossFrameInFlightRef.current = false;
      }
    },
    [
      taskId,
      s.selectedId,
      navigateToCrossFrameTask,
      pushToast,
      queryClient,
      warnNoMotionCompensation,
    ],
  );

  // v0.15.1 · 区间插值: 当前 task(起点帧)与 toTask(终点帧)的同 group 框之间,
  // 中间帧自动生成插值框;完成后跳首个插值帧预览。
  const crossFrameInterpolate = useCallback(
    async (groupId: number, toTaskId: string) => {
      if (!taskId) return;
      if (crossFrameInFlightRef.current) return;
      crossFrameInFlightRef.current = true;
      try {
        const { annotations, motion_compensated, skipped_frames } =
          await tasksApi.interpolateRange(taskId, groupId, toTaskId);
        const affectedTasks = new Set(annotations.map((a) => a.task_id));
        for (const tid of affectedTasks) {
          queryClient.invalidateQueries({ queryKey: ["annotations", tid] });
        }
        if (annotations.length === 0) {
          pushToast({
            msg: `区间内中间帧均已有该目标的框(跳过 ${skipped_frames.length} 帧)`,
            kind: "",
          });
          return;
        }
        const first = annotations[0];
        pendingCrossFrameSelectRef.current = {
          taskId: first.task_id,
          annotationId: first.id,
        };
        navigateToCrossFrameTask(first.task_id);
        pushToast({
          msg:
            `已插值填充 ${annotations.length} 帧` +
            (skipped_frames.length > 0 ? `(跳过已有 ${skipped_frames.length} 帧)` : ""),
          kind: "success",
        });
        warnNoMotionCompensation(motion_compensated);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        pushToast({
          msg: msg ? `插值失败: ${msg}` : "插值失败",
          kind: "error",
        });
      } finally {
        crossFrameInFlightRef.current = false;
      }
    },
    [taskId, navigateToCrossFrameTask, pushToast, queryClient, warnNoMotionCompensation],
  );

  // v0.14.18 · 交互线能力路由: 对每个注册后端拉 /setup 建 capIndex, 按当前工具 prompt 解析交互后端。
  const routing = useBackendRouting({
    projectId,
    userId: meUserId,
    backends,
    defaultBackendId: currentProject?.ml_backend_id ?? null,
  });
  // 当前工具对应的交互 prompt (非交互工具回落 point, 仅用于 sam/warmup 的后端选取, 不参与门控)。
  const activeInteractivePrompt = promptOfTool(s.tool);
  const interactiveBackendId = routing.resolveInteractive(activeInteractivePrompt ?? "point");

  const sam = useInteractiveAI({
    projectId,
    taskId,
    mlBackendId: interactiveBackendId,
  });
  // 交互工具抽屉 (AIToolDrawer) 的能力/模型反映"解析到的交互后端"; 门控 (isPromptSupported) 走 routing 并集。
  const mlCapabilities = useMLCapabilities(
    projectId ?? null,
    interactiveBackendId,
  );
  // v0.14.9 · active model 输出几何 / 文本属性 与项目配置的兼容性警告 (非阻断)。
  const capabilityWarnings = useCapabilityValidation({
    activeModel: mlCapabilities.activeModel,
    enabledToolUnits,
    toolBindings: currentProject?.tool_bindings,
  });
  // AI"配置区"共享状态 (任务类型 / 模型任务 / 类别白名单 / variant / 参数 / 输出形态 / buildArgs);
  // 与批量页 ProjectDetailPanel 同一 hook + PreannotateConfigForm (单一事实源). 驱动批量 AI 面板
  // (开始预标) — 批量线, 用 batchBackendId.
  const preCfg = usePreannotateConfig({
    projectId: projectId ?? "",
    backendId: batchBackendId,
  });
  useEffect(() => {
    sam.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  const warmupPointBackendId = routing.resolveInteractive("point");
  useEffect(() => {
    if (stageKind !== "image") return;
    if (!taskId || !warmupPointBackendId) return;
    sam.warmup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKind, taskId, warmupPointBackendId]);
  useEffect(() => {
    if (!isAIToolId(s.tool) && sam.candidates.length > 0) sam.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tool]);
  // v0.14.18 · 门控走 routing 并集: 某交互 prompt 只要任一交互后端支持, 工具就亮。
  const routingSig = INTERACTIVE_PROMPTS.map((p) =>
    routing.isPromptSupported(p) ? "1" : "0",
  ).join("");
  useEffect(() => {
    if (routing.isLoading) return;
    if (!isAIToolId(s.tool)) return;
    const requiredPrompt = promptOfTool(s.tool);
    if (requiredPrompt && !routing.isPromptSupported(requiredPrompt)) {
      s.setTool("hand");
      pushToast({
        msg: "当前后端不支持此 AI 工具",
        sub: "已切回手型；请到项目设置注册支持该交互的后端",
        kind: "warning",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routingSig, routing.isLoading, s.tool]);
  useEffect(() => {
    if (!isVideoTask) return;
    if (tool !== "box" && tool !== "hand") setTool("box");
  }, [isVideoTask, tool, setTool]);

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
      e.preventDefault();
      e.stopImmediatePropagation();
      setAiDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [s.tool, aiDrawerOpen]);

  useEffect(() => {
    if (!isAIToolId(s.tool)) return;
    if (!aiDrawerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-ai-drawer-root]")) return;
      if (target.closest("[data-workbench-tool-dock]")) return;
      // 点画布关闭浮层, 但**不要** preventDefault/stopPropagation: 否则浏览器不再生成
      // 兼容 mousedown, Konva <Stage onMouseDown> 收不到事件 → 首次 AI 拖框被吞掉
      // (smart-box / exemplar 等画第一框无效)。关闭浮层与触发绘制手势应同帧并存。
      setAiDrawerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [s.tool, aiDrawerOpen]);

  useEffect(() => {
    if (isAIToolId(s.tool)) setAiDrawerOpen(true);
  }, [s.tool]);

  const conflictIdRef = useRef<string>("");
  const [conflictOpen, setConflictOpen] = useState(false);
  const handleConflict = useCallback((annotationId: string, _currentVersion: number) => {
    conflictIdRef.current = annotationId;
    setConflictOpen(true);
  }, []);
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
      const ann = annotationsRef.current.find((a) => a.id === id);
      if (!ann || ann.geometry.type !== "video_track_bbox") throw new Error("Video track not found");
      const geometry = applyVideoKeyframeToGeometry(ann.geometry, frameIndex, keyframe);
      await updateAnnotationMut.mutateAsync({ annotationId: id, payload: { geometry } });
    },
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

  const { avgMs } = useSessionStats(taskId ?? null, projectId ?? null, "annotate");
  const remainingTaskCount = useMemo(() => {
    if (!tasks.length) return 0;
    return tasks.filter((t) => t.status !== "completed" && t.id !== taskId).length;
  }, [tasks, taskId]);

  const offlineQ = useWorkbenchOfflineQueue({ history, queryClient, pushToast });
  const { online, queueCount, enqueueOnError, flushOne: executeOp, flushAll: flushOffline,
    drawerOpen: offlineDrawerOpen, openDrawer: openOfflineDrawer, closeDrawer: closeOfflineDrawer } = offlineQ;

  const isLockedForActions = mode === "review"
    ? task?.status === "completed"
    : task?.status === "review" || task?.status === "completed";
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
    predictionSourceFilter,
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
    handleDeleteBox: handleDeleteBoxNow,
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
    handleBatchDelete: handleBatchDeleteNow,
    handleJoinSelectedPolygons,
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
    handleChangeClassKeepOpen,
    handleCancelChangeClass,
    handleSamCommitClass,
    handleSamCancelClass,
  } = imageActions;
  const imageContextMenuClipboard = useMemo(() => ({
    copyAnnotation: (annotation: Annotation) => clipboard.copyAnnotations([annotation]),
    paste: clipboard.paste,
    hasClipboard: clipboard.hasClipboard,
  }), [clipboard]);

  const requestDelete = useCallback(
    (count: number, run: () => void) => {
      if (count <= 0) return;
      if (!shouldConfirmAnnotationDelete(s.workbenchConfig.common.confirmDelete, count)) {
        run();
        return;
      }
      setDeleteConfirm({ count, onConfirm: run });
    },
    [s.workbenchConfig.common.confirmDelete],
  );

  const handleDeleteBox = useCallback(
    (id: string) => {
      requestDelete(1, () => handleDeleteBoxNow(id));
    },
    [handleDeleteBoxNow, requestDelete],
  );

  const handleBatchDelete = useCallback(() => {
    const ids = s.selectedIds.filter((id) =>
      annotationsRef.current.some((a) => a.id === id),
    );
    requestDelete(ids.length, () => handleBatchDeleteNow(ids));
  }, [annotationsRef, handleBatchDeleteNow, requestDelete, s.selectedIds]);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  const confirmDelete = useCallback(() => {
    const run = deleteConfirm?.onConfirm;
    setDeleteConfirm(null);
    run?.();
  }, [deleteConfirm]);

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
    const mlBackendId = batchBackendId;
    if (!mlBackendId) {
      pushToast({
        msg: "AI 暂不可用",
        sub: "项目尚未绑定 ML 推理后端,请到「项目设置 → AI 配置」注册并选择",
        kind: "error",
      });
      return;
    }
    // 走共享配置区 buildArgs: 几何 backend (YOLO) 发 v2 结构化 (task_type/model_id/model_variants/
    // class_filter); 文本 backend (gsam2) 发 prompt. 当前图 = 单 task, predict_mode 固定 overwrite.
    const args = preCfg.buildArgs("overwrite");
    if (!args) return;
    if (!preCfg.configReady) {
      pushToast({
        msg: "AI 暂不可用",
        sub: preCfg.isGeometricBackend
          ? "请在 AI 面板选择模型任务"
          : "请在 AI 面板填写 prompt (或为类别配置英文 alias)",
        kind: "error",
      });
      return;
    }
    pushToast({ msg: "AI 正在分析图像...", sub: aiModel });
    triggerPreannotation.mutate(
      { ...args, task_ids: taskId ? [taskId] : undefined },
      {
        // v0.14.13 · 推理成功 → 记 variant 已热 (异步 trigger 拿不到 cache_hit, 走兜底).
        onSuccess: () => preCfg.markHot(),
        onError: (err: unknown) =>
          pushToast({ msg: "AI 预标注失败", sub: String(err), kind: "error" }),
      },
    );
  }, [projectId, batchBackendId, aiModel, taskId, triggerPreannotation, pushToast, preCfg]);

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
    if (reason === "escape") {
      s.setPendingDrawing(null);
      return;
    }
    if (s.pendingDrawing) handlePickPendingClassAny(UNKNOWN_CLASS);
    else s.setPendingDrawing(null);
  }, [s, handlePickPendingClassAny]);

  const selectedAnnotationForPanel = useMemo<AnnotationResponse | null>(() => {
    if (!s.selectedId || s.selectedIds.length > 1) return null;
    return visibleAnnotationsData.find((a) => a.id === s.selectedId) ?? null;
  }, [s.selectedId, s.selectedIds.length, visibleAnnotationsData]);

  // v0.11.5+ · 评论的视频帧锚点 (恢复 B1 去 flag 时随 AIInspectorPanel 内嵌一起删掉的逻辑)。
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

  const normalizedAttributeMode = useMemo(
    () => normalizeAttributeModeState(s.attributeMode, toolView.attributeSchema),
    [s.attributeMode, toolView.attributeSchema],
  );
  const handleApplyAttributeMode = useCallback((annotationId: string): boolean => {
    if (!normalizedAttributeMode.enabled || !normalizedAttributeMode.fieldKey) return false;
    const ann = annotationsRef.current.find((a) => a.id === annotationId);
    const field = toolView.attributeSchema.fields?.find((item) => item.key === normalizedAttributeMode.fieldKey);
    if (!ann || !field || !canApplyAttributeModeToAnnotation(ann, field)) {
      pushToast({ msg: "该标注不适用当前属性字段", kind: "warning" });
      return false;
    }
    const next = applyAttributeModeValue(ann.attributes, field, normalizedAttributeMode.currentValue);
    handleUpdateAttributes(annotationId, next);
    s.setSelectedId(annotationId);
    return true;
  }, [
    annotationsRef,
    handleUpdateAttributes,
    normalizedAttributeMode,
    pushToast,
    s,
    toolView.attributeSchema,
  ]);

  const hoveredCommentShapes = useHoveredCommentStore(selectEffectiveShapes);

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

  // v0.11.28：改类悬浮框内联属性编辑——按当前正在改类的标注派生 schema/attributes/提交回调。
  const editingClassAnnotation = useMemo(
    () => (s.editingClass
      ? (visibleAnnotationsData.find((a) => a.id === s.editingClass!.annotationId) ?? null)
      : null),
    [s.editingClass, visibleAnnotationsData],
  );
  const changeClassAttrEditing = useMemo<ClassPickerAttrEditing | undefined>(() => {
    const ann = editingClassAnnotation;
    const schema = toolView.attributeSchema;
    if (!ann || !schema || (schema.fields ?? []).length === 0) return undefined;
    if (isVideoTrack(ann)) {
      // 视频：悬浮框只编辑 mutable 字段的「轨迹默认值」层；逐帧覆盖留给侧栏完整编辑器。
      const mutableFields = (schema.fields ?? []).filter((f) => f.mutable === true);
      if (mutableFields.length === 0) return undefined;
      return {
        schema: { fields: mutableFields },
        attributes: ann.attributes ?? {},
        context: "video",
        readOnly: isLocked,
        onChange: (next) => handleUpdateTrackAttributes(ann, next),
      };
    }
    return {
      schema,
      attributes: ann.attributes ?? {},
      context: "image",
      readOnly: isLocked,
      onChange: (next) => handleUpdateAttributes(ann.id, next),
    };
  }, [editingClassAnnotation, toolView.attributeSchema, isLocked, handleUpdateTrackAttributes, handleUpdateAttributes]);

  useCanvasDraftPersistence({
    taskId,
    canvasDraft: s.canvasDraft,
    beginCanvasDraft: s.beginCanvasDraft,
  });

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

  // v0.13.4 · 3D 工作台自管这些字母键(V/B 选/放、W/E/R gizmo 模式),交给它的本地
  // keydown 处理;否则全局 2D 热键会抢 —— 尤其 E=「提交质检」(dispatchKey → submit)会被
  // 误触发:用户按 E 想转 gizmo,却把任务直接提交了。Ctrl+方向(切题)/?/Esc 等全局键仍保留。
  // v0.13.8 · Delete/Backspace 也归 3D 本地处理:全局 dispatchKey 通路在 3D 台实测不触发删除,
  // 改由 3D 工作台显式监听删选中框,口径与 W/E/R / B/V 一致。
  const threeDOwnedKeys = useMemo(
    () => new Set(["b", "B", "p", "P", "v", "V", "w", "W", "e", "E", "r", "R", "Delete", "Backspace"]),
    [],
  );

  const { spacePan, nudgeMap } = useWorkbenchHotkeys({
    s, history, classes, currentProject, annotationsRef,
    batchChanging, setBatchChanging, showHotkeys,
    navigateTask, smartNext, setFitTick,
    onCrossFramePropagate: crossFramePropagate,
    recordRecentClass, handleDeleteBox, handleBatchDelete, handlePatchShapeFlag,
    handleStartChangeClass, handleStartBatchChangeClass,
    handleSubmitTask, handleAcceptPrediction, handleRejectPrediction, handleUpdateAttributes,
    handleVideoSetSelectedClass,
    attributeModeSchema: toolView.attributeSchema,
    aiBoxes, setShowHotkeys, clipboard, pushToast, stageGeom,
    polygonDraftPoints, setPolygonDraftPoints, submitPolygon, submitPolyline,
    updateMutation: { mutate: (vars) => updateAnnotationMut.mutate(vars) },
    taskId,
    ignoredKeys: stageKind === "3d" ? threeDOwnedKeys : undefined,
    videoMode: isVideoTask,
    samplingActive,
    videoControlsRef,
    isPromptSupported: routing.isPromptSupported,
    maskEditor,
    commitMaskAsPolygon,
    cancelMaskEdit,
    handleAnnotationGroup,
    handleAnnotationUngroup,
  });

  const floatingTaskQueue = s.workbenchLayout.floatingTaskQueue;
  const floatingClassPalette = s.workbenchLayout.floatingClassPalette;
  const floatingInspector = s.workbenchLayout.floatingInspector;
  const floatingDiscussion = s.workbenchLayout.floatingDiscussion;
  const setWorkbenchLayout = s.setWorkbenchLayout;
  const setLeftOpenState = s.setLeftOpen;
  const setRightOpenState = s.setRightOpen;
  const leftOpenState = s.leftOpen;
  const rightOpenState = s.rightOpen;
  const taskQueueDetached = floatingTaskQueue.detached;
  const classPaletteDetached = floatingClassPalette.detached;
  const inspectorDetached = floatingInspector.detached;
  const discussionDetached = floatingDiscussion.detached;
  const leftHasEmbeddedPanels = !taskQueueDetached || !classPaletteDetached;
  const rightHasEmbeddedPanels = !inspectorDetached || !discussionDetached;
  const leftOpen = isNarrow || !leftHasEmbeddedPanels ? false : leftOpenState;
  const rightOpen = isNarrow || !rightHasEmbeddedPanels ? false : rightOpenState;
  // v0.15.x · 左右边栏宽度落在 common 子树的真百分比;拖拽与设置面板共用 setFields(乐观+广播+防抖)。
  const leftPct = s.workbenchConfig.common.leftWidthPct;
  const rightPct = s.workbenchConfig.common.rightWidthPct;
  const setWorkbenchFields = s.setWorkbenchFields;
  const [winWidth, setWinWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1440,
  );
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // px 供 JS 消费者(AI 面板右偏移等);clamp 与下方栅格 CSS clamp(180px..600px) 对齐。
  const leftPx = Math.round(clamp((leftPct / 100) * winWidth, 180, 600));
  const rightPx = Math.round(clamp((rightPct / 100) * winWidth, 180, 600));
  const onResizeLeft = useCallback(
    (px: number) => {
      const pct = clamp(Math.round((px / winWidth) * 100), 10, 35);
      setWorkbenchFields({ common: { leftWidthPct: pct } });
    },
    [winWidth, setWorkbenchFields],
  );
  const onResizeRight = useCallback(
    (px: number) => {
      const pct = clamp(Math.round((px / winWidth) * 100), 10, 35);
      setWorkbenchFields({ common: { rightWidthPct: pct } });
    },
    [winWidth, setWorkbenchFields],
  );
  // 拖拽/双击重置共用的 px 边界:10%..35% 换成像素,resetTo 为 15% 像素值(回换正好落 15%)。
  const sidebarMinPx = Math.round(0.1 * winWidth);
  const sidebarMaxPx = Math.round(0.35 * winWidth);
  const sidebarResetPx = Math.round(0.15 * winWidth);
  const floatingTaskQueuePosition = useMemo(
    () => resolveFloatingTaskQueueRect(floatingTaskQueue),
    [floatingTaskQueue],
  );
  const floatingClassPalettePosition = useMemo(
    () => resolveFloatingClassPaletteRect(floatingClassPalette),
    [floatingClassPalette],
  );
  const floatingInspectorPosition = useMemo(
    () => resolveFloatingInspectorRect(floatingInspector),
    [floatingInspector],
  );
  const floatingDiscussionPosition = useMemo(
    () => resolveFloatingDiscussionRect(floatingDiscussion),
    [floatingDiscussion],
  );
  const detachTaskQueue = useCallback(() => {
    setWorkbenchLayout({
      floatingTaskQueue: {
        ...floatingTaskQueue,
        ...floatingTaskQueuePosition,
        detached: true,
      },
    });
    setLeftOpenState(false);
  }, [floatingTaskQueue, floatingTaskQueuePosition, setLeftOpenState, setWorkbenchLayout]);
  const detachClassPalette = useCallback(() => {
    setWorkbenchLayout({
      floatingClassPalette: {
        ...floatingClassPalette,
        ...floatingClassPalettePosition,
        detached: true,
      },
    });
    setLeftOpenState(false);
  }, [floatingClassPalette, floatingClassPalettePosition, setLeftOpenState, setWorkbenchLayout]);
  const detachInspector = useCallback(() => {
    setWorkbenchLayout({
      floatingInspector: {
        ...floatingInspector,
        ...floatingInspectorPosition,
        detached: true,
      },
    });
    setRightOpenState(false);
  }, [floatingInspector, floatingInspectorPosition, setRightOpenState, setWorkbenchLayout]);
  const detachDiscussion = useCallback(() => {
    setWorkbenchLayout({
      floatingDiscussion: {
        ...floatingDiscussion,
        ...floatingDiscussionPosition,
        detached: true,
      },
    });
    setRightOpenState(false);
  }, [floatingDiscussion, floatingDiscussionPosition, setRightOpenState, setWorkbenchLayout]);
  const mergeTaskQueueBack = useCallback(() => {
    setWorkbenchLayout({
      floatingTaskQueue: {
        ...floatingTaskQueue,
        detached: false,
      },
    });
  }, [floatingTaskQueue, setWorkbenchLayout]);
  const mergeClassPaletteBack = useCallback(() => {
    setWorkbenchLayout({
      floatingClassPalette: {
        ...floatingClassPalette,
        detached: false,
      },
    });
  }, [floatingClassPalette, setWorkbenchLayout]);
  const mergeInspectorBack = useCallback(() => {
    setWorkbenchLayout({
      floatingInspector: {
        ...floatingInspector,
        detached: false,
      },
    });
  }, [floatingInspector, setWorkbenchLayout]);
  const mergeDiscussionBack = useCallback(() => {
    setWorkbenchLayout({
      floatingDiscussion: {
        ...floatingDiscussion,
        detached: false,
      },
    });
  }, [floatingDiscussion, setWorkbenchLayout]);
  const closeFloatingTaskQueue = useCallback(() => {
    setWorkbenchLayout({
      floatingTaskQueue: {
        ...floatingTaskQueue,
        detached: false,
      },
    });
    setLeftOpenState(false);
  }, [floatingTaskQueue, setLeftOpenState, setWorkbenchLayout]);
  const closeFloatingClassPalette = useCallback(() => {
    setWorkbenchLayout({
      floatingClassPalette: {
        ...floatingClassPalette,
        detached: false,
      },
    });
    setLeftOpenState(false);
  }, [floatingClassPalette, setLeftOpenState, setWorkbenchLayout]);
  const closeFloatingInspector = useCallback(() => {
    setWorkbenchLayout({
      floatingInspector: {
        ...floatingInspector,
        detached: false,
      },
    });
    setRightOpenState(false);
  }, [floatingInspector, setRightOpenState, setWorkbenchLayout]);
  const closeFloatingDiscussion = useCallback(() => {
    setWorkbenchLayout({
      floatingDiscussion: {
        ...floatingDiscussion,
        detached: false,
      },
    });
    setRightOpenState(false);
  }, [floatingDiscussion, setRightOpenState, setWorkbenchLayout]);
  // v0.16.8 · 选中标注浮动信息卡:位置 / 折叠态走 layout 偏好(跨设备),显隐由选中状态驱动。
  const floatingSelection = s.workbenchLayout.floatingSelection;
  const floatingSelectionPosition = useMemo(
    () => resolveFloatingSelectionRect(floatingSelection),
    [floatingSelection],
  );
  const onSelectionPositionChange = useCallback(
    (patch: Partial<FloatingPanelRect>) => {
      setWorkbenchLayout({
        floatingSelection: { ...floatingSelection, ...patch },
      });
    },
    [floatingSelection, setWorkbenchLayout],
  );
  const collapseSelectionCard = useCallback(() => {
    setWorkbenchLayout({
      floatingSelection: { ...floatingSelection, collapsed: true },
    });
  }, [floatingSelection, setWorkbenchLayout]);
  const expandSelectionCard = useCallback(() => {
    setWorkbenchLayout({
      floatingSelection: { ...floatingSelection, collapsed: false },
    });
  }, [floatingSelection, setWorkbenchLayout]);

  // v0.16.8 Phase 3 · 视频轨迹面板的共享构建器:右栏(VideoTrackSidebar + 章节)与选中浮动卡
  // 复用同一份 props/回调,杜绝两套逻辑漂移。frameFilter 控制「全部 / 当前帧」轨迹过滤。
  const renderVideoTrackSidebar = useCallback(
    (frameFilter: TrackFilter) => (
      <VideoTrackSidebar
        annotations={visibleAnnotationsData}
        selectedId={s.selectedId}
        selectedIds={s.selectedIds}
        frameIndex={s.videoFrameIndex}
        userId={meUserId ?? null}
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
        propagateOverwrite={currentProject?.rendering_config?.propagateOverwrite ?? null}
      />
    ),
    [
      visibleAnnotationsData, s.selectedId, s.selectedIds, s.videoFrameIndex, meUserId, isLocked,
      s.hiddenVideoTrackIds, s.lockedVideoTrackIds, classes, handleSelectBox,
      s.toggleHiddenVideoTrack, s.toggleLockedVideoTrack, s.setVideoFrameIndex, mode, modeState.diffMode,
      handleStartChangeClass, handleVideoBatchRename, handleVideoBatchDelete, handleVideoUpdate,
      handleVideoConvertToBboxes, handleVideoComposeTracks, trackerJobs.byAnnotation, openPropagateDialog,
      trackerJobs.cancel, s.trackColorOverrides, s.setVideoTrackColor, toolView.attributeSchema,
      handleUpdateTrackAttributes, handleUpdateKeyframeAttributes, handlePropagateKeyframe, samplingStep,
      currentProject?.rendering_config?.propagateOverwrite,
    ],
  );

  // 图片 / 视频选中即现(3D 用自有 PSR 面板,不显示)。单选 = 类别标题 + 内容;
  // 多选 = 「N 个已选中 · 批量」精简态;无选中 = null(隐藏)。
  // 图片单选注入真实内容(改类 / 锁 / 隐藏 / 删除 / 几何 / 属性);视频单选搬入完整轨迹面板。
  const selectionCardEligible = stageKind === "image" || stageKind === "video";
  const selectionCount = s.selectedIds.length;
  const selectionCard = useMemo<SelectedAnnotationCardProps | null>(() => {
    if (!selectionCardEligible || selectionCount < 1) return null;
    const multi = selectionCount > 1;
    const ann = selectedAnnotationForPanel;
    const title = multi
      ? `${selectionCount} 个已选中 · 批量`
      : ann?.class_name ?? "选中标注";
    let children: ReactNode;
    if (multi) {
      children = <SelectionCardPlaceholder summary={`已选中 ${selectionCount} 个标注。`} />;
    } else if (stageKind === "video") {
      // 视频:把右栏完整轨迹面板搬进卡内(共享同一构建器/回调),含轨迹·当前帧·关键帧跳转·属性。
      children = (
        <div className={styles.videoSelectionCardBody}>
          {renderVideoTrackSidebar("current")}
        </div>
      );
    } else if (ann && stageKind === "image") {
      children = (
        <ImageSelectionCardContent
          annotation={ann}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          attributeSchema={toolView.attributeSchema}
          readOnly={isLocked}
          onChangeClass={handleStartChangeClass}
          onToggleFlag={handlePatchShapeFlag}
          onDelete={handleDeleteBox}
          onUpdateAttributes={handleUpdateAttributes}
        />
      );
    } else {
      children = (
        <SelectionCardPlaceholder
          summary={ann ? `类别 ${ann.class_name} · ${ann.geometry.type}` : "已选中 1 个标注。"}
        />
      );
    }
    return {
      title,
      position: floatingSelectionPosition,
      onPositionChange: onSelectionPositionChange,
      collapsed: floatingSelection.collapsed,
      onCollapse: collapseSelectionCard,
      onExpand: expandSelectionCard,
      children,
    };
  }, [
    selectionCardEligible,
    selectionCount,
    selectedAnnotationForPanel,
    stageKind,
    imageWidth,
    imageHeight,
    toolView.attributeSchema,
    isLocked,
    handleStartChangeClass,
    handlePatchShapeFlag,
    handleDeleteBox,
    handleUpdateAttributes,
    renderVideoTrackSidebar,
    floatingSelectionPosition,
    onSelectionPositionChange,
    floatingSelection.collapsed,
    collapseSelectionCard,
    expandSelectionCard,
  ]);

  const toggleLeftSidebar = useCallback(() => {
    if (!leftHasEmbeddedPanels) return;
    setLeftOpenState(!leftOpenState);
  }, [leftHasEmbeddedPanels, leftOpenState, setLeftOpenState]);
  const toggleRightSidebar = useCallback(() => {
    if (!rightHasEmbeddedPanels) return;
    setRightOpenState(!rightOpenState);
  }, [rightHasEmbeddedPanels, rightOpenState, setRightOpenState]);
  useEffect(() => {
    // 边栏收起/展开后 stage 容器宽度变化, 用 fitTick 触发 image/video stage 重新适应窗口。
    if (stageKind !== "image" && stageKind !== "video") return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setFitTick((n) => n + 1);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [leftOpen, rightOpen, stageKind]);

  if (
    isProjectLoading
    || isTaskListLoading
    || (shouldLoadDirectTask && directTaskQuery.isLoading)
  ) {
    return { kind: "loading" };
  }

  if (!currentProject) {
    return {
      kind: "empty",
      emptyState: {
        icon: "warning",
        message: "项目不存在或无访问权限",
        onBack,
      },
    };
  }

  if (!task && shouldLoadDirectTask && directTaskQuery.isError) {
    return {
      kind: "empty",
      emptyState: {
        icon: "warning",
        message: "任务不存在或无访问权限",
        onBack,
      },
    };
  }

  if (tasks.length === 0 && !task) {
    return {
      kind: "empty",
      emptyState: {
        icon: "inbox",
        message: "该项目暂无任务",
        onBack,
      },
    };
  }

  if (!task) {
    return { kind: "loading" };
  }

  const propagateDialogTrack = propagateDialog?.annotation ?? null;
  const propagateDialogNextKeyframe = propagateDialogTrack
    ? [...propagateDialogTrack.geometry.keyframes]
        .map((kf) => kf.frame_index)
        .filter((idx) => idx > s.videoFrameIndex)
        .sort((a, b) => a - b)[0] ?? null
    : null;

  const layout: ComponentProps<typeof WorkbenchLayout> = {
    gridTemplateColumns: `${leftOpen ? `clamp(180px, ${leftPct}%, 600px)` : "0px"} 48px 1fr ${rightOpen ? `clamp(180px, ${rightPct}%, 600px)` : "0px"}`,
    taskQueue: {
      open: leftOpen, classes,
      // 3D 点云台用当前 3D 工具单位的 classesConfig;2D 仍用项目级。
      classesConfig: stageKind === "3d" ? classesConfig : currentProject?.classes_config,
      toolLabel: stageKind === "3d"
        ? (s.threeDTool === "point-mask" ? "点云分割" : "3D 框")
        : TOOL_REGISTRY[s.tool].label,
      toolIcon: stageKind === "3d"
        ? (s.threeDTool === "point-mask" ? "scissors" : "rect")
        : TOOL_REGISTRY[s.tool].icon,
      activeClass: s.activeClass, recentClasses, tasks, taskId, taskIdx, hasNextPage,
      isFetchingNextPage, onFetchNextPage: fetchNextPage,
      onSelectTask: selectTask, batches: activeBatches, selectedBatchId, onSelectBatch: handleSelectBatch,
      totalCount: tasksTotal, isOwner, onGoToBatchSettings: () => { if (projectId) navigate(`/projects/${projectId}/settings?section=batches`); },
      width: leftPx, onResize: onResizeLeft,
      widthMin: sidebarMinPx, widthMax: sidebarMaxPx, widthResetTo: sidebarResetPx,
      onDetachQueue: detachTaskQueue,
      onDetachPalette: detachClassPalette,
      // v0.13.3-5 · 3D 点云台:左栏色板可点选 = 放置新框的类别(2D 仍只读图例)。
      classPickable: stageKind === "3d" && !isLocked,
      onPickClass: s.setActiveClass,
    },
    toolDock: {
      tool: s.tool,
      onSetTool: (next) => {
        s.setTool(next);
        if (isAIToolId(next)) setAiDrawerOpen(true);
      },
      videoTool: s.videoTool, onSetVideoTool: s.setVideoTool,
      isPromptSupported: routing.isPromptSupported,
      capabilitiesLoading: routing.isLoading,
      aiToolDrawer: isAIToolId(s.tool) && aiDrawerOpen ? (
        <AIToolDrawer
          tool={s.tool}
          backendName={mlCapabilities.capability?.name}
          capability={mlCapabilities.capability}
          samPolarity={s.samPolarity}
          onSetSamPolarity={s.setSamPolarity}
          isLoading={mlCapabilities.isLoading}
          isError={mlCapabilities.isError}
          exemplarOutputMode={s.exemplarOutputMode}
          onSetExemplarOutputMode={handleSetExemplarOutputMode}
          models={mlCapabilities.models}
          activeModelId={mlCapabilities.activeModelId}
          onSetActiveModelId={mlCapabilities.setActiveModelId}
          capabilityWarnings={capabilityWarnings}
          interactiveBackends={
            (activeInteractivePrompt
              ? routing.candidatesFor(activeInteractivePrompt)
              : []
            )
              .map((id) => backends.find((b) => b.id === id))
              .filter((b): b is { id: string; name: string } => !!b)
          }
          selectedInteractiveId={interactiveBackendId}
          onSelectInteractive={routing.setPreferredInteractiveId}
        />
      ) : null,
      reviewMode: mode === "review", videoMode: isVideoTask,
      enabledToolUnits,
      videoModes,
      threeDMode: stageKind === "3d",
      threeDTool: s.threeDTool,
      onSetThreeDTool: s.setThreeDTool,
    },
    banners: {
      mode, task, lockError, lockConflict, claimInfo: modeState.claimInfo, canWithdraw: bannerActions.canWithdraw,
      isWithdrawing: bannerActions.isWithdrawing, isReopening: bannerActions.isReopening,
      isAcceptingRejection: bannerActions.isAcceptingRejection, onWithdraw: bannerActions.onWithdraw,
      onReopen: bannerActions.onReopen, onAcceptRejection: bannerActions.onAcceptRejection,
    },
    topbar: {
      projectName, projectDisplayId,
      task, taskIdx, taskTotal: tasks.length, aiRunning, batchStatus: currentBatchStatus,
      isSubmitting: topbarActions.isSubmitting ?? submitTaskMut.isPending, confThreshold: s.confThreshold,
      onShowHotkeys: () => setShowHotkeys(true),
      onBack,
      leftSidebarOpen: leftOpen,
      rightSidebarOpen: rightOpen,
      onToggleLeftSidebar: toggleLeftSidebar,
      onToggleRightSidebar: toggleRightSidebar,
      onRunAi: () => {
        setAiPopoverOpen((open) => !open);
      },
      aiDisabled: isVideoTask,
      onPrev: () => navigateTask("prev"), onNext: () => navigateTask("next"),
      onSubmit: topbarActions.onSubmit ?? handleSubmitTask, onSmartNextOpen: topbarActions.onSmartNextOpen,
      onSmartNextUncertain: topbarActions.onSmartNextUncertain,
      onOpenWorkbenchSettings: () => setWorkbenchSettingsOpen(true),
      canWithdraw: topbarActions.canWithdraw, canReopen: topbarActions.canReopen,
      isWithdrawing: topbarActions.isWithdrawing, isReopening: topbarActions.isReopening,
      onWithdraw: topbarActions.onWithdraw, onReopen: topbarActions.onReopen,
      isSkipping: topbarActions.isSkipping, onSkip: topbarActions.onSkip, mode,
      onApprove: topbarActions.onApprove, onReject: topbarActions.onReject,
      isApproving: topbarActions.isApproving, isRejecting: topbarActions.isRejecting,
      reviewInfoSlot: topbarActions.reviewInfoSlot,
    },
    stageHost: {
      common: {
        stageKind,
        taskId: taskId ?? null,
        readOnly: isLocked,
        activeClass: s.activeClass,
        selectedId: s.selectedId,
        selectedIds: s.selectedIds,
        annotations: visibleAnnotationsData,
        pendingDrawing: s.pendingDrawing,
        fitTick,
        onSelectBox: handleSelectBox,
        onCursorMove: setCursor,
        onDeleteUserBox: handleDeleteBox,
        onChangeUserBoxClass: handleStartChangeClass,
        threeDTool: s.threeDTool,
        onSetThreeDTool: s.setThreeDTool,
        onCrossFramePropagate: crossFramePropagate,
        onCrossFramePropagateBatch: crossFramePropagateBatch,
        onCrossFramePropagateToTask: crossFramePropagateToTask,
        onCrossFrameInterpolate: crossFrameInterpolate,
        rightSidebarOpen: rightOpen,
        rightSidebarWidth: rightOpen ? rightPx : 0,
        workbenchLayout: s.workbenchLayout,
        onWorkbenchLayoutChange: s.setWorkbenchLayout,
        workbenchCommon: s.workbenchConfig.common,
        workbenchPointcloud: s.workbenchConfig.pointcloud,
        workbenchConfigLoaded: s.workbenchConfigLoaded,
        onWorkbenchConfigChange: s.setWorkbenchFields,
        onWorkbenchConfigUpdate: s.updateWorkbenchConfig,
        projectRenderingConfig: currentProject?.rendering_config ?? null,
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
            {stageKind === "image" && (
              <AttributeModeBar
                schema={toolView.attributeSchema}
                value={s.attributeMode}
                onChange={s.setAttributeMode}
                readOnly={isLocked}
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
              editingClassClasses={editingAcceptClasses}
              recentClasses={recentClasses}
              activeClass={s.activeClass}
              onPickPendingClass={handlePickPendingClassAny}
              onCancelPending={handleCancelPending}
              onCommitChangeClass={handleCommitChangeClass}
              onChangeClassKeepOpen={handleChangeClassKeepOpen}
              changeClassAttrEditing={changeClassAttrEditing}
              onCancelChangeClass={handleCancelChangeClass}
              onSamCommitClass={handleSamCommitClass}
              onSamCancelClass={handleSamCancelClass}
              onCommitBatchChangeClass={handleCommitBatchChangeClass}
              onCancelBatchChange={handleCancelBatchChange}
            />
          </>
        ),
      },
      video: {
        videoManifest: videoManifest.data,
        videoManifestLoading: videoManifest.isLoading,
        videoFrameTimetable: videoFrameTimetable.data,
        videoChapters: isVideoTask ? videoTimelineChapters : undefined,
        videoSampling,
        videoManifestError: videoManifest.error,
        videoTool: s.videoTool,
        videoFrameIndex: s.videoFrameIndex,
        videoReviewDisplayMode: mode === "review" ? modeState.diffMode : undefined,
        hiddenVideoTrackIds: s.hiddenVideoTrackIds,
        lockedVideoTrackIds: s.lockedVideoTrackIds,
        trackColorOverrides: s.trackColorOverrides,
        onVideoFrameIndexChange: s.setVideoFrameIndex,
        onVideoCreate: handleVideoCreate,
        onVideoPendingDraw: handleVideoPendingDraw,
        onVideoUpdate: handleVideoUpdate,
        onVideoRename: handleVideoRename,
        onVideoConvertToBboxes: handleVideoConvertToBboxes,
        onVideoComposeTracks: handleVideoComposeTracks,
        onToggleHiddenVideoTrack: s.toggleHiddenVideoTrack,
        onToggleLockedVideoTrack: s.toggleLockedVideoTrack,
        onPropagateVideoTrack: openPropagateDialog,
        // 选中浮动卡(展开态)已承载关键帧跳转,隐藏画布右上的冗余 <details> 快跳浮层;
        // 卡折叠时仍保留该浮层作为快捷入口。
        hideKeyframeQuickJump:
          stageKind === "video" && selectionCount === 1 && !floatingSelection.collapsed,
      },
      image: {
        fileUrl,
        blurhash,
        imageWidth,
        imageHeight,
        thumbnailUrl,
        tool: s.tool,
        fadedAiIds: dimmedAiIds,
        nudgeMap,
        userBoxes: modeState.diffMode === "raw" ? [] : userBoxes,
        aiBoxes: modeState.diffMode === "final" ? [] : aiBoxes,
        spacePan,
        vp,
        setVp,
        setFitTick,
        onAcceptPrediction: handleAcceptPrediction,
        onRejectPrediction: handleRejectPrediction,
        onPatchShapeFlag: handlePatchShapeFlag,
        imageClipboardActions: imageContextMenuClipboard,
        onCommitDrawing: handleCommitDrawing,
        onCommitRotatedBbox: createRotatedBbox,
        onCommitRotateBbox: handleCommitRotateBbox,
        onSamPrompt: (prompt) => {
          // v0.14.18 · 交互 variant/params 仅当交互后端与批量配置后端一致时复用 preCfg (单后端,
          // 行为不变); 多后端 (交互≠批量) 时不混用批量后端的 variant, 交互后端用其预热/默认变体。
          const extra =
            interactiveBackendId === batchBackendId
              ? buildPredictParams(preCfg.paramsValue, preCfg.currentVariantSlice)
              : {};
          if (prompt.kind === "point") return sam.runPoint(prompt.pt, prompt.alt ? 0 : 1, extra);
          if (prompt.kind === "exemplar") return sam.runExemplar(prompt.bbox, s.exemplarOutputMode, extra);
          return sam.runBbox(prompt.bbox, extra);
        },
        onCommitMove: handleCommitMove,
        onCommitResize: handleCommitResize,
        onCommitPolygonGeometry: handleCommitPolygonGeometry,
        onCommitKeypointGeometry: handleCommitKeypointGeometry,
        onBatchDelete: handleBatchDelete,
        onBatchChangeClass: handleStartBatchChangeClass,
        onJoinSelected: handleJoinSelectedPolygons,
        onApplyAttributeMode: handleApplyAttributeMode,
        onStageGeometry: setStageGeom,
      },
      ai: {
        samCandidates: sam.candidates,
        samActiveIdx: sam.activeIdx,
        samSubTool: s.samSubTool,
        samPolarity: s.samPolarity,
        onRefineSamCandidate: handleRefineSamCandidate,
      },
      editors: {
        polygonDraft: s.tool === "polygon" ? polygonHandle : s.tool === "polyline" ? polylineHandle : undefined,
        keypointDraft: s.tool === "keypoint" ? keypointHandle : undefined,
        keypointSchema: toolView.keypointSchema,
        canvasShapes: s.canvasDraft.shapes,
        canvasEditable: s.canvasDraft.active,
        canvasStroke: s.canvasDraft.stroke,
        onCanvasStrokeCommit: (points, stroke) => s.appendCanvasShape({ type: "line", points, stroke }),
        historicalShapes: hoveredCommentShapes ?? undefined,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        onUndo: history.undo,
        onRedo: history.redo,
        onSetCanvasStroke: s.setCanvasStroke,
        canvasShapeCount: s.canvasDraft.shapes.length,
        onUndoCanvasShape: s.undoCanvasShape,
        onClearCanvasShapes: s.clearCanvasShapes,
        onCancelCanvasDraft: s.cancelCanvasDraft,
        onDoneCanvasDraft: s.endCanvasDraft,
        stageGeom,
        maskEditor,
        projectRenderingConfig: currentProject?.rendering_config ?? null,
        issuePixelFeedbacks: issuesQuery.data?.items ?? [],
        // v0.11.5 · 图钉高亮跟 DiscussionPanel issues tab 共享 store (旧浮层路径已删)。
        highlightIssueId: activeIssueHighlightId,
        // 单击图钉 → 高亮 + 请求 DiscussionPanel 切到 issues tab + 高亮对应列表行。
        onIssuePinClick: (id) => highlightIssueFromPin(id),
        issuePinDropArmed: issuePinDropArmed,
        onIssuePinDrop: (x, y) => {
          setIssuePinDropArmed(false);
          setIssuePinPrefill({ x, y });
          setIssueCreateOpen(true);
        },
      },
    },
    videoControlsRef,
    statusBar: {
      userBoxesCount: userBoxes.length, aiBoxesCount: aiBoxes.length, activeClass: s.activeClass,
      imageWidth, imageHeight, cursor, preannotationProgress, preannotationConn, preannotationRetries,
      avgLeadMs: avgMs, remainingTaskCount, offlineQueueCount: queueCount, online,
      onShowQueueDrawer: openOfflineDrawer, lockRemainingMs: remainingMs, lockError, lockConflict,
      diffMode: modeState.diffMode, onSetDiffMode: modeState.onSetDiffMode,
    },
    inspector: {
      open: rightOpen, width: rightPx, onResize: onResizeRight, readOnly: isLocked,
      widthMin: sidebarMinPx, widthMax: sidebarMaxPx, widthResetTo: sidebarResetPx,
      onDetach: detachInspector,
      capabilityWarnings,
      aiBoxes: modeState.diffMode !== "final" ? aiBoxes : [],
      predictionSourceFilter,
      userBoxes, orphanUserBoxIds: orphanAnnotationIds,
      selectedId: s.selectedId, selectedIds: s.selectedIds,
      dimmedAiIds,
      imageWidth, imageHeight,
      onSelect: handleSelectBox,
      onAcceptPrediction: handleAcceptPrediction,
      onRejectPrediction: handleRejectPrediction,
      onRefinePrediction: handleRefinePrediction,
      onRefineUserPolygon: handleRefineUserPolygon,
      onClearSelection: () => s.setSelectedId(null), onDeleteUserBox: handleDeleteBox,
      onChangeUserBoxClass: handleStartChangeClass,
      onToggleUserBoxFlag: (id: string, flag: "is_locked" | "is_hidden") => {
        const ann = userBoxes.find((b) => b.id === id);
        if (!ann) return;
        const cur = !!ann[flag];
        handlePatchShapeFlag(id, flag, !cur);
      },
      attributeSchema: toolView.attributeSchema,
      selectedAnnotation: selectedAnnotationForPanel, onUpdateAttributes: handleUpdateAttributes,
      onBulkUpdateAttributes: (ids, patch) => {
        if (!taskId || ids.length === 0) return;
        bulkUpdateMut.mutate({ ids, patch });
      },
      onSelectGroup: (memberIds) => s.replaceSelected(memberIds),
      hasMorePredictions: modeState.diffMode !== "final" && !!predictionsInfinite.hasNextPage,
      isFetchingMorePredictions: modeState.diffMode !== "final" && predictionsInfinite.isFetchingNextPage,
      onFetchMorePredictions: () => predictionsInfinite.fetchNextPage(),
      currentFrameIndex: isVideoTask ? s.videoFrameIndex : undefined,
      onSeekFrame: isVideoTask ? s.setVideoFrameIndex : undefined,
      videoTrackPanel: isVideoTask ? ((frameFilter) => (
        <div className={styles.videoTrackPanel}>
          {renderVideoTrackSidebar(frameFilter)}
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
    },
    floatingTaskQueue: {
      detached: taskQueueDetached,
      position: floatingTaskQueuePosition,
      onPositionChange: (patch) => {
        s.setWorkbenchLayout({
          floatingTaskQueue: {
            ...s.workbenchLayout.floatingTaskQueue,
            ...patch,
          },
        });
      },
      onMergeBack: mergeTaskQueueBack,
      onClose: closeFloatingTaskQueue,
    },
    floatingClassPalette: {
      detached: classPaletteDetached,
      position: floatingClassPalettePosition,
      onPositionChange: (patch) => {
        s.setWorkbenchLayout({
          floatingClassPalette: {
            ...s.workbenchLayout.floatingClassPalette,
            ...patch,
          },
        });
      },
      onMergeBack: mergeClassPaletteBack,
      onClose: closeFloatingClassPalette,
    },
    floatingInspector: {
      detached: inspectorDetached,
      position: floatingInspectorPosition,
      onPositionChange: (patch) => {
        s.setWorkbenchLayout({
          floatingInspector: {
            ...s.workbenchLayout.floatingInspector,
            ...patch,
          },
        });
      },
      onMergeBack: mergeInspectorBack,
      onClose: closeFloatingInspector,
    },
    floatingDiscussion: {
      detached: discussionDetached,
      position: floatingDiscussionPosition,
      onPositionChange: (patch) => {
        s.setWorkbenchLayout({
          floatingDiscussion: {
            ...s.workbenchLayout.floatingDiscussion,
            ...patch,
          },
        });
      },
      onMergeBack: mergeDiscussionBack,
      onClose: closeFloatingDiscussion,
    },
    floatingSelection: selectionCard,
    aiPopover: {
      open: aiPopoverOpen && !isVideoTask,
      rightOffset: rightOpen ? rightPx + 44 : 44,
      position: aiPopoverPosition,
      onPositionChange: setAiPopoverPosition,
      size: aiPopoverSize,
      onSizeChange: setAiPopoverSize,
      aiModel, aiRunning, aiBoxCount: modeState.diffMode !== "final" ? aiBoxes.length : 0,
      confThreshold: s.confThreshold, aiTakeoverRate,
      onClose: () => setAiPopoverOpen(false),
      onRunAi: handleRunAi,
      onAcceptAll: handleAcceptAll,
      onSetConfThreshold: s.setConfThreshold,
      taskAiCost: taskAiMeta.totalCost,
      taskAiAvgMs: taskAiMeta.avgMs,
      taskAiPredictionCount: taskAiMeta.count,
      // 配置区 (任务/类别白名单/variant/参数) 由共享组件 PreannotateConfigForm 渲染, 状态走 preCfg.
      cfg: preCfg,
      isVariantWarm: preCfg.isCurrentVariantWarm,
      // 多 backend (批量线): 项目绑了 >1 个后端时, 面板顶部出 backend 选择器 (单个时 PreannotateConfigForm 自动隐藏).
      backends,
      selectedBackendId: batchBackendId,
      onSelectBackend: selectBatchBackend,
      projectMlBackendId: currentProject?.ml_backend_id ?? null,
    },
    hotkeys: { open: showHotkeys, onClose: () => setShowHotkeys(false), attributeSchema: toolView.attributeSchema },
    offlineQueue: { open: offlineDrawerOpen, onClose: closeOfflineDrawer, currentTaskId: taskId, onFlushOne: executeOp, onFlushAll: flushOffline },
    workbenchSettings: {
      open: workbenchSettingsOpen,
      onClose: () => setWorkbenchSettingsOpen(false),
      stageKind,
      projectRenderingConfig: currentProject?.rendering_config ?? null,
      hideOrphanAnnotations,
      onToggleHideOrphans: () => setHideOrphanAnnotations((value) => !value),
    },
    conflict: { open: conflictOpen, onReload: handleConflictReload, onOverwrite: handleConflictOverwrite, onClose: () => setConflictOpen(false) },
    rejectModal: modeState.rejectModal ? {
      open: modeState.rejectModal.open, count: 1, onClose: modeState.rejectModal.onClose,
      onConfirm: modeState.rejectModal.onConfirm, skipReasonHint: modeState.rejectModal.skipReasonHint,
    } : undefined,
    deleteConfirm: deleteConfirm ? {
      open: true,
      count: deleteConfirm.count,
      onCancel: closeDeleteConfirm,
      onConfirm: confirmDelete,
    } : undefined,
    guidePanel: ANNOTATION_GUIDE_UI_ENABLED && projectId ? {
      projectId,
      content: (currentProject as unknown as { annotation_guide?: string | null } | undefined)?.annotation_guide ?? null,
    } : undefined,
    // v0.11.5 · B 组 · DiscussionPanel 转正 → 右栏固定两段布局 (上 AIInspectorPanel + 下 DiscussionPanel)。
    discussionPanel: {
      annotationId: s.selectedId,
      taskId: taskId ?? null,
      projectId: projectId ?? null,
      currentUserId: meUserId ?? null,
      // v0.11.5+ · 评论内画布批注 (live 绘图) + 视频帧锚点 + 点评论跳帧的桥接，
      // 恢复 B1 去 flag 时随 AIInspectorPanel 内嵌一起删掉的接线。
      backgroundUrl: task?.file_url ?? null,
      imageWidth,
      imageHeight,
      enableCanvasDrawing: true,
      liveCanvas: {
        active: s.canvasDraft.active,
        result: s.canvasDraft.pendingResult,
        onStart: (initial) => s.beginCanvasDraft(selectedAnnotationForPanel?.id ?? null, initial),
        onConsume: s.consumeCanvasResult,
      },
      commentAnchor: videoCommentAnchor,
      onSeekFrame: isVideoTask ? s.setVideoFrameIndex : undefined,
      onDetach: detachDiscussion,
    },
  };

  const propagateDialogProps: ComponentProps<typeof VideoTrackerPropagateDialog> = {
    open: Boolean(propagateDialog),
    frameIndex: s.videoFrameIndex,
    maxFrame: Math.max(0, videoFrameCount - 1),
    nextKeyframeAfter: propagateDialogNextKeyframe,
    userId: meUserId ?? null,
    samplingStep,
    projectDefaultModel: currentProject?.rendering_config?.trackerDefaultModel ?? null,
    preferNonMockModel: Boolean(currentProject?.ml_backend_id),
    submitting: Boolean(propagateDialog?.submitting),
    onCancel: () => setPropagateDialog(null),
    onSubmit: handlePropagateSubmit,
  };

  const issueSection = projectId && taskId ? {
    openIssueCount,
    stageKind,
    issuePinDropArmed,
    // v0.11.5 · issue FAB → 切到 DiscussionPanel issues tab (旧浮层 IssueListPanel 已删)。
    // v0.13.10+ · 不再把已分离的标注详情合并回去；讨论面板仍嵌入时才展开右栏。
    onOpenList: () => {
      if (!s.workbenchLayout.floatingDiscussion.detached && !s.rightOpen) s.setRightOpen(true);
      requestIssuesTab();
    },
    onToggleIssuePinDrop: () => setIssuePinDropArmed((v) => !v),
    createModal: {
      open: issueCreateOpen,
      projectId,
      taskId,
      listParams: issueListParams,
      prefilledAnchor: issuePinPrefill,
      onClose: () => { setIssueCreateOpen(false); setIssuePinPrefill(null); },
    },
  } satisfies WorkbenchShellIssueSection : undefined;

  return {
    kind: "ready",
    layout,
    propagateDialog: propagateDialogProps,
    issueSection,
  };
}
