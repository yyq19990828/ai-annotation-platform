import {
  useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/components/ui/Toast";
import { useProject, useUpdateProject } from "@/hooks/useProjects";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import {
  useTaskList, useTask, useAnnotations, useCreateAnnotation, useDeleteAnnotation,
  useUpdateAnnotation, useSubmitTask,
  useVideoManifest,
  useVideoFrameTimetable,
} from "@/hooks/useTasks";
import { usePredictions } from "@/hooks/usePredictions";
import { useAnnotationBulkUpdate } from "@/hooks/useAnnotationGroup";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import { tasksApi } from "@/api/tasks";
import { rasterMasksApi } from "@/api/rasterMasks";
import { ApiError } from "@/api/client";
import { resolveCrossFrameNavigation } from "./crossFrameTarget";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { predictionsApi } from "@/api/predictions";
import { mlBackendsApi } from "@/api/ml-backends";
import type { Annotation, TaskResponse, AnnotationResponse, VideoTrackGeometry, VideoTrackMaskGeometry } from "@/types";
import { ANNOTATION_GUIDE_UI_ENABLED } from "@/config/featureFlags";
import { publishTaskBoxCount } from "@/components/PerfHud/useTaskBoxCount";
import { useWorkbenchState, type VideoTool } from "./useWorkbenchState";
import { usePendingGeom } from "./usePendingGeom";
import { useToolBindings, classesForUnit } from "./useToolBindings";
import { videoToolUnit, videoToolEnabled } from "../stage/videoToolUnits";
import type { ToolUnitId } from "@/constants/toolUnits";
import type { AttributeField, ToolBinding, ToolBindings } from "@/api/projects";
import { useViewportTransform } from "./useViewportTransform";
import { useIssuePins } from "./useIssuePins";
import { usePredictionPropagation } from "./usePredictionPropagation";
import { useAiPopoverFrame } from "./useAiPopoverFrame";
import { useVideoTrackerPanelFrame } from "./useVideoTrackerPanelFrame";
import { useAnnotationHistory } from "./useAnnotationHistory";
import { useRecentClasses } from "./useRecentClasses";
import { useSessionStats } from "./useSessionStats";
import { useWorkbenchHotkeys } from "./useWorkbenchHotkeys";
import { useCanvasDraftPersistence } from "./useCanvasDraftPersistence";
import { useWorkbenchTaskFlow } from "./useWorkbenchTaskFlow";
import { useInteractiveAI, type InteractiveTransport, type TextOutputMode } from "./useInteractiveAI";
import type { VideoSamPrompt } from "../stage/videoStageTypes";
import { isSamCandidateNavTool } from "../stage/videoKonvaInteraction";
import { tightenBboxFromPolygon } from "../stage/shared/geometry/bbox";
import { resolveInitialOutputMode, writeStoredOutputMode } from "./samTextOutput";
import { shouldConfirmAnnotationDelete } from "./deleteConfirmation";
import { usePreannotateConfig } from "@/pages/AIPreAnnotate/components/usePreannotateConfig";
import { useMLBackends } from "@/hooks/useMLBackends";
import { useMLCapabilities } from "./useMLCapabilities";
import {
  useBackendRouting,
  INTERACTIVE_PROMPTS,
} from "./useBackendRouting";
import { useCapabilityValidation } from "./useCapabilityValidation";
import { useAiToolModelPref } from "./useAiToolModelPref";
import { useInteractiveBackendPref } from "./useInteractiveBackendPref";
import { InteractiveToolBar } from "../shell/InteractiveToolBar";
import { SecondaryInferenceBar } from "../shell/SecondaryInferenceBar";
import { useSecondaryBarHiddenPref } from "./useSecondaryBarHiddenPref";
import { IssueCreateModal } from "../shell/IssueCreateModal";
import { isAIToolId, TOOL_REGISTRY, type ToolId } from "../stage/tools";
import { samCandidateGeom } from "./useWorkbenchShellModel.helpers";
import { useHoveredCommentStore, selectEffectiveShapes } from "./useHoveredCommentStore";
import { annotationToBox, collectOccludedKeys } from "./transforms";
import { applyVideoKeyframeToGeometry } from "./videoTrackCommands";
import { useAnnotateMode } from "../modes/useAnnotateMode";
import { useReviewMode } from "../modes/useReviewMode";
import { setActiveClassesConfig, UNKNOWN_CLASS } from "../stage/colors";
import type { VideoStageControls } from "../stage/videoStageControls";
import { deriveSamplingStep } from "../stage/videoSamplingGrid";
import { VideoChapterSidebar, pickChapterTargetFrame } from "../stage/VideoChapterSidebar";
import type { TimelineRangePurpose, VideoTimelineChapterControls } from "../stage/VideoPlaybackOverlay";
import type { VideoLoopRegion } from "../stage/videoNavigationState";
import { VideoTrackSidebar, trackRangesOverlap } from "../stage/VideoTrackSidebar";
import type { VideoTrackGapMode } from "../stage/VideoTrackComposeDialog";
import type { TrackFilter } from "../stage/VideoTrackPanel";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import { VideoTrackerReviewBar } from "../stage/VideoTrackerReviewBar";
import { isAnyVideoSingleFrame, isVideoBbox, isVideoMaskTrack, isVideoPointsTrack, isVideoPolylineTrack, isVideoTrack, resolveTrackAtFrame } from "../stage/videoStageGeometry";
import { aiBoxOnFrame } from "../stage/aiBoxFrames";
import type { AnnotationCommentAnchor } from "@/api/comments";
import { useUpdateVideoChapter, useVideoChapters } from "@/hooks/useVideoChapters";
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
import { getMissingRequired } from "../shell/AttributeForm";
import { ImageSelectionCardContent } from "../shell/ImageSelectionCardContent";
import { ImageBatchCardContent } from "../shell/ImageBatchCardContent";
import { VideoBoxBatchCardContent } from "../shell/VideoBoxBatchCardContent";
import { VideoTrackBatchCardContent } from "../shell/VideoTrackBatchCardContent";
import { AIPredictionCardContent } from "../shell/selectionCard/AIPredictionCardContent";
import { VideoFrameBoxCardContent } from "../shell/selectionCard/VideoFrameBoxCardContent";
import { VideoPointsTrackCardContent } from "../shell/selectionCard/VideoPointsTrackCardContent";
import type { PetSelectionSourceKind, WorkbenchPetContext } from "../shell/pet/usePetState";
import type { FloatingPanelRect } from "../shell/FloatingPanelShell";
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
} from "./offlineQueue";
import { useWorkbenchOfflineQueue } from "./useWorkbenchOfflineQueue";
import { useImageAnnotationActions } from "../stages/image/useImageAnnotationActions";
import { useMaskEditor } from "./useMaskEditor";
import { MaskToolbar } from "../shell/MaskToolbar";
import { useVideoAnnotationActions } from "../stages/video/useVideoAnnotationActions";
import {
  buildPipelineRunPayload,
  missingBackendIdsForStages,
  selectProjectPipelineStages,
  buildPredictParams,
  promptOfTool,
  resolveMaskEditorSize,
  resolveFloatingClassPaletteRect,
  resolveFloatingDiscussionRect,
  resolveFloatingInspectorRect,
  resolveFloatingSelectionRect,
  resolveFloatingTaskQueueRect,
} from "./useWorkbenchShellModel.helpers";
import { useWorkbenchSidebarSizing } from "./useWorkbenchSidebarSizing";
import { useConflictResolution } from "./useConflictResolution";

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

type TrackerSourceAnnotation = AnnotationResponse & {
  geometry: VideoTrackGeometry | VideoTrackMaskGeometry;
};

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
  trackerReview: ComponentProps<typeof VideoTrackerReviewBar>;
  issueSection?: WorkbenchShellIssueSection;
}

export type UseWorkbenchShellModelResult =
  | { kind: "loading" }
  | WorkbenchShellEmptyState
  | WorkbenchShellReadyModel;

// instance_id 契约上是 str(obj_id) (见后端 _frame_result_from_payload), 通常是数字串, 但
// 允许非数字。用于候选叠加的配色索引 + 目标标号: 数字直取, 非数字稳定哈希成正整数,
// 避免 Number("obj_a") → NaN 让 OBJ_PALETTE[NaN]=undefined (无描边) 且标号显示 "NaN"。
function instanceObjNumber(instanceId: string | null | undefined): number {
  const s = instanceId ?? "1";
  if (/^\d+$/.test(s)) return Number(s);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 999) + 1;
}

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
  const requestedFocusId = searchParams.get("focus");
  const requestedTrackId = searchParams.get("track");
  const requestedFrameIndex = (() => {
    const raw = searchParams.get("frame");
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  })();
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
  const projectPipelinesQ = useProjectPipelines(
    { scope: "private", project_id: projectId },
    { enabled: !!projectId },
  );

  const projectName = currentProject?.name ?? "标注工作台";
  const projectDisplayId = currentProject?.display_id ?? "—";

  // v0.14.18 · 多 backend 两条线分流 (见 docs/plans/2026-06-09-v0.14.18-...):
  //   批量线 batchBackendId — 文本/几何/OCR/版面预标, 默认 = 项目默认后端 (ml_backend_id) 回落第一个,
  //     驱动 preCfg / handleRunAi / AI 面板 backend 选择器, 沿用批量页 ProjectDetailPanel 切换语义。
  //   交互线 — point/bbox/exemplar 工具各自按能力路由到交互后端 (见下方 routing / interactiveBackendId)。
  const backendsQ = useMLBackends(projectId);
  const backends = useMemo(
    () => (backendsQ.data ?? []) as unknown as Array<{ id: string; name: string }>,
    [backendsQ.data],
  );
  const firstBackendId = backends[0]?.id ?? null;
  const [batchBackendId, setBatchBackendId] = useState<string | null>(null);
  // 工作台是常驻 session: 用户在 AI 面板手动选过批量 backend 后, 不能因项目默认后端被外部改动
  // (如另一 Tab "设为主后端") 或后端列表顺序变化 (firstBackendId 变) 而被静默重置。
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
      meUserId,
    ));
  }, [projectId, currentProject?.type_key, meUserId, setExemplarOutputMode]);
  const handleSetExemplarOutputMode = useCallback((mode: TextOutputMode) => {
    setExemplarOutputMode(mode);
    if (projectId) writeStoredOutputMode(projectId, mode, meUserId);
  }, [projectId, meUserId, setExemplarOutputMode]);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    count: number;
    onConfirm: () => void;
  } | null>(null);
  const threeDToolUnit = s.threeDTool === "point-mask" ? "point_mask_3d" : "lidar_box_3d";
  // 视频: 按当前 videoTool 解析其工具单位 (矩形框→bbox / 多边形→region / 折线→polyline),
  // 让每个几何取各自单位的类别/属性 (对齐图片, 不再共用 bbox)。select 回退默认解析。
  const videoOverrideUnit =
    currentProject?.type_key === "video-track"
      ? (videoToolUnit(s.videoTool) ?? undefined)
      : undefined;
  const toolView = useToolBindings(
    currentProject ?? null,
    s.tool,
    is3DProject ? threeDToolUnit : videoOverrideUnit,
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
  // 视频工具可用性谓词: 按几何单位 (bbox/region/polyline) 的 enabled + 单帧/轨迹子开关判定。
  // 对齐图片工作台 —— 每个几何独立单位, 未启用单位则对应工具灰置。
  const isVideoToolEnabled = useCallback(
    (t: VideoTool) => videoToolEnabled(t, currentProject?.tool_bindings),
    [currentProject?.tool_bindings],
  );
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
  // v0.21.4 · 视频单题 AI(当前帧→图像 backend)是同步 fetch(非 triggerPreannotation mutation),
  // 单独一个运行态并入 aiRunning, 供 popover 转圈 + 防重复点击。
  const [videoFrameAiRunning, setVideoFrameAiRunning] = useState(false);
  // v0.16.x 第 3 批 · AI 浮层位置/尺寸(+localStorage 持久化)抽到 useAiPopoverFrame;
  // 开关 aiPopoverOpen 因切 task 时被关闭(与任务流纠缠)留壳层。
  const { aiPopoverPosition, setAiPopoverPosition, aiPopoverSize, setAiPopoverSize } =
    useAiPopoverFrame();
  const {
    trackerPanelPosition,
    setTrackerPanelPosition,
    trackerPanelSize,
    setTrackerPanelSize,
  } = useVideoTrackerPanelFrame();
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
  const imageMediaKey = task?.dataset_item_id ?? task?.id ?? null;
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
  // v0.21.13 · 章节 × 时间轴刷选联动。chapterDraftArmed: 侧栏「时间轴圈选」臂选态; 臂选时
  // 时间轴普通拖即圈选 chapter-draft。chapterDraft: 刷选产物 (松手后一次性喂给侧栏预填表单)。
  const [chapterDraftArmed, setChapterDraftArmed] = useState(false);
  const [chapterDraft, setChapterDraft] = useState<{ startFrame: number; endFrame: number } | null>(null);
  // v0.21.13 WS4 · 时间轴章节条 ↔ 侧栏行双向 hover 联动的共享态。
  const [hoveredChapterId, setHoveredChapterId] = useState<string | null>(null);
  // v0.21.16 WS3 · 轨迹多选态镜像 (由 roster 的 VideoTrackSidebar 经 onSelectionChange 上报),
  // 供浮卡在多选 ≥2 轨迹时渲染批量卡。roster 仍是唯一 owner, 此处只读镜像, 不双写。
  const [videoBatchTracks, setVideoBatchTracks] = useState<VideoTrackAnnotation[]>([]);
  // v0.21.14 WS3 · AI 传播对话框打开时上报的影响范围 (时间轴高亮「将影响哪段帧」)。
  const [propagateHighlight, setPropagateHighlight] = useState<
    { startFrame: number; endFrame: number } | null
  >(null);
  // v0.21.14 · 传播对话框打开时时间轴 Shift+拖刷选回填的范围 (每次刷选替换新对象喂给对话框)。
  const [propagateBrush, setPropagateBrush] = useState<
    { startFrame: number; endFrame: number } | null
  >(null);
  const handleTimelineRangeSelect = useCallback(
    (purpose: TimelineRangePurpose, region: VideoLoopRegion) => {
      if (purpose === "chapter-draft") {
        setChapterDraft({ startFrame: region.startFrame, endFrame: region.endFrame });
        setChapterDraftArmed(false);
      } else if (purpose === "propagate-range") {
        // 传播对话框开着时刷选 → 回填对话框的自定义范围 (每次新对象, 对话框按引用触发)。
        setPropagateBrush({ startFrame: region.startFrame, endFrame: region.endFrame });
      }
    },
    [],
  );
  // v0.21.13 WS3 · 章节条 resize: 松手才落库, 短 debounce 合并快速连续调整, PATCH 只带起止帧。
  const updateChapterMutation = useUpdateVideoChapter(isVideoTask ? videoDatasetItemId : null);
  // 按 chapterId 分槽维护 debounce timer: 单槽会让「200ms 内连续 resize 不同章节」时,
  // 前一章节的 PATCH 被后一次 clearTimeout 无声取消 → 落库前被 refetch 回滚、调整丢失。
  const chapterResizeDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const handleResizeChapter = useCallback(
    (chapterId: string, region: VideoLoopRegion) => {
      const timers = chapterResizeDebounceRef.current;
      const existing = timers.get(chapterId);
      if (existing) clearTimeout(existing);
      timers.set(
        chapterId,
        setTimeout(() => {
          timers.delete(chapterId);
          updateChapterMutation.mutate({
            chapterId,
            payload: { start_frame: region.startFrame, end_frame: region.endFrame },
          });
        }, 200),
      );
    },
    [updateChapterMutation],
  );
  useEffect(() => {
    const timers = chapterResizeDebounceRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);
  // v0.21.27 · U-pvs-1 · PVS 点种子采集态 (完整接线见传播对话框处)。此处先声明, 因下方
  // 「工具未启用即回收」守卫需读它: 采集态借 smart-point 落点, 不受回收。
  // 多目标: 每点带 obj (目标序号, 1-based; obj=1 为主实例, 回填选中轨迹, obj≥2 各成新轨迹);
  // seedObj = 当前正在落点的目标, 「新目标」递增。可视化仍复用 overlay ({pt,polarity})。
  // v0.21.27 · U-pvs-2 纠偏: 每点还带 frame (落点时的帧), 提交按 obj+frame 分组成多帧
  // prompts; seedAnchorFrame = 首个落点帧, 传播范围锚定于此 (导航到别帧加修正点不移动范围)。
  const [trackerSeeds, setTrackerSeeds] = useState<
    { pt: [number, number]; polarity: 1 | 0; obj: number; frame: number }[]
  >([]);
  // v0.21.27 · 框修正 · PVS 框种子 (点种子的姊妹): 归一化 xyxy + obj + frame。与点种子一起
  // 按 obj→frame 分组成 prompts (每帧可同时带 points 与 bbox), 供 SAM2 式 add_new_points_or_box。
  const [trackerSeedBoxes, setTrackerSeedBoxes] = useState<
    { bbox: [number, number, number, number]; obj: number; frame: number }[]
  >([]);
  // 落点/画框模式: point → smart-point 落点, box → smart-box 画修正框。
  const [seedMode, setSeedMode] = useState<"point" | "box">("point");
  const [seedObj, setSeedObj] = useState(1);
  const [seedAnchorFrame, setSeedAnchorFrame] = useState<number | null>(null);
  const [seedCollecting, setSeedCollecting] = useState(false);
  const seedPrevToolRef = useRef<VideoTool | null>(null);
  // 当前创建工具被 video_modes 过滤掉时, 回到选择工具；平移不再是 fallback 工具。
  // v0.21.27 · U-pvs-1 · PVS 种子采集态会临时把工具切到 smart-point (画布 samProbe 只看
  // 工具值、不看 enablement), 此时不受本守卫回收 —— 否则未绑交互工具的项目落不了种子。
  useEffect(() => {
    if (!isVideoTask || seedCollecting) return;
    if (videoTool !== "select" && !isVideoToolEnabled(videoTool)) setVideoTool("select");
  }, [isVideoTask, seedCollecting, isVideoToolEnabled, videoTool, setVideoTool]);
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

  const trackerJobs = useVideoTrackerJobs(taskId, isVideoTask);
  const [propagateDialog, setPropagateDialog] = useState<{
    // v0.22.1 · B · annotation 为 null = 无源检测 (画布级入口发起, 不绑选中轨迹)。
    annotation: TrackerSourceAnnotation | null;
    // v0.22.2 · M2 · 多选批量: ≥2 条源轨迹一次延展 (单 job 多源, 后端 annotation_id 存 NULL →
    // 走 job 级审阅)。多源时 annotation 置 null, sources 持全列表; 单源/无源时 sources 省略。
    sources?: TrackerSourceAnnotation[];
    submitting: boolean;
    // v0.22.2 · U8 · 提交成功后置入建成的 tracker job id: 对话框就地转「追踪中…」进行态,
    // 追踪进度读该 job (jobs[jobId]); 结果就绪 (候选) / 失败时由 effect 关闭对话框复位。
    jobId?: string;
  } | null>(null);
  // v0.21.27 · U-pvs-1 · PVS 点种子采集接线 (state 已在上方声明): 用户在传播对话框点
  // 「落点选目标」进入采集态, 画布点击落归一化种子点 (复用 smart-point 手势 →
  // onVideoSamPrompt), 提交时进 prompt.seeds。seedPrevToolRef 记录进入前的工具, 退出时
  // 仅在真进过采集态时复原 (避免误改工具)。
  const startSeedCollecting = useCallback(() => {
    seedPrevToolRef.current = s.videoTool;
    setVideoTool(seedMode === "box" ? "smart-box" : "smart-point");
    setSeedCollecting(true);
  }, [s.videoTool, setVideoTool, seedMode]);
  // 点/框模式切换: 采集中即时切工具 (smart-point ↔ smart-box), 未采集只记模式。
  const changeSeedMode = useCallback(
    (mode: "point" | "box") => {
      setSeedMode(mode);
      if (seedCollecting) setVideoTool(mode === "box" ? "smart-box" : "smart-point");
    },
    [seedCollecting, setVideoTool],
  );
  const stopSeedCollecting = useCallback(() => {
    if (seedPrevToolRef.current !== null) {
      setVideoTool(seedPrevToolRef.current);
      seedPrevToolRef.current = null;
    }
    setSeedCollecting(false);
  }, [setVideoTool]);
  const toggleSeedCollecting = useCallback(() => {
    if (seedCollecting) stopSeedCollecting();
    else startSeedCollecting();
  }, [seedCollecting, startSeedCollecting, stopSeedCollecting]);
  // 「新目标」: 当前目标已落 ≥1 点或框才递增 (不建空目标), 后续点/框归入下一目标。
  const newSeedTarget = useCallback(() => {
    const hasSeed =
      trackerSeeds.some((s) => s.obj === seedObj) ||
      trackerSeedBoxes.some((b) => b.obj === seedObj);
    if (hasSeed) setSeedObj(seedObj + 1);
  }, [trackerSeeds, trackerSeedBoxes, seedObj]);

  const openPropagateDialog = useCallback(
    (source: TrackerSourceAnnotation | TrackerSourceAnnotation[] | null) => {
      // AI 单题与 AI 追踪共用顶部工具组；打开追踪时先收起单题面板，避免两个浮层叠加。
      setAiPopoverOpen(false);
      // v0.22.2 · M2 · 归一化: null=无源, 单条=单源延展, ≥2 条=多选批量 (单 job 多源)。
      const list = Array.isArray(source) ? source : source ? [source] : [];
      setPropagateDialog({
        annotation: list.length === 1 ? list[0] : null,
        sources: list.length >= 2 ? list : undefined,
        submitting: false,
      });
      setPropagateBrush(null);
      setTrackerSeeds([]);
      setTrackerSeedBoxes([]);
      setSeedObj(1);
      setSeedMode("point");
      setSeedAnchorFrame(null);
      setSeedCollecting(false);
      seedPrevToolRef.current = null;
    },
    [],
  );
  const closePropagateDialog = useCallback(() => {
    setPropagateDialog(null);
    setTrackerSeeds([]);
    setTrackerSeedBoxes([]);
    setSeedObj(1);
    setSeedAnchorFrame(null);
    stopSeedCollecting();
  }, [stopSeedCollecting]);
  const togglePropagateDialog = useCallback(() => {
    if (propagateDialog) {
      closePropagateDialog();
      return;
    }
    openPropagateDialog(null);
  }, [closePropagateDialog, openPropagateDialog, propagateDialog]);
  const toggleAiPopover = useCallback(() => {
    if (aiPopoverOpen) {
      setAiPopoverOpen(false);
      return;
    }
    closePropagateDialog();
    setAiPopoverOpen(true);
  }, [aiPopoverOpen, closePropagateDialog]);
  // v0.22.2 · U8 · 提交成功后不立即关闭对话框, 而就地转「追踪中…」进行态 (保留对话框显示进度,
  // 让位审阅条前给即时反馈)。清掉种子采集态 (与关闭同款), 但保留对话框记录并挂上 job id。
  const enterTrackingProgress = useCallback(
    (jobId: string) => {
      setTrackerSeeds([]);
      setTrackerSeedBoxes([]);
      setSeedObj(1);
      setSeedAnchorFrame(null);
      stopSeedCollecting();
      setPropagateDialog((prev) => (prev ? { ...prev, submitting: false, jobId } : prev));
    },
    [stopSeedCollecting],
  );

  const handlePropagateSubmit = useCallback(
    async (payload: Parameters<typeof trackerJobs.propagate>[2]) => {
      if (!propagateDialog || !taskId) return;
      setPropagateDialog((prev) => (prev ? { ...prev, submitting: true } : prev));
      try {
        // v0.21.27 · U-pvs-1/2 · 有落点则注入 prompt.seeds: 按 obj → frame 双层分组成多帧
        // prompts (obj_id=目标序号; prompts=[{frame_index, points:[[x,y,label],...]}], 正点
        // label=1 / Alt 负点 label=0)。obj=1 主实例回填选中轨迹, obj≥2 各成新轨迹; 同一 obj
        // 在多帧落点 = 纠偏 (原始帧 + 修正帧累积)。单帧时退化为一条 prompt。runner 只在种子窗
        // 透传, 多目标跨窗由 runner 逐实例续种; backend PVS 优先 seeds[] 于 source_geometry。
        // v0.21.27 · 框修正 · 每 (obj, frame) 的 prompt 可同时带 points 与 bbox。点来自
        // trackerSeeds, 框来自 trackerSeedBoxes (归一化 xyxy → 后端要的 {x,y,w,h})。
        type SeedEntry = { points: [number, number, number][]; bbox?: Record<string, number> };
        const byObj = new Map<number, Map<number, SeedEntry>>();
        const ensureEntry = (obj: number, frame: number): SeedEntry => {
          const byFrame = byObj.get(obj) ?? new Map<number, SeedEntry>();
          const entry = byFrame.get(frame) ?? { points: [] };
          byFrame.set(frame, entry);
          byObj.set(obj, byFrame);
          return entry;
        };
        for (const { pt, polarity, obj, frame } of trackerSeeds) {
          ensureEntry(obj, frame).points.push([pt[0], pt[1], polarity]);
        }
        for (const { bbox, obj, frame } of trackerSeedBoxes) {
          const [x1, y1, x2, y2] = bbox;
          ensureEntry(obj, frame).bbox = {
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            w: Math.abs(x2 - x1),
            h: Math.abs(y2 - y1),
          };
        }
        const hasSeeds = trackerSeeds.length > 0 || trackerSeedBoxes.length > 0;
        const withSeeds = hasSeeds
          ? {
              ...payload,
              prompt: {
                ...(payload.prompt ?? {}),
                seeds: [...byObj.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([obj, byFrame]) => ({
                    obj_id: obj,
                    prompts: [...byFrame.entries()]
                      .sort((a, b) => a[0] - b[0])
                      .map(([frame, entry]) => ({
                        frame_index: frame,
                        ...(entry.points.length ? { points: entry.points } : {}),
                        ...(entry.bbox ? { bbox: entry.bbox } : {}),
                      })),
                  })),
              },
            }
          : payload;
        // v0.22.2 · M2 · 多选批量 (≥2 源) → 任务级 track 带 source_annotation_ids, 后端逐源
        // 读当前帧几何构 seeds, 一个 job 各回填各自源 (annotation_id 存 NULL, 走 job 级审阅)。
        const batchSources = propagateDialog.sources;
        const job = batchSources && batchSources.length >= 2
          ? await trackerJobs.track(taskId, {
              ...withSeeds,
              source_annotation_ids: batchSources.map((sd) => sd.id),
            })
          : propagateDialog.annotation
          ? await trackerJobs.propagate(taskId, propagateDialog.annotation.id, withSeeds)
          : // v0.22.1 · B · 无源检测: 走任务级 track (payload 已含 target_class_name)。
            await trackerJobs.track(taskId, withSeeds);
        // v0.22.2 · U8 · 就地转进行态: 不立即关闭, 挂上 job id 让对话框显示「追踪中…」,
        // 直到结果就绪 (候选) / 失败时由 effect 复位关闭。
        enterTrackingProgress(job.id);
      } catch (e) {
        setPropagateDialog((prev) => (prev ? { ...prev, submitting: false } : prev));
        throw e;
      }
    },
    [propagateDialog, taskId, trackerJobs, trackerSeeds, trackerSeedBoxes, enterTrackingProgress],
  );

  // v0.22.2 · U8 · 进行态收尾: 对话框挂着的 job 出候选 (结果就绪待审) → 关闭对话框, 让位顶部
  // 居中的审阅条 (二者同位, 避免叠); job 失败 / 已被终态清理移除 → 同样收起复位。运行中则保持
  // 「追踪中…」。仅依赖 job id + candidates/jobs 引用, 进度 (windowProgress) 变化不触发关闭。
  const trackingJobId = propagateDialog?.jobId ?? null;
  useEffect(() => {
    if (!trackingJobId) return;
    const candidateReady = Boolean(trackerJobs.candidates[trackingJobId]);
    const job = trackerJobs.jobs[trackingJobId];
    if (candidateReady || !job || job.status === "failed") {
      closePropagateDialog();
    }
  }, [trackingJobId, trackerJobs.candidates, trackerJobs.jobs, closePropagateDialog]);

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
    // pendingCrossFrameSelectRef 是 usePredictionPropagation 返回的稳定 useRef(声明在
    // 本 effect 下方,入依赖会 TDZ);ref 引用恒定不入依赖,行为与抽取前一致。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // v0.20.22 · 「提交在途」几何 override 桥, 防松手时因 onMutate 微任务回填缓存
  // 晚一帧于 setDrag(null) 而出现的原尺寸闪回。详见 usePendingGeom 注释。
  const { pendingGeomMap, markPendingGeom, clearPendingGeom } = usePendingGeom(annotationsData);
  const [hideOrphanAnnotations, setHideOrphanAnnotations] = useState(false);
  // v0.20.19 · 二次推理面板显隐 (服务端偏好, 跨设备); gate SecondaryInferenceBar 渲染。
  const { hidden: secondaryBarHidden, setHidden: setSecondaryBarHidden } =
    useSecondaryBarHiddenPref();
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
    // 同上:pendingCrossFrameSelectRef 为稳定 useRef,不入依赖(入则 TDZ),行为不变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsData, currentTaskId, setSelectedId]);

  // Data Manager 带 ?focus=/?track=/?frame= 深链进入工作台时一次性生效;成功 hydrate 后置位,
  // 避免之后每次 annotation refetch(annotationsData 引用变化)重跑下方 effect 把用户已改选的
  // 帧/标注强行拉回 URL 值。
  const urlFocusHydratedRef = useRef(false);

  useEffect(() => {
    if (urlFocusHydratedRef.current) return;
    if (!taskId || (requestedTaskId && taskId !== requestedTaskId)) return;
    if (isVideoTask && requestedFrameIndex !== null) {
      const maxFrame = Math.max(0, videoFrameCount - 1);
      setVideoFrameIndex(Math.min(requestedFrameIndex, maxFrame));
    }
    if (!requestedFocusId && !requestedTrackId) {
      urlFocusHydratedRef.current = true;
      return;
    }
    const target = (annotationsData ?? []).find(
      (annotation) =>
        annotation.id === requestedFocusId
        || (requestedTrackId && annotation.track_id === requestedTrackId),
    );
    if (target) {
      setSelectedId(target.id);
      urlFocusHydratedRef.current = true;
    }
  }, [
    annotationsData,
    isVideoTask,
    requestedFocusId,
    requestedFrameIndex,
    requestedTaskId,
    requestedTrackId,
    setSelectedId,
    setVideoFrameIndex,
    taskId,
    videoFrameCount,
  ]);

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
      if (!sel || (!isVideoTrack(sel) && !isVideoMaskTrack(sel))) return;
      e.preventDefault();
      openPropagateDialog(sel);
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
  const updateAnnotationMut = useUpdateAnnotation(
    taskId,
    (...args) => conflictCbRef.current(...args),
    clearPendingGeom,
  );
  const bulkUpdateMut = useAnnotationBulkUpdate(taskId ?? "");

  const {
    issueCreateOpen,
    setIssueCreateOpen,
    issuePinDropArmed,
    setIssuePinDropArmed,
    issuePinPrefill,
    setIssuePinPrefill,
    issueListParams,
    issuesQuery,
    openIssueCount,
    activeIssueHighlightId,
    highlightIssueFromPin,
    requestIssuesTab,
  } = useIssuePins({ projectId, taskId, stageGeom, setVp, setVideoFrameIndex, isVideoTask });
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
  // 邻帧 task。导航胶水 navigateToCrossFrameTask 留此处(绑 tasks/selectTask/updateUrl),
  // 竞态簇(3 ref + 4 回调)抽到 usePredictionPropagation,见本文件下方 hook 调用。
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
  // v0.16.x 第 3 批 · 跨帧传播竞态簇(3 ref + 4 回调)抽到 usePredictionPropagation;
  // pendingCrossFrameSelectRef 返回供上方两处 effect(切 task 清理 522 / 导航后补选 651)读写。
  const {
    pendingCrossFrameSelectRef,
    crossFramePropagate,
    crossFramePropagateBatch,
    crossFramePropagateToTask,
    crossFrameInterpolate,
  } = usePredictionPropagation({
    taskId,
    selectedId: s.selectedId,
    navigateToCrossFrameTask,
    pushToast,
    queryClient,
  });

  // v0.14.18 · 交互线能力路由: 对每个注册后端拉 /setup 建 capIndex, 按当前工具 prompt 解析交互后端。
  // v0.18.31 · 交互后端选择的服务端持久化偏好 (按 project, 跨设备; 替代旧 localStorage)。
  const interactiveBackendPref = useInteractiveBackendPref(projectId);
  const routing = useBackendRouting({
    projectId,
    backends,
    defaultBackendId: currentProject?.ml_backend_id ?? null,
    savedInteractiveBackendId: interactiveBackendPref.savedBackendId ?? null,
    onSaveInteractiveBackend: interactiveBackendPref.save,
  });
  // v0.21.25 (阶段 R) · tracker 可用性看「项目所有 reachable backend 的 supported_trackers 并集」,
  // 而非单个绑定/交互 backend——否则项目绑 grounded-sam2 时, sam3-backend 声明的 sam3_video 永远
  // 被灰置「未绑定后端」。与后端 get_tracker_backend 的按能力路由对齐。
  const allSupportedTrackers = useMemo(() => {
    const set = new Set<string>();
    for (const entry of Object.values(routing.capIndex)) {
      if (entry.reachable) for (const t of entry.trackers) set.add(t);
    }
    return [...set];
  }, [routing.capIndex]);
  // v0.21.23 · 当前激活的 AI 工具。视频侧按 videoTool 解析 —— smart-point / smart-box 与图片
  // 工具同名, 共用 TOOL_REGISTRY, 故交互 prompt 解析与工具上下文浮块可直接复用图片侧那套。
  const activeAiTool = (isVideoTask ? s.videoTool : s.tool) as ToolId;
  // 当前工具对应的交互 prompt (非交互工具回落 point, 仅用于 sam/warmup 的后端选取, 不参与门控)。
  const activeInteractivePrompt = promptOfTool(activeAiTool);
  const interactiveBackendId = routing.resolveInteractive(activeInteractivePrompt ?? "point");

  // v0.21.4 起视频单题 AI 用它抓当前帧; v0.21.23 交互式 SAM 复用同一取帧口。
  const videoControlsRef = useRef<VideoStageControls | null>(null);

  // v0.21.23 · 视频交互式 SAM 的投递方式: 视频 task 的 file_path 是整段 mp4, 服务端取不到帧,
  // 故把当前帧解成 JPEG 走 multipart。图片 task 传 undefined → hook 用默认 transport。
  const samTransport = useMemo<InteractiveTransport | undefined>(() => {
    if (!isVideoTask) return undefined;
    return async ({ projectId: pid, mlBackendId: bid, taskId: tid, context, signal }) => {
      const blob = await videoControlsRef.current?.captureCurrentFrameJpeg();
      if (!blob) throw new Error("当前帧尚未就绪，请等待画面加载完成后重试");
      return mlBackendsApi.interactiveAnnotateFrame(
        pid,
        bid,
        { blob, taskId: tid, frameIndex: videoFrameIndex, context },
        signal,
      );
    };
  }, [isVideoTask, videoFrameIndex]);

  const sam = useInteractiveAI({
    projectId,
    taskId,
    mlBackendId: interactiveBackendId,
    transport: samTransport,
    // 候选缓存 / 点会话按帧隔离; 切帧即失效 (mask_input 的 logits 绑定具体图像)。
    cacheScope: isVideoTask ? videoFrameIndex : undefined,
  });

  // v0.21.23 · 画布 samProbe 松手 → 请求候选 (坐标已归一化 [0,1])。
  const onVideoSamPrompt = useCallback(
    (prompt: VideoSamPrompt) => {
      // v0.21.27 · U-pvs-1 · PVS 种子采集态: point 收进种子列表 (不跑帧级 SAM)。仅由传播
      // 对话框「落点选目标」显式开启; 正点 polarity=1 / Alt 负点 polarity=0 (精修召回)。
      // 点归属当前目标 seedObj (「新目标」递增 → 多目标各成一条轨迹) + 当前帧 (纠偏: 导航到
      // 别帧落修正点, 提交按 frame 分组成多帧 prompts)。首个落点帧设为范围锚点。
      if (seedCollecting && prompt.mode === "point") {
        const frame = s.videoFrameIndex;
        setSeedAnchorFrame((a) => (a === null ? frame : a));
        setTrackerSeeds((prev) => [
          ...prev,
          { pt: prompt.pt, polarity: prompt.alt ? 0 : 1, obj: seedObj, frame },
        ]);
        return;
      }
      // v0.21.27 · 框修正 · 采集态画框 (smart-box) → 收进框种子列表, 不跑帧级 SAM。
      if (seedCollecting && prompt.mode === "bbox") {
        const frame = s.videoFrameIndex;
        setSeedAnchorFrame((a) => (a === null ? frame : a));
        setTrackerSeedBoxes((prev) => [
          ...prev,
          { bbox: prompt.bbox, obj: seedObj, frame },
        ]);
        return;
      }
      if (prompt.mode === "point") return sam.runPoint(prompt.pt, prompt.alt ? 0 : 1);
      // exemplar: alt = 负框 (排误检) / 否则正框 (扩召回); 会话每次重发全量框。
      if (prompt.mode === "exemplar") {
        return sam.runExemplar(prompt.bbox, prompt.alt ? 0 : 1, s.exemplarOutputMode);
      }
      sam.runBbox(prompt.bbox);
    },
    [sam, s.exemplarOutputMode, seedCollecting, seedObj, s.videoFrameIndex],
  );
  // v0.18.25 · 引擎(模型)选择的服务端持久化偏好 (User.preferences.ai.model_by_backend, 跨设备);
  // 作"默认之前的回落"注入 useMLCapabilities, 用户本会话显式选择仍盖过它。
  const modelPref = useAiToolModelPref(interactiveBackendId);
  // 交互工具栏的能力/模型反映"解析到的交互后端"; 门控 (isPromptSupported) 走 routing 并集。
  const mlCapabilities = useMLCapabilities(
    projectId ?? null,
    interactiveBackendId,
    modelPref.savedModelId ?? null,
  );
  // v0.14.9 · active model 输出几何 / 文本属性 与项目配置的兼容性警告 (非阻断)。
  const capabilityWarnings = useCapabilityValidation({
    activeModel: mlCapabilities.activeModel,
    enabledToolUnits,
    toolBindings: currentProject?.tool_bindings,
  });
  // v0.18.26 · 交互工具档位(模型权重)选择: 源自交互后端 activeModel 的 variant 轴, 选择写回
  // 项目级 default_variants (与批量预标注同源; 一项目一后端一份偏好, 交互/批量共用同一档位)。
  const updateProjectMu = useUpdateProject(projectId ?? "");
  const interactiveVariantGroups = mlCapabilities.activeModel?.supported_variants;
  const interactiveVariantCombos = mlCapabilities.activeModel?.variant_combinations;
  const interactiveProjectVariantSlice = useMemo<Record<string, string>>(
    () =>
      interactiveBackendId
        ? currentProject?.default_variants?.[interactiveBackendId] ?? {}
        : {},
    [currentProject?.default_variants, interactiveBackendId],
  );
  // 请求实际下发的档位: backend 自报默认 + 项目偏好覆盖 (缺轴回落 backend 默认)。
  const interactiveVariantSlice = useMemo<Record<string, string>>(
    () => ({
      ...(mlCapabilities.activeModel?.default_variants ?? {}),
      ...interactiveProjectVariantSlice,
    }),
    [mlCapabilities.activeModel, interactiveProjectVariantSlice],
  );
  const handleInteractiveVariantChange = useCallback(
    (next: Record<string, unknown>) => {
      if (!interactiveBackendId) return;
      const axisKeys = (interactiveVariantGroups ?? [])
        .map((g) => g.key)
        .filter((k): k is string => typeof k === "string");
      if (axisKeys.length === 0) return;
      const slice: Record<string, string> = {};
      for (const k of axisKeys) {
        const v = next[k];
        if (typeof v === "string") slice[k] = v;
      }
      const merged: Record<string, Record<string, string>> = {
        ...(currentProject?.default_variants ?? {}),
        [interactiveBackendId]: slice,
      };
      updateProjectMu.mutate({ default_variants: merged });
    },
    [interactiveBackendId, interactiveVariantGroups, currentProject?.default_variants, updateProjectMu],
  );
  // v0.20.2 · 「采纳后该属性将丢失」警告的一键补全: 把 active model 自报的属性字段 (warning.fillable)
  // 补进项目「所有启用工具单位」的 attribute_schema.fields (同 key 覆盖、新 key 追加), 立即落库。
  // 写项目配置是有副作用操作, 故先 window.confirm 确认 (plan 风险项)。补完后 enabledToolUnits 派生
  // 收敛, useCapabilityValidation 重算, 该条警告自动消失。
  // v0.20.12 · 抽出批量核心, 供单框二次推理 (SecondaryInferenceBar) 一次补多字段复用。
  const applyAttributeFields = useCallback(
    (fields: AttributeField[], confirmMsg: string) => {
      if (fields.length === 0) return;
      const tb = currentProject?.tool_bindings;
      if (!tb) return;
      const enabledUnits = (Object.keys(tb) as ToolUnitId[]).filter((u) => tb[u]?.enabled);
      if (enabledUnits.length === 0) {
        pushToast({ msg: "当前项目没有启用的工具单位, 无法补全属性", kind: "warning" });
        return;
      }
      if (!window.confirm(confirmMsg)) return;
      // 仅改启用单位的 attribute_schema; 其余单位 (禁用/未配) 原样保留, 避免误丢配置。
      const nextTb: ToolBindings = {};
      for (const [unit, binding] of Object.entries(tb) as [ToolUnitId, ToolBinding][]) {
        if (!binding) continue;
        if (!binding.enabled) {
          nextTb[unit] = binding;
          continue;
        }
        const merged = ((binding.attribute_schema?.fields ?? []) as AttributeField[]).slice();
        for (const field of fields) {
          const idx = merged.findIndex((f) => f.key === field.key);
          if (idx >= 0) merged[idx] = field;
          else merged.push(field);
        }
        nextTb[unit] = { ...binding, attribute_schema: { fields: merged } };
      }
      updateProjectMu.mutate(
        { tool_bindings: nextTb },
        {
          onSuccess: () =>
            pushToast({ msg: `已补全 ${fields.length} 个属性字段到项目`, kind: "success" }),
          onError: (err) =>
            pushToast({ msg: "补全属性失败", sub: (err as Error).message, kind: "error" }),
        },
      );
    },
    [currentProject?.tool_bindings, updateProjectMu, pushToast],
  );
  const handleFillAttribute = useCallback(
    (field: AttributeField) =>
      applyAttributeFields(
        [field],
        `将把属性「${field.label}」(key=${field.key}) 补进当前项目所有启用工具单位, 并立即保存。继续?`,
      ),
    [applyAttributeFields],
  );
  // v0.20.12 · 二次推理: 一次把多个缺失属性字段补进项目 (SecondaryInferenceBar 用)。
  const handleEnsureAttributeFields = useCallback(
    (fields: AttributeField[]) =>
      applyAttributeFields(
        fields,
        `将把 ${fields.length} 个属性字段 (${fields
          .map((f) => f.key)
          .join(", ")}) 补进当前项目所有启用工具单位, 并立即保存。继续?`,
      ),
    [applyAttributeFields],
  );
  // v0.20.12 · 项目所有启用单位已有的属性键集合 (二次推理判定 backend 输出键是否有承接位)。
  const projectAttributeKeys = useMemo(() => {
    const tb = currentProject?.tool_bindings;
    const keys = new Set<string>();
    if (tb) {
      for (const b of Object.values(tb) as (ToolBinding | undefined)[]) {
        if (b?.enabled) {
          for (const f of (b.attribute_schema?.fields ?? []) as AttributeField[]) {
            if (f.key) keys.add(f.key);
          }
        }
      }
    }
    return keys;
  }, [currentProject?.tool_bindings]);
  // AI"配置区"共享状态 (任务类型 / 模型任务 / 类别白名单 / variant / 参数 / 输出形态 / buildArgs);
  // 与批量页 ProjectDetailPanel 同一 hook + PreannotateConfigForm (单一事实源). 驱动批量 AI 面板
  // (运行当前题 AI) — 批量线, 用 batchBackendId.
  const preCfg = usePreannotateConfig({
    projectId: projectId ?? "",
    backendId: batchBackendId,
    // v0.21.10 · 工作台「当前题 AI」面板恒做**单帧检测**(方案 a): 传 executionUnit="frame" 放开
    //   图像检测模型 (GEOMETRIC_TASKS), 而非整段 tracker——单帧发 detection → /predict-frame →
    //   to_video_bbox_result 落 video_bbox。整段追踪走 Ctrl+B 种子追踪 / 批量页 (execution_unit=video)。
    //   (图像项目 isVideoProject=false, 此参数无副作用。)
    executionUnit: "frame",
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
  // v0.18.x · 工具切换按 prompt 种类变化取消交互会话: AI↔AI (如 point→exemplar) 与 AI↔非AI
  // 切换都会改变 prompt 种类, 一并清掉上一个工具残留的 ghost 点位 overlay / stale mask_input
  // (见 issue 0004; promptOfTool 对非 AI / text 工具返回 null)。同 prompt 种类切换不清 (会话兼容)。
  const prevToolPromptRef = useRef(promptOfTool(s.tool));
  useEffect(() => {
    const nextPrompt = promptOfTool(s.tool);
    const changed = prevToolPromptRef.current !== nextPrompt;
    prevToolPromptRef.current = nextPrompt;
    if (changed) sam.cancel();
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
      s.setTool("select");
      pushToast({
        msg: "当前后端不支持此 AI 工具",
        sub: "已切回选择工具；请到项目设置注册支持该交互的后端",
        kind: "warning",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routingSig, routing.isLoading, s.tool]);
  useEffect(() => {
    if (!isVideoTask) return;
    if (tool !== "box" && tool !== "select") setTool("box");
  }, [isVideoTask, tool, setTool]);

  const {
    conflictOpen,
    setConflictOpen,
    handleConflictReload,
    handleConflictOverwrite,
  } = useConflictResolution(conflictCbRef, queryClient, taskId);

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

  const aiRunning = preannotationProgress?.status === "running" || triggerPreannotation.isPending || videoFrameAiRunning;

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
    // v0.20.22 · accept undo 防御过滤依赖 (改动 1.5): annotationsRef 已含全量当前标注,
    // undo 时按 id 查 parent_prediction_id, 只删本 predictionId 派生的那批。
    getAnnotation: (id) => annotationsRef.current.find((a) => a.id === id) ?? null,
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
  const maskEditorSize = resolveMaskEditorSize(
    isVideoTask,
    stageGeom,
    videoManifest.data?.metadata,
  );
  const maskEditor = useMaskEditor(maskEditorSize);

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
    markPendingGeom,
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
    handleBatchPatchFlag,
    handleJoinSelectedPolygons,
    handleCropSelectedPolygons,
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

  // v0.21.0 · 项目默认命名编排成为 popover「按项目编排」来源; 旧 preannotate_pipeline 仅作读兼容兜底。
  // popover 仍是执行器、不是编排编辑器: 编排在 /ai-pre 定义保存, 这里只把那条编排跑当前一图。
  const projectPipeline = useMemo(
    () => selectProjectPipelineStages(
      projectPipelinesQ.data,
      currentProject?.preannotate_pipeline,
    ),
    [projectPipelinesQ.data, currentProject?.preannotate_pipeline],
  );
  const hasProjectPipeline = (projectPipeline?.length ?? 0) > 0;
  const projectPipelineStageCount = projectPipeline?.length ?? 0;
  // claude[bot] P1 #5 · 编排引用的 backend 被删/停时, popover 入口该不可点 + 弹明确原因, 而非默默 422。
  // 复用上面已拉的 backends 列表 (line ~199 backendsQ), 不重复 query。
  const availableBackendIds = useMemo(
    () => new Set<string>(backends.map((b) => b.id)),
    [backends],
  );
  const pipelineMissingBackends = useMemo(
    () => missingBackendIdsForStages(projectPipeline, availableBackendIds),
    [projectPipeline, availableBackendIds],
  );
  const projectPipelineRunnable =
    hasProjectPipeline && pipelineMissingBackends.length === 0;
  const handleRunAiPipeline = useCallback(() => {
    if (pipelineMissingBackends.length > 0) {
      pushToast({
        msg: "项目编排引用的后端不可用",
        sub: `请到「AI 预标」修编排或重新注册 ${pipelineMissingBackends.length} 个后端`,
        kind: "warning",
      });
      return;
    }
    const payload = buildPipelineRunPayload(
      projectPipeline,
      taskId,
      availableBackendIds,
    );
    if (!payload) return;
    pushToast({
      msg: "AI 正在按项目编排分析...",
      sub: `${payload.pipeline_stages?.length ?? 0} 阶段`,
    });
    triggerPreannotation.mutate(payload, {
      onSuccess: () => preCfg.markHot(),
      onError: (err: unknown) =>
        pushToast({ msg: "AI 编排预标失败", sub: String(err), kind: "error" }),
    });
  }, [
    projectPipeline,
    taskId,
    triggerPreannotation,
    pushToast,
    preCfg,
    availableBackendIds,
    pipelineMissingBackends,
  ]);

  const {
    handleVideoCreate,
    handleVideoCreateWithClass,
    handleVideoPointsTrackCreate,
    handleVideoPointsCreate,
    handleVideoPointsCreateWithClass,
    handleVideoPendingDraw,
    handlePickVideoPendingClass,
    handleVideoUpdate,
    handleVideoMaskCommit,
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

  const selectedVideoMask = useMemo(() => {
    const annotation = visibleAnnotationsData.find((item) => item.id === s.selectedId);
    return annotation && isVideoMaskTrack(annotation) ? annotation : null;
  }, [s.selectedId, visibleAnnotationsData]);
  const selectedVideoMaskFingerprint = selectedVideoMask
    ? `${selectedVideoMask.id}:${selectedVideoMask.version ?? 0}:${selectedVideoMask.updated_at ?? ""}:${s.videoFrameIndex}`
    : "";
  const maskInitFromRle = maskEditor.initFromRle;
  const maskBeginBlank = maskEditor.beginBlank;
  const maskCancel = maskEditor.cancel;
  useEffect(() => {
    if (!isVideoTask) return;
    if (s.videoTool !== "mask") {
      maskCancel();
      return;
    }
    if (!selectedVideoMask) {
      maskCancel();
      return;
    }
    let cancelled = false;
    void rasterMasksApi.annotationContent(selectedVideoMask.id, s.videoFrameIndex)
      .then((rle) => {
        if (!cancelled) maskInitFromRle(rle);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          maskBeginBlank();
          return;
        }
        maskCancel();
        pushToast({ msg: "Mask 内容加载失败", sub: String(error), kind: "error" });
      });
    return () => { cancelled = true; };
  }, [isVideoTask, maskBeginBlank, maskCancel, maskInitFromRle, pushToast, s.videoFrameIndex, s.videoTool, selectedVideoMask, selectedVideoMaskFingerprint]);

  const cancelVideoMaskEdit = useCallback(() => {
    maskEditor.cancel();
    s.setVideoTool("select");
  }, [maskEditor, s]);
  const commitVideoMask = useCallback(() => {
    const rle = maskEditor.commitToRle();
    if (!rle || !maskEditor.buffer || maskEditor.buffer.countSet() === 0) {
      pushToast({ msg: "Mask 为空，未提交", kind: "warning" });
      return;
    }
    void handleVideoMaskCommit(rle, s.videoFrameIndex, selectedVideoMask)
      .then(() => {
        maskEditor.cancel();
        s.setVideoTool("select");
      })
      .catch((error: unknown) => {
        pushToast({ msg: "Mask 保存失败", sub: String(error), kind: "error" });
      });
  }, [handleVideoMaskCommit, maskEditor, pushToast, s, selectedVideoMask]);

  // v0.21.23 · 视频交互式 SAM 候选键位: Enter 采纳 / Esc 取消 / Tab 切候选 (与图片侧同键位)。
  // Enter 不直接落库, 而是弹类选择器 —— 与图片侧 samPendingAccept 一致。视频侧的 popover 走
  // fixed anchor (图片侧走 geom + vp 换算), 故需画布把候选外接框底边换算成屏幕坐标。
  const [videoSamPendingAccept, setVideoSamPendingAccept] = useState<
    { idx: number; anchor: { left: number; top: number } } | null
  >(null);

  useEffect(() => {
    if (!isVideoTask) return;
    // magic-box 不参与候选导航 (单候选, 自动弹 popover) —— 与图片侧一致。
    if (!isSamCandidateNavTool(s.videoTool)) return;
    if (sam.candidates.length === 0) return;
    // popover 打开时让位: 键盘归它 (Esc 关 popover, Enter 选类)。
    if (videoSamPendingAccept) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") return;
      e.preventDefault();
      // stopImmediatePropagation 而非 stopPropagation: 两个 handler 都挂在 window 的捕获阶段,
      // stopPropagation 只拦跨节点传播, 拦不住同一 window 上后注册的 useWorkbenchHotkeys ——
      // 否则视频侧 Tab 会在切候选的同时又触发「同类下一个」的选中循环。
      e.stopImmediatePropagation();
      if (e.key === "Enter") {
        const idx = sam.activeIdx;
        const geom = samCandidateGeom(sam.candidates[idx]);
        if (!geom) return;
        // 锚到候选外接框底边中点下方, 与手绘 box 的 onPendingDraw 同式。
        const pt = videoControlsRef.current?.normToClient({ x: geom.x, y: geom.y + geom.h });
        setVideoSamPendingAccept({ idx, anchor: { left: pt?.left ?? 0, top: (pt?.top ?? 0) + 6 } });
        return;
      }
      if (e.key === "Escape") {
        sam.cancel();
        return;
      }
      sam.cycle(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isVideoTask, s.videoTool, sam, videoSamPendingAccept]);

  // magic-box: 候选一到就自动弹类选择器 (无需 Enter), 选定类别后收紧成外接框 —— 与图片侧同式。
  useEffect(() => {
    if (!isVideoTask || s.videoTool !== "magic-box") return;
    if (sam.isRunning || sam.candidates.length === 0 || videoSamPendingAccept) return;
    const geom = samCandidateGeom(sam.candidates[0]);
    if (!geom) return;
    const pt = videoControlsRef.current?.normToClient({ x: geom.x, y: geom.y + geom.h });
    setVideoSamPendingAccept({ idx: 0, anchor: { left: pt?.left ?? 0, top: (pt?.top ?? 0) + 6 } });
  }, [isVideoTask, s.videoTool, sam.isRunning, sam.candidates, videoSamPendingAccept]);

  // 候选被清空 / 切工具 / 切帧 → popover 一并收起, 避免它悬在一个已不存在的候选上。
  useEffect(() => {
    if (videoSamPendingAccept && !sam.candidates[videoSamPendingAccept.idx]) {
      setVideoSamPendingAccept(null);
    }
  }, [sam.candidates, videoSamPendingAccept]);

  // 选定类别 → 按候选几何分流落库 (与图片侧 handleSamCommitClass 一致)。
  // consume 对 point/bbox 清空整个会话, 对 exemplar 只移除被采纳的那条 (多实例, 可继续采纳)。
  const handleVideoSamCommitClass = useCallback((cls: string) => {
    const pending = videoSamPendingAccept;
    if (!pending) return;
    setVideoSamPendingAccept(null);
    const c = sam.candidates[pending.idx];
    if (!c) return;
    // magic-box: 不论候选形态一律收紧成紧凑外接矩形落 video_bbox, 并结束整个会话 (单候选)。
    if (s.videoTool === "magic-box") {
      const tight = c.type === "rectanglelabels" && c.bbox
        ? { x: c.bbox.x, y: c.bbox.y, w: c.bbox.width, h: c.bbox.height }
        : c.points && c.points.length >= 3
        ? tightenBboxFromPolygon(c.points)
        : null;
      sam.cancel();
      if (tight) handleVideoCreateWithClass("video_bbox", s.videoFrameIndex, tight, cls);
      return;
    }
    if (c.type === "rectanglelabels" && c.bbox) {
      handleVideoCreateWithClass("video_bbox", s.videoFrameIndex, {
        x: c.bbox.x, y: c.bbox.y, w: c.bbox.width, h: c.bbox.height,
      }, cls);
    } else if (c.points && c.points.length >= 3) {
      handleVideoPointsCreateWithClass("video_polygon", s.videoFrameIndex, c.points, cls);
    }
    sam.consume(pending.idx);
  }, [videoSamPendingAccept, sam, s.videoTool, s.videoFrameIndex, handleVideoCreateWithClass, handleVideoPointsCreateWithClass]);

  const handleVideoSamCancelClass = useCallback(() => {
    setVideoSamPendingAccept(null);
    // magic-box 只有单个候选: 取消 = 放弃整个会话, 否则 effect 会立刻把 popover 再弹出来。
    if (s.videoTool === "magic-box") sam.cancel();
  }, [s.videoTool, sam]);

  // popover 定位用的候选外接框 (归一化)。
  const videoSamPendingGeom = useMemo(() => {
    if (!videoSamPendingAccept) return null;
    return samCandidateGeom(sam.candidates[videoSamPendingAccept.idx]);
  }, [videoSamPendingAccept, sam.candidates]);

  // 候选自带的模型类别若在项目类别里则作默认值, 否则回落当前类 (与图片侧 samDefaultClass 一致)。
  const videoSamDefaultClass = useMemo(() => {
    const label = videoSamPendingAccept ? sam.candidates[videoSamPendingAccept.idx]?.label : undefined;
    return label && classes.includes(label) ? label : s.activeClass;
  }, [videoSamPendingAccept, sam.candidates, classes, s.activeClass]);

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


  // v0.21.4 · 视频单题 AI: 抓当前帧 JPEG → 图像 backend(client 供图路径)→ 落单帧 video_bbox 候选。
  // 与图像的 handleRunAi 走不同路(那条投 task_id 让后端从 task URL 取图, 视频 task URL 是整段 mp4)。
  const handleRunVideoFrameAi = useCallback(async () => {
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
    const blob = await videoControlsRef.current?.captureCurrentFrameJpeg();
    if (!blob) {
      pushToast({
        msg: "当前帧尚未就绪",
        sub: "请等待画面加载完成后重试",
        kind: "warning",
      });
      return;
    }
    setVideoFrameAiRunning(true);
    pushToast({ msg: "AI 正在分析当前帧...", sub: aiModel });
    try {
      const res = await mlBackendsApi.predictFrame(projectId, mlBackendId, {
        blob,
        taskId: taskId!,
        frameIndex: videoFrameIndex,
        config: args as unknown as Record<string, unknown>,
      });
      preCfg.markHot();
      await queryClient.invalidateQueries({ queryKey: ["predictions", taskId] });
      pushToast({
        msg: "当前帧分析完成",
        sub: `第 ${videoFrameIndex} 帧新增 ${res.candidate_count} 个候选`,
        kind: "success",
      });
    } catch (err) {
      pushToast({ msg: "AI 预标注失败", sub: String(err), kind: "error" });
    } finally {
      setVideoFrameAiRunning(false);
    }
  }, [projectId, batchBackendId, preCfg, aiModel, taskId, videoFrameIndex, queryClient, pushToast]);

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
  // v0.21.13 · 章节 × 时间轴联动控制器 (状态/handler 声明在前, 此处 isLocked 就绪后组装并 gate 编辑)。
  const canEditChapters = !isLocked && isOwner;
  const videoTimelineChapterControls = useMemo<VideoTimelineChapterControls | undefined>(() => {
    if (!isVideoTask) return undefined;
    // 传播对话框开着时优先臂选 propagate-range (Shift+拖回填对话框); 否则章节圈选 / loop。
    const rangeSelectPurpose = propagateDialog
      ? "propagate-range"
      : chapterDraftArmed
        ? "chapter-draft"
        : "loop";
    return {
      rangeSelectPurpose,
      onRangeSelect: handleTimelineRangeSelect,
      onResizeChapter: canEditChapters ? handleResizeChapter : undefined,
      hoveredChapterId,
      onHoverChapter: setHoveredChapterId,
    };
  }, [
    isVideoTask,
    propagateDialog,
    chapterDraftArmed,
    handleTimelineRangeSelect,
    canEditChapters,
    handleResizeChapter,
    hoveredChapterId,
  ]);
  const isSubmittingTask = topbarActions.isSubmitting ?? submitTaskMut.isPending;

  // v0.16.14 · 选中 AI 预测框反查:预测与普通框共用 s.selectedId,但预测 id 带 pred- 前缀且
  // 只在 aiBoxes(非 visibleAnnotationsData)里,故 selectedAnnotationForPanel 必为 null。
  // diff 模式 final 时无预测可选(aiBoxes 已被上游置空逻辑覆盖)→ 不命中 AI 分支。
  const selectedAiBox = useMemo(() => {
    if (!s.selectedId?.startsWith("pred-") || modeState.diffMode === "final") return null;
    return aiBoxes.find((b) => b.id === s.selectedId) ?? null;
  }, [s.selectedId, modeState.diffMode, aiBoxes]);

  const selectionSourceKind = useMemo<PetSelectionSourceKind>(() => {
    if (selectedAiBox) return "prediction";
    const ann = selectedAnnotationForPanel;
    if (!ann) return "unknown";
    if (isVideoTask) {
      if (isVideoTrack(ann)) {
        return resolveTrackAtFrame(ann.geometry, s.videoFrameIndex)?.source ?? "legacy";
      }
      if (isVideoBbox(ann)) return "legacy";
    }
    if (ann.source === "prediction_based" || ann.parent_prediction_id) return "prediction";
    return "manual";
  }, [isVideoTask, s.videoFrameIndex, selectedAiBox, selectedAnnotationForPanel]);

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

  // v0.13.4 · 3D 工作台自管这些字母键(V/B 选/放、W/E/R gizmo 模式),交给它的本地
  // keydown 处理;否则全局 2D 热键会抢 —— 尤其 E=「提交质检」(dispatchKey → submit)会被
  // 误触发:用户按 E 想转 gizmo,却把任务直接提交了。Ctrl+方向(切题)/?/Esc 等全局键仍保留。
  // v0.13.8 · Delete/Backspace 也归 3D 本地处理:全局 dispatchKey 通路在 3D 台实测不触发删除,
  // 改由 3D 工作台显式监听删选中框,口径与 W/E/R / B/V 一致。
  const threeDOwnedKeys = useMemo(
    () => new Set(["b", "B", "p", "P", "v", "V", "w", "W", "e", "E", "r", "R", "Delete", "Backspace"]),
    [],
  );

  const { spacePan, markSpacePanDrag, nudgeMap } = useWorkbenchHotkeys({
    s, history, classes, currentProject, annotationsRef,
    batchChanging, setBatchChanging, showHotkeys,
    navigateTask, smartNext, setFitTick,
    onCrossFramePropagate: crossFramePropagate,
    recordRecentClass, handleDeleteBox, handleBatchDelete, handlePatchShapeFlag,
    handleStartChangeClass, handleStartBatchChangeClass,
    handleSubmitTask, handleAcceptPrediction, handleRejectPrediction, handleUpdateAttributes,
    handleVideoSetSelectedClass,
    aiBoxes, autoAdvanceOnDecide: s.workbenchConfig.common.autoAdvanceOnDecide,
    setShowHotkeys, clipboard, pushToast, stageGeom,
    polygonDraftPoints, setPolygonDraftPoints, submitPolygon, submitPolyline,
    updateMutation: { mutate: (vars) => updateAnnotationMut.mutate(vars) },
    taskId,
    ignoredKeys: stageKind === "3d" ? threeDOwnedKeys : undefined,
    videoMode: isVideoTask,
    samplingActive,
    videoControlsRef,
    isPromptSupported: routing.isPromptSupported,
    aiInteractiveEnabled: currentProject?.ai_interactive_enabled,
    maskEditor,
    commitMaskAsPolygon,
    cancelMaskEdit,
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
  const {
    leftPx,
    rightPx,
    onResizeLeft,
    onResizeRight,
    sidebarMinPx,
    sidebarMaxPx,
    sidebarResetPx,
  } = useWorkbenchSidebarSizing(leftPct, rightPct, setWorkbenchFields);
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

  // v0.16.14 · 卡内采纳 / 忽略后清掉选中:预测被消费后 pred- id 已失效,否则卡会回落到
  // 「已选中 1 个标注」占位死角。仅在卡入口处理选中态,不动 handleAccept/Reject 业务逻辑。
  const acceptPredictionFromCard = useCallback(
    (box: Parameters<typeof handleAcceptPrediction>[0]) => {
      handleAcceptPrediction(box);
      s.setSelectedId(null);
    },
    [handleAcceptPrediction, s],
  );
  const rejectPredictionFromCard = useCallback(
    (box: Parameters<typeof handleRejectPrediction>[0]) => {
      handleRejectPrediction(box);
      s.setSelectedId(null);
    },
    [handleRejectPrediction, s],
  );

  // v0.16.8 Phase 3 · 视频轨迹面板的共享构建器:右栏(VideoTrackSidebar + 章节)与选中浮动卡
  // 复用同一份 props/回调,杜绝两套逻辑漂移。frameFilter 控制「全部 / 当前帧」轨迹过滤。
  const renderVideoTrackSidebar = useCallback(
    (frameFilter: TrackFilter, view: "roster" | "card" = "roster") => (
      <VideoTrackSidebar
        annotations={visibleAnnotationsData}
        selectedId={s.selectedId}
        selectedIds={s.selectedIds}
        frameIndex={s.videoFrameIndex}
        userId={meUserId ?? null}
        trackFilter={frameFilter}
        view={view}
        fps={videoFps}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        readOnly={isLocked}
        hiddenTrackIds={s.hiddenVideoTrackIds}
        lockedTrackIds={s.lockedVideoTrackIds}
        classes={classes}
        onSelect={(id) => handleSelectBox(id)}
        onToggleHiddenTrack={s.toggleHiddenVideoTrack}
        onToggleLockedTrack={s.toggleLockedVideoTrack}
        onSeekFrame={s.setVideoFrameIndex}
        reviewDisplayMode={mode === "review" ? modeState.diffMode : undefined}
        trackSectionCollapsed={s.trackSectionCollapsed}
        onToggleTrackSection={() => s.setTrackSectionCollapsed(!s.trackSectionCollapsed)}
        onChangeUserBoxClass={handleStartChangeClass}
        onRenameTracks={handleVideoBatchRename}
        onDeleteTracks={handleVideoBatchDelete}
        onUpdate={handleVideoUpdate}
        onConvertToBboxes={handleVideoConvertToBboxes}
        onComposeTracks={handleVideoComposeTracks}
        onSelectionChange={view === "roster" ? setVideoBatchTracks : undefined}
        trackerJobsByAnnotation={trackerJobs.byAnnotation}
        onPropagateTrack={openPropagateDialog}
        onBatchTrack={(annotations) => openPropagateDialog(annotations as TrackerSourceAnnotation[])}
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
      currentProject?.rendering_config?.propagateOverwrite, videoFps, imageWidth, imageHeight,
      s.trackSectionCollapsed, s.setTrackSectionCollapsed,
    ],
  );

  // 图片 / 视频选中即现(3D 用自有 PSR 面板,不显示)。单选 = 类别标题 + 内容;
  // 多选 = 「N 个已选中 · 批量」精简态;无选中 = null(隐藏)。
  // 图片单选注入真实内容(改类 / 锁 / 隐藏 / 删除 / 几何 / 属性);视频单选搬入完整轨迹面板。
  const selectionCardEligible = stageKind === "image" || stageKind === "video";
  const selectedIds = s.selectedIds;
  const selectionCount = selectedIds.length;
  // v0.22.2 · U7 · AI 追踪对话框 (顶部居中悬浮工具条) 打开时, 让右侧选中卡收起让位, 避免与
  // 工具条视觉相撞。仅强制渲染折叠态 (经 OR 叠加, 不改用户持久化的 collapsed 偏好): 对话框
  // 关闭后自动复位到用户偏好, 无需额外记忆。
  const trackerDialogOpen = Boolean(propagateDialog);
  const selectionCard = useMemo<SelectedAnnotationCardProps | null>(() => {
    if (!selectionCardEligible || selectionCount < 1) return null;
    const multi = selectionCount > 1;
    const ann = selectedAnnotationForPanel;
    const title = multi
      ? `${selectionCount} 个已选中 · 批量`
      : selectedAiBox?.cls ?? ann?.class_name ?? "选中标注";
    let children: ReactNode;
    if (multi && stageKind === "image") {
      // 图片多选:批量操作(改类 / 合并 / 锁定 / 隐藏 / 删除)收进浮卡,取代退役的贴框浮条。
      const selectedAnns = userBoxes.filter((b) => selectedIds.includes(b.id));
      const allLocked = selectedAnns.length > 0 && selectedAnns.every((a) => a.is_locked);
      const allHidden = selectedAnns.length > 0 && selectedAnns.every((a) => a.is_hidden);
      children = (
        <ImageBatchCardContent
          count={selectionCount}
          readOnly={isLocked}
          allLocked={allLocked}
          allHidden={allHidden}
          onChangeClass={handleStartBatchChangeClass}
          onJoin={handleJoinSelectedPolygons}
          onToggleLock={() => handleBatchPatchFlag("is_locked")}
          onToggleHidden={() => handleBatchPatchFlag("is_hidden")}
          onDelete={handleBatchDelete}
          onClear={() => setSelectedId(null)}
        />
      );
    } else if (multi && stageKind === "video") {
      // 视频多选:单帧框(video_bbox)走 selectedIds,给批量卡(改类 / 锁 / 隐藏 / 删除 + 聚合为轨迹);
      // 轨迹多选走右栏 roster 的 selectedTrackIds,不进 selectedIds,浮卡保持精简占位。
      const selectedAnns = visibleAnnotationsData.filter((a) => selectedIds.includes(a.id));
      const allVideoBbox = selectedAnns.length > 0 && selectedAnns.every((a) => a.geometry.type === "video_bbox");
      if (allVideoBbox) {
        const allLocked = selectedAnns.every((a) => a.is_locked);
        const allHidden = selectedAnns.every((a) => a.is_hidden);
        children = (
          <VideoBoxBatchCardContent
            count={selectionCount}
            readOnly={isLocked}
            allLocked={allLocked}
            allHidden={allHidden}
            onChangeClass={handleStartBatchChangeClass}
            onToggleLock={() => handleBatchPatchFlag("is_locked")}
            onToggleHidden={() => handleBatchPatchFlag("is_hidden")}
            onDelete={handleBatchDelete}
            onAggregate={() => handleVideoComposeTracks({
              operation: "aggregate_bboxes",
              annotationIds: selectedIds,
              deleteSources: true,
            })}
            onClear={() => setSelectedId(null)}
          />
        );
      } else {
        children = <SelectionCardPlaceholder summary={`已选中 ${selectionCount} 个标注。`} />;
      }
    } else if (multi) {
      children = <SelectionCardPlaceholder summary={`已选中 ${selectionCount} 个标注。`} />;
    } else if (selectedAiBox) {
      // AI 预测分支(图片端专属):置信度条 + 来源/候选序号 + 采纳/精修/忽略,直连模型既有 handler。
      children = (
        <AIPredictionCardContent
          box={selectedAiBox}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          attributeSchema={toolView.attributeSchema}
          readOnly={isLocked}
          onAccept={acceptPredictionFromCard}
          onReject={rejectPredictionFromCard}
          onRefine={handleRefinePrediction}
        />
      );
    } else if (stageKind === "video") {
      if (ann && isAnyVideoSingleFrame(ann)) {
        // 视频单帧标注 (bbox / polygon / polyline / rotated_bbox):不属任何轨迹、会被轨迹面板
        // 过滤掉,改用专属单帧卡(帧定位 + 指标 + 属性)。v0.21.26 起覆盖全部单帧几何。
        children = (
          <VideoFrameBoxCardContent
            annotation={ann}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            fps={videoFps}
            attributeSchema={toolView.attributeSchema}
            readOnly={isLocked}
            onSeekFrame={setVideoFrameIndex}
            onChangeClass={handleStartChangeClass}
            onDelete={handleDeleteBox}
            onUpdateAttributes={handleUpdateAttributes}
          />
        );
      } else if (ann && (isVideoPointsTrack(ann) || isVideoMaskTrack(ann))) {
        // v0.21.26 · 点集轨迹 (polygon / polyline track):简化卡(指标 + 改类 / 显隐 / 锁 / 删整条),
        // 取代此前空白卡。完整关键帧编辑仍归 v0.21.20 多几何 track epic,不复用 bbox 轨迹卡。
        children = (
          <VideoPointsTrackCardContent
            annotation={ann}
            frameIndex={videoFrameIndex}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            fps={videoFps}
            readOnly={isLocked}
            hidden={s.hiddenVideoTrackIds.has(ann.geometry.track_id)}
            locked={s.lockedVideoTrackIds.has(ann.geometry.track_id)}
            onSeekFrame={setVideoFrameIndex}
            onChangeClass={handleStartChangeClass}
            onDelete={handleDeleteBox}
            onToggleHidden={s.toggleHiddenVideoTrack}
            onToggleLock={s.toggleLockedVideoTrack}
            onEditMask={isVideoMaskTrack(ann) ? () => s.setVideoTool("mask") : undefined}
            onPropagate={isVideoMaskTrack(ann) ? () => openPropagateDialog(ann) : undefined}
          />
        );
      } else if (videoBatchTracks.length >= 2) {
        // v0.21.16 WS3 · 多选 ≥2 条轨迹 → 浮卡渲染批量卡 (与右栏 roster 批量条对等), 不再退化为
        // 「最后选中那条」的单卡。选择态由 roster 实例上报的 videoBatchTracks 镜像驱动。
        const ids = videoBatchTracks.map((t) => t.id);
        const sameClass =
          videoBatchTracks.length === 2 && videoBatchTracks[0].class_name === videoBatchTracks[1].class_name;
        const canMerge = sameClass;
        const canJoin = sameClass && !trackRangesOverlap(videoBatchTracks[0], videoBatchTracks[1]);
        const countHint = `需恰好选中 2 条轨迹（当前 ${videoBatchTracks.length} 条）`;
        const mergeReason = canMerge ? null : videoBatchTracks.length !== 2 ? countHint : "两条轨迹需同类";
        const joinReason = canJoin
          ? null
          : videoBatchTracks.length !== 2
            ? countHint
            : !sameClass
              ? "两条轨迹需同类"
              : "两条轨迹的可见帧区间不能重叠";
        const setBatchHidden = (hidden: boolean) =>
          videoBatchTracks.forEach((t) => {
            if (s.hiddenVideoTrackIds.has(t.geometry.track_id) !== hidden) s.toggleHiddenVideoTrack(t.geometry.track_id);
          });
        const setBatchLocked = (locked: boolean) =>
          videoBatchTracks.forEach((t) => {
            if (s.lockedVideoTrackIds.has(t.geometry.track_id) !== locked) s.toggleLockedVideoTrack(t.geometry.track_id);
          });
        // 全选中才算「已隐藏 / 已锁定」→ 切换按钮翻转为反向动作; 部分选中时仍显示正向动作(与图片侧一致)。
        const allTracksHidden = videoBatchTracks.every((t) => s.hiddenVideoTrackIds.has(t.geometry.track_id));
        const allTracksLocked = videoBatchTracks.every((t) => s.lockedVideoTrackIds.has(t.geometry.track_id));
        children = (
          <VideoTrackBatchCardContent
            count={videoBatchTracks.length}
            readOnly={isLocked}
            classes={classes}
            canMerge={canMerge}
            canJoin={canJoin}
            mergeDisabledReason={mergeReason}
            joinDisabledReason={joinReason}
            allHidden={allTracksHidden}
            allLocked={allTracksLocked}
            onChangeClass={(cls) => handleVideoBatchRename(videoBatchTracks, cls)}
            onBatchTrack={
              isLocked
                ? undefined
                : () => openPropagateDialog(videoBatchTracks as TrackerSourceAnnotation[])
            }
            onToggleHidden={() => setBatchHidden(!allTracksHidden)}
            onToggleLock={() => setBatchLocked(!allTracksLocked)}
            onMerge={() => handleVideoComposeTracks({ operation: "merge_tracks", annotationIds: ids })}
            onJoin={(gapMode: VideoTrackGapMode) =>
              handleVideoComposeTracks({ operation: "join_tracks", annotationIds: ids, gapMode })
            }
            onDelete={() => {
              if (window.confirm(`确定删除 ${videoBatchTracks.length} 条轨迹？`)) handleVideoBatchDelete(videoBatchTracks);
            }}
            onClear={() => handleSelectBox(null)}
          />
        );
      } else if (ann && isVideoTrack(ann)) {
        // 视频 bbox 轨迹:单轨迹两层信息卡(轨迹整体 + 当前帧 + 关键帧表/导航 + 属性),
        // 共享同一构建器/回调;轨迹清单与多选批量留在右栏 roster。
        children = renderVideoTrackSidebar("current", "card");
      } else {
        // v0.21.26 · 兜底:未被上面任何分支覆盖的视频几何也给占位摘要 (类别 + type),
        // 不再落到 renderVideoTrackSidebar 的 null 空卡。
        children = (
          <SelectionCardPlaceholder
            summary={ann ? `类别 ${ann.class_name} · ${ann.geometry.type}` : "已选中 1 个标注。"}
          />
        );
      }
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
      // v0.22.2 · U7 · 追踪对话框打开时强制折叠让位 (OR 叠加, 不动持久化偏好)。
      collapsed: floatingSelection.collapsed || trackerDialogOpen,
      onCollapse: collapseSelectionCard,
      onExpand: expandSelectionCard,
      // v0.20.19 · 二次推理面板显隐 toggle 仅图片任务 (二次推理条本就图片限定)。
      secondaryBarHidden,
      onToggleSecondaryBar:
        stageKind === "image"
          ? () => setSecondaryBarHidden(!secondaryBarHidden)
          : undefined,
      children,
    };
  }, [
    selectionCardEligible,
    secondaryBarHidden,
    setSecondaryBarHidden,
    selectionCount,
    selectedAnnotationForPanel,
    selectedAiBox,
    stageKind,
    imageWidth,
    imageHeight,
    videoFps,
    videoFrameIndex,
    setVideoFrameIndex,
    toolView.attributeSchema,
    isLocked,
    userBoxes,
    visibleAnnotationsData,
    selectedIds,
    setSelectedId,
    handleStartBatchChangeClass,
    handleJoinSelectedPolygons,
    handleBatchPatchFlag,
    handleBatchDelete,
    handleVideoComposeTracks,
    handleVideoBatchRename,
    handleVideoBatchDelete,
    handleSelectBox,
    videoBatchTracks,
    classes,
    s.hiddenVideoTrackIds,
    s.lockedVideoTrackIds,
    s.toggleHiddenVideoTrack,
    s.toggleLockedVideoTrack,
    s.setVideoTool,
    openPropagateDialog,
    handleStartChangeClass,
    handlePatchShapeFlag,
    handleDeleteBox,
    handleUpdateAttributes,
    acceptPredictionFromCard,
    rejectPredictionFromCard,
    handleRefinePrediction,
    renderVideoTrackSidebar,
    floatingSelectionPosition,
    onSelectionPositionChange,
    floatingSelection.collapsed,
    trackerDialogOpen,
    collapseSelectionCard,
    expandSelectionCard,
  ]);

  const selectedAnnotationsForPet = useMemo(
    () => visibleAnnotationsData.filter((ann) => selectedIds.includes(ann.id)),
    [selectedIds, visibleAnnotationsData],
  );
  const selectedRequiredMissingCount = useMemo(() => {
    const schema = toolView.attributeSchema;
    if (!schema || (schema.fields ?? []).length === 0) return 0;
    let count = 0;
    for (const ann of selectedAnnotationsForPet) {
      count += getMissingRequired(schema, ann.class_name, ann.attributes ?? {}).length;
    }
    return count;
  }, [selectedAnnotationsForPet, toolView.attributeSchema]);
  const selectedHasLockedOrHidden = useMemo(
    () => selectedAnnotationsForPet.some((ann) => ann.is_locked || ann.is_hidden),
    [selectedAnnotationsForPet],
  );
  const petQuality = useMemo<WorkbenchPetContext["quality"]>(() => {
    const warnings: string[] = [];
    if (selectedAiBox) warnings.push("候选待确认");
    if (selectedRequiredMissingCount > 0) warnings.push("必填属性未填");
    if (selectionCount > 1 && selectedHasLockedOrHidden) warnings.push("多选含锁定/隐藏");
    if (selectionSourceKind === "interpolated") warnings.push("插值帧");
    if (isVideoTask && selectionSourceKind === "prediction" && !selectedAiBox) warnings.push("预测来源");
    return {
      warningCount: warnings.length,
      primaryWarning: warnings[0] ?? null,
    };
  }, [
    selectedAiBox,
    selectedHasLockedOrHidden,
    selectedRequiredMissingCount,
    isVideoTask,
    selectionCount,
    selectionSourceKind,
  ]);
  const petCandidateCount = (modeState.diffMode !== "final" ? aiBoxes.length : 0) + sam.candidates.length;
  const petContext = useMemo<WorkbenchPetContext>(() => ({
    selection: {
      count: selectionCount,
      title: selectionCard?.title ?? null,
      collapsed: selectionCard?.collapsed ?? false,
      sourceKind: selectionSourceKind,
    },
    ai: {
      running: aiRunning || sam.isRunning,
      candidateCount: petCandidateCount,
      backendOnline: undefined,
    },
    workflow: {
      saving: isSubmittingTask || bulkUpdateMut.isPending,
      offline: !online,
      offlineQueueCount: queueCount,
      readOnly: isLocked,
      reviewMode: mode === "review",
    },
    quality: petQuality,
    counts: {
      annotationCount: annotationsData?.length ?? 0,
    },
  }), [
    aiRunning,
    annotationsData?.length,
    bulkUpdateMut.isPending,
    isLocked,
    isSubmittingTask,
    mode,
    online,
    petCandidateCount,
    petQuality,
    queueCount,
    sam.isRunning,
    selectionCard?.collapsed,
    selectionCard?.title,
    selectionCount,
    selectionSourceKind,
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
  // v0.22.2 · M2 · 多选批量源列表 (≥2 时对话框转多源叙事; 非无源)。
  const propagateSources = propagateDialog?.sources ?? null;
  const propagateMultiSource = (propagateSources?.length ?? 0) >= 2;
  // v0.21.27 · 框修正 · 是否多目标 (跨点种子与框种子统计 distinct obj); 决定 overlay 是否逐目标配色。
  const seedMultiObj =
    new Set([
      ...trackerSeeds.map((sd) => sd.obj),
      ...trackerSeedBoxes.map((sb) => sb.obj),
    ]).size > 1;

  // v0.21.28 · 候选/接受: 本任务的待审候选 (candidates 按 jobId, 用 jobs[jobId].taskId 过滤)。
  // 普通计算 (非 hook): 位于早返回之后, 且计算便宜。
  const trackerReviewEntry =
    Object.entries(trackerJobs.candidates).find(
      ([jobId]) => trackerJobs.jobs[jobId]?.taskId === taskId,
    ) ?? null;
  const trackerReviewCandidate = trackerReviewEntry
    ? { jobId: trackerReviewEntry[0], preview: trackerReviewEntry[1] }
    : null;
  const trackerReviewMultiObj = trackerReviewCandidate
    ? new Set(trackerReviewCandidate.preview.results.map((r) => r.instance_id ?? "1")).size > 1
    : false;
  // 候选当前帧的框 (bbox 几何) → overlay 预览 (复用 samSessionBoxes 通道, 多目标逐 obj 配色)。
  const candidateBoxesThisFrame: { bbox: [number, number, number, number]; obj?: number }[] =
    trackerReviewCandidate
      ? trackerReviewCandidate.preview.results
          .filter(
            (r) =>
              r.frame_index === s.videoFrameIndex &&
              !r.outside &&
              (r.geometry as { type?: string } | null)?.type === "bbox",
          )
          .map((r) => {
            const g = r.geometry as { x: number; y: number; w: number; h: number };
            return {
              bbox: [g.x, g.y, g.x + g.w, g.y + g.h] as [number, number, number, number],
              obj: trackerReviewMultiObj ? instanceObjNumber(r.instance_id) : undefined,
            };
          })
      : [];
  const candidateMasksThisFrame = trackerReviewCandidate
    ? trackerReviewCandidate.preview.results
        .filter(
          (result) => result.frame_index === s.videoFrameIndex
            && !result.outside
            && result.geometry.type === "mask",
        )
        .map((result) => ({ jobId: trackerReviewCandidate.jobId, result }))
    : [];
  const propagateDialogNextKeyframe = propagateDialogTrack
    ? [...propagateDialogTrack.geometry.keyframes]
        .map((kf) => kf.frame_index)
        .filter((idx) => idx > s.videoFrameIndex)
        .sort((a, b) => a - b)[0] ?? null
    : null;
  const propagateDialogPrevKeyframe = propagateDialogTrack
    ? [...propagateDialogTrack.geometry.keyframes]
        .map((kf) => kf.frame_index)
        .filter((idx) => idx < s.videoFrameIndex)
        .sort((a, b) => b - a)[0] ?? null
    : null;

  // v0.21.10 · 「当前题 AI」header 待审数: 视频按**当前帧**过滤 (与下方候选列表口径一致), 图像取全部。
  //   aiBoxes 已在源头按 id 去重 (见 useImageAnnotationActions), 故此处只做帧作用域, 消除跨帧+分页
  //   漂移导致的 100→500→100 抖动。
  const aiPopoverBoxCount = modeState.diffMode === "final"
    ? 0
    : isVideoTask
      ? aiBoxes.filter((b) => aiBoxOnFrame(b, s.videoFrameIndex)).length
      : aiBoxes.length;

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
      onSetTool: s.setTool,
      videoTool: s.videoTool, onSetVideoTool: s.setVideoTool,
      isPromptSupported: routing.isPromptSupported,
      capabilitiesLoading: routing.isLoading,
      reviewMode: mode === "review", videoMode: isVideoTask,
      enabledToolUnits,
      aiInteractiveEnabled: currentProject?.ai_interactive_enabled,
      isVideoToolEnabled,
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
      isSubmitting: isSubmittingTask, confThreshold: s.confThreshold,
      onShowHotkeys: () => setShowHotkeys(true),
      onBack,
      leftSidebarOpen: leftOpen,
      rightSidebarOpen: rightOpen,
      onToggleLeftSidebar: toggleLeftSidebar,
      onToggleRightSidebar: toggleRightSidebar,
      onRunAi: toggleAiPopover,
      aiOpen: aiPopoverOpen,
      // v0.21.4 · 视频项目也开放当前题 AI(单帧 → 图像 backend), 不再禁用工具栏 AI 按钮。
      aiDisabled: false,
      onToggleTracker: isVideoTask ? togglePropagateDialog : undefined,
      trackerOpen: Boolean(propagateDialog),
      trackerRunning: Boolean(trackingJobId),
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
            {(isVideoTask ? s.videoTool === "mask" : s.tool === "mask") && (
              <MaskToolbar
                active={maskEditor.active}
                mode={maskEditor.mode}
                radius={maskEditor.radius}
                dirty={maskEditor.dirty}
                onSetMode={maskEditor.setMode}
                onSetRadius={maskEditor.setRadius}
                onCommit={isVideoTask ? commitVideoMask : commitMaskAsPolygon}
                onCancel={isVideoTask ? cancelVideoMaskEdit : cancelMaskEdit}
              />
            )}
            {/* v0.18.25 · 交互工具上下文浮块 (前 AIToolDrawer): 选中 AI 工具时浮在画布顶部居中,
                与 MaskToolbar 互斥 (mask 非 AI 工具)。引擎选择经 modelPref 服务端持久化。
                v0.21.27 · U-pvs-1 · PVS 种子采集态借用 smart-point 工具落点, 此时抑制本工具条
                (否则与顶部居中的传播对话框撞位); 采集是「落 PVS 种子」而非帧级 SAM 分割。 */}
            {isAIToolId(activeAiTool) && !seedCollecting && (
              <InteractiveToolBar
                tool={activeAiTool}
                backendName={mlCapabilities.capability?.name}
                capability={mlCapabilities.capability}
                samPolarity={s.samPolarity}
                onSetSamPolarity={s.setSamPolarity}
                isLoading={mlCapabilities.isLoading}
                isError={mlCapabilities.isError}
                exemplarOutputMode={s.exemplarOutputMode}
                onSetExemplarOutputMode={(mode) => {
                  // 切输出形态时若 exemplar 会话进行中, 用当前会话重跑 (output 透传)。
                  handleSetExemplarOutputMode(mode);
                  sam.rerunExemplar(mode);
                }}
                exemplarText={sam.exemplarText}
                onSetExemplarText={sam.setExemplarText}
                exemplarThreshold={sam.exemplarThreshold}
                onSetExemplarThreshold={sam.setExemplarThreshold}
                exemplarThresholdDefault={
                  ((): number | undefined => {
                    const def = (
                      mlCapabilities.paramsSchema?.properties?.score_threshold as
                        | { default?: unknown }
                        | undefined
                    )?.default;
                    return typeof def === "number" ? def : undefined;
                  })()
                }
                exemplarSessionActive={sam.sessionExemplars.length > 0}
                models={mlCapabilities.models}
                activeModelId={mlCapabilities.activeModelId}
                onSetActiveModelId={(id) => {
                  // 会话内选中 + 服务端持久化 (按 backend, 跨设备)。
                  mlCapabilities.setActiveModelId(id);
                  modelPref.save(id);
                }}
                capabilityWarnings={capabilityWarnings}
                onFillAttribute={handleFillAttribute}
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
                variantGroups={interactiveVariantGroups}
                variantCombinations={interactiveVariantCombos}
                variantDefaults={interactiveVariantSlice}
                variantValue={interactiveProjectVariantSlice}
                onVariantChange={handleInteractiveVariantChange}
              />
            )}
            {/* v0.20.11 · 选中单框二次推理入口: 非 AI 工具 (与 InteractiveToolBar 互斥) 且单选一个
                已落库框时浮顶部, 列该框可跑能力。图片任务 only (视频/3D 走各自轨迹面板)。 */}
            {!secondaryBarHidden &&
              !isAIToolId(s.tool) &&
              stageKind === "image" &&
              selectedAnnotationForPanel && (
                <SecondaryInferenceBar
                  projectId={projectId}
                  taskId={selectedAnnotationForPanel.task_id}
                  annotation={selectedAnnotationForPanel}
                  readOnly={isLocked}
                  existingAttributeKeys={projectAttributeKeys}
                  onEnsureAttributeFields={handleEnsureAttributeFields}
                />
              )}
            {/* SAM 候选的类选择器: 图片给 geom 走 vp 换算, 视频给 anchor 走 fixed 定位 (二者互斥)。 */}
            <WorkbenchOverlays
              pendingDrawing={s.pendingDrawing}
              editingClass={s.editingClass}
              samPendingGeom={isVideoTask ? videoSamPendingGeom : samPendingGeom}
              samPendingAnchor={isVideoTask ? videoSamPendingAccept?.anchor ?? null : null}
              samDefaultClass={isVideoTask ? videoSamDefaultClass : samDefaultClass}
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
              onSamCommitClass={isVideoTask ? handleVideoSamCommitClass : handleSamCommitClass}
              onSamCancelClass={isVideoTask ? handleVideoSamCancelClass : handleSamCancelClass}
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
        videoTimelineChapterControls,
        videoPropagateRange: propagateHighlight,
        videoSampling,
        videoManifestError: videoManifest.error,
        videoTool: s.videoTool,
        isVideoToolEnabled,
        // v0.21.23 · 交互式 SAM: 提示派发 + 瞬态候选/点会话渲染 (仅视频 task 有值)。
        onVideoSamPrompt,
        // 工具条上的正/负切换 (= / - 键) 与 Alt 等价, 与图片侧 SmartPointTool 同语义。
        samPolarity: s.samPolarity,
        samCandidates: isVideoTask ? sam.candidates : undefined,
        samActiveIdx: isVideoTask ? sam.activeIdx : undefined,
        // v0.21.27 · U-pvs-1/2/3 + 框修正 · 传播对话框开启时, 用同一 overlay 通道画已落的 PVS
        // 种子点/框 (归一化); 纠偏多帧下只画**当前帧**的点/框 (别帧坐标属其帧, 画到当前帧会错位)。
        // 多目标 (≥2 obj, 跨点与框统计) 时带 obj 供 overlay 逐目标配色 + 标号, 单目标剥去 obj
        // (白边、无标号, 与原视觉一致)。否则仍画帧级 SAM 会话点。
        samSessionPoints: isVideoTask
          ? propagateDialog
            ? trackerSeeds
                .filter((sd) => sd.frame === s.videoFrameIndex)
                .map(({ pt, polarity, obj }) => ({
                  pt,
                  polarity,
                  obj: seedMultiObj ? obj : undefined,
                }))
            : sam.sessionPoints
          : undefined,
        // 对话框开时画种子框; 否则若有待审候选, 画候选当前帧框 (预览); 都无则 undefined。
        samSessionBoxes: !isVideoTask
          ? undefined
          : propagateDialog
            ? trackerSeedBoxes
                .filter((sb) => sb.frame === s.videoFrameIndex)
                .map(({ bbox, obj }) => ({ bbox, obj: seedMultiObj ? obj : undefined }))
            : candidateBoxesThisFrame.length
              ? candidateBoxesThisFrame
              : undefined,
        videoMaskCandidates: isVideoTask ? candidateMasksThisFrame : undefined,
        videoMaskEditor: isVideoTask ? maskEditor : undefined,
        onVideoMaskCommit: isVideoTask ? commitVideoMask : undefined,
        onVideoMaskCancel: isVideoTask ? cancelVideoMaskEdit : undefined,
        spacePan,
        onSpacePanDragStart: markSpacePanDrag,
        videoFrameIndex: s.videoFrameIndex,
        videoReviewDisplayMode: mode === "review" ? modeState.diffMode : undefined,
        hiddenVideoTrackIds: s.hiddenVideoTrackIds,
        lockedVideoTrackIds: s.lockedVideoTrackIds,
        trackColorOverrides: s.trackColorOverrides,
        onVideoFrameIndexChange: s.setVideoFrameIndex,
        onVideoCreate: handleVideoCreate,
        onVideoCreatePointsTrack: handleVideoPointsTrackCreate,
        onVideoCreatePoints: handleVideoPointsCreate,
        onVideoPendingDraw: handleVideoPendingDraw,
        onVideoUpdate: handleVideoUpdate,
        onVideoRename: handleVideoRename,
        onVideoConvertToBboxes: handleVideoConvertToBboxes,
        onVideoComposeTracks: handleVideoComposeTracks,
        onToggleHiddenVideoTrack: s.toggleHiddenVideoTrack,
        onToggleLockedVideoTrack: s.toggleLockedVideoTrack,
        onPropagateVideoTrack: openPropagateDialog,
        // v0.21.4 · 视频单题 AI 候选(画布渲染 + 采纳/驳回); 复用图片的 accept/reject handler(几何无关)。
        aiBoxes: modeState.diffMode === "final" ? [] : aiBoxes,
        onAcceptPrediction: handleAcceptPrediction,
        onRejectPrediction: handleRejectPrediction,
      },
      image: {
        fileUrl,
        mediaKey: imageMediaKey,
        blurhash,
        imageWidth,
        imageHeight,
        thumbnailUrl,
        tool: s.tool,
        fadedAiIds: dimmedAiIds,
        nudgeMap,
        pendingGeomMap,
        userBoxes: modeState.diffMode === "raw" ? [] : userBoxes,
        aiBoxes: modeState.diffMode === "final" ? [] : aiBoxes,
        spacePan,
        vp,
        setVp,
        setFitTick,
        onAcceptPrediction: handleAcceptPrediction,
        onRejectPrediction: handleRejectPrediction,
        onPatchShapeFlag: handlePatchShapeFlag,
        secondaryBarHidden,
        onToggleSecondaryBar: () => setSecondaryBarHidden(!secondaryBarHidden),
        imageClipboardActions: imageContextMenuClipboard,
        onCommitDrawing: handleCommitDrawing,
        onCommitRotatedBbox: createRotatedBbox,
        onCommitRotateBbox: handleCommitRotateBbox,
        onSamPrompt: (prompt) => {
          // v0.18.26 · 档位(model_variants)走交互后端自己的偏好 (interactiveVariantSlice =
          // 项目 default_variants[交互后端] 合并 backend 默认), 不再受"交互后端是否==批量后端"约束,
          // 由工具栏「档位」选择器驱动。params (阈值等) 仍仅在同后端时复用批量 preCfg.paramsValue。
          const extra = buildPredictParams(
            interactiveBackendId === batchBackendId ? preCfg.paramsValue : undefined,
            interactiveVariantSlice,
          );
          if (prompt.kind === "point") return sam.runPoint(prompt.pt, prompt.alt ? 0 : 1, extra);
          if (prompt.kind === "exemplar")
            // v0.18.19 · alt=负框 (排误检) / 否则正框 (扩召回); refine 会话每次重发全量。
            return sam.runExemplar(prompt.bbox, prompt.alt ? 0 : 1, s.exemplarOutputMode, extra);
          return sam.runBbox(prompt.bbox, extra);
        },
        onCommitMove: handleCommitMove,
        onCommitResize: handleCommitResize,
        onCommitPolygonGeometry: handleCommitPolygonGeometry,
        onCommitKeypointGeometry: handleCommitKeypointGeometry,
        onJoinSelected: handleJoinSelectedPolygons,
        onCropSelected: handleCropSelectedPolygons,
        onStageGeometry: setStageGeom,
      },
      ai: {
        samCandidates: sam.candidates,
        samActiveIdx: sam.activeIdx,
        samSessionPoints: sam.sessionPoints,
        samSessionExemplars: sam.sessionExemplars,
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
      // v0.20.19 · 属性区折叠态走 workbench.layout 服务端偏好, 选框/刷新/换设备保留。
      attrCollapsed: s.attrPanelCollapsed,
      onToggleAttrCollapsed: () => s.setAttrPanelCollapsed(!s.attrPanelCollapsed),
      // v0.20.22 · AI 待审 / 人工两大分组头折叠 (同一 workbench.layout 管道跨设备持久)。
      aiSectionCollapsed: s.aiSectionCollapsed,
      onToggleAiSection: () => s.setAiSectionCollapsed(!s.aiSectionCollapsed),
      manualSectionCollapsed: s.manualSectionCollapsed,
      onToggleManualSection: () => s.setManualSectionCollapsed(!s.manualSectionCollapsed),
      widthMin: sidebarMinPx, widthMax: sidebarMaxPx, widthResetTo: sidebarResetPx,
      onDetach: detachInspector,
      capabilityWarnings,
      onFillAttribute: handleFillAttribute,
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
      hasMorePredictions: modeState.diffMode !== "final" && !!predictionsInfinite.hasNextPage,
      isFetchingMorePredictions: modeState.diffMode !== "final" && predictionsInfinite.isFetchingNextPage,
      onFetchMorePredictions: () => predictionsInfinite.fetchNextPage(),
      currentFrameIndex: isVideoTask ? s.videoFrameIndex : undefined,
      onSeekFrame: isVideoTask ? s.setVideoFrameIndex : undefined,
      videoTrackPanel: isVideoTask ? ((frameFilter) => (
        <div className="grid gap-3">
          {renderVideoTrackSidebar(frameFilter)}
          <VideoChapterSidebar
            datasetItemId={videoDatasetItemId}
            frameIndex={s.videoFrameIndex}
            maxFrame={Math.max(0, videoFrameCount - 1)}
            timebase={videoChapterTimebase}
            canEdit={!isLocked && isOwner}
            onSeekFrame={s.setVideoFrameIndex}
            timelineDraftArmed={chapterDraftArmed}
            onToggleTimelineDraft={() => setChapterDraftArmed((v) => !v)}
            draftRange={chapterDraft}
            onConsumeDraftRange={() => setChapterDraft(null)}
            hoveredChapterId={hoveredChapterId}
            onHoverChapter={setHoveredChapterId}
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
    // v0.20.x · 工作台桌宠;情绪全由 props 派生(标注数增长/里程碑/久坐),不挂 mutation。
    pet: {
      enabled: s.workbenchConfig.common.petEnabled,
      context: petContext,
      onExpand: expandSelectionCard,
    },
    aiPopover: {
      // v0.21.4 · 视频项目也开放当前题 AI(单帧 → 图像 backend), onRunAi 走帧路径。
      open: aiPopoverOpen,
      rightOffset: rightOpen ? rightPx + 44 : 44,
      position: aiPopoverPosition,
      onPositionChange: setAiPopoverPosition,
      size: aiPopoverSize,
      onSizeChange: setAiPopoverSize,
      aiModel, aiRunning, aiBoxCount: aiPopoverBoxCount,
      isVideoTask,
      confThreshold: s.confThreshold, aiTakeoverRate,
      onClose: () => setAiPopoverOpen(false),
      // v0.21.4 · 视频走单帧路径(client 供图), 图像走既有 task 级 triggerPreannotation。
      onRunAi: isVideoTask ? handleRunVideoFrameAi : handleRunAi,
      // v0.18.28 · 项目存了编排时多给一个「按项目编排跑当前题」入口。
      hasProjectPipeline,
      projectPipelineStageCount,
      // claude[bot] P1 #5 · 编排可执行 (引用的 backend 都还在); false 时 popover 入口禁用并提示。
      projectPipelineRunnable,
      pipelineMissingBackendCount: pipelineMissingBackends.length,
      onRunPipeline: handleRunAiPipeline,
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
      secondaryBarHidden,
      onToggleSecondaryBar: () => setSecondaryBarHidden(!secondaryBarHidden),
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
      // v0.20.22 · 讨论区完全收起 (同一 workbench.layout 管道跨设备持久)。
      collapsed: s.discussionCollapsed,
      onToggleCollapsed: () => s.setDiscussionCollapsed(!s.discussionCollapsed),
    },
  };

  const propagateDialogProps: ComponentProps<typeof VideoTrackerPropagateDialog> = {
    open: Boolean(propagateDialog),
    position: trackerPanelPosition,
    onPositionChange: setTrackerPanelPosition,
    size: trackerPanelSize,
    onSizeChange: setTrackerPanelSize,
    // v0.21.27 · U-pvs-2 · 有落点后范围锚定首个落点帧 (seedAnchorFrame), 导航到别帧加修正点
    // 不移动传播范围; 无落点时跟随当前帧 (与现状一致)。
    frameIndex: seedAnchorFrame ?? s.videoFrameIndex,
    maxFrame: Math.max(0, videoFrameCount - 1),
    nextKeyframeAfter: propagateDialogNextKeyframe,
    prevKeyframeBefore: propagateDialogPrevKeyframe,
    userId: meUserId ?? null,
    samplingStep,
    projectDefaultModel: currentProject?.rendering_config?.trackerDefaultModel ?? null,
    preferNonMockModel: Boolean(currentProject?.ml_backend_id),
    // v0.21.19 · 能力协商: backend 声明的 tracker 列表, 用于灰置未声明的 text-driven tracker (sam3_video)。
    // v0.21.25 (阶段 R): 取所有已启用 backend 的并集 (allSupportedTrackers), 不再局限单个绑定/交互 backend。
    supportedTrackers: allSupportedTrackers,
    textDrivenTrackers: mlCapabilities.capability?.text_driven_trackers,
    // polyline 轨迹传播暂不支持 (后端会静默改写成空 bbox 轨迹), 灰置传播动作。
    isPolylineTrack: propagateDialogTrack ? isVideoPolylineTrack(propagateDialogTrack) : false,
    // v0.22.1 · A2/A3 · 源轨迹类别: 摘要「延展 / 新建」+ 文本检测类别继承警示。
    sourceTrackClassName: propagateDialogTrack?.class_name ?? null,
    // v0.22.1 · B · 无源检测模式 (画布级入口无选中轨迹) + 可选目标类别 (项目 classes)。
    // v0.22.2 · M2 · 多源批量不是无源 (各源自带几何与类别), 故排除。
    sourceless: !propagateDialogTrack && !propagateMultiSource,
    availableClasses: currentProject?.classes ?? [],
    // v0.22.2 · M2 · 多选批量: 源条数 + 去重类别 (混类叙事「N 类」/ 单类「XX」)。
    sourceCount: propagateMultiSource ? propagateSources!.length : undefined,
    sourceClassNames: propagateMultiSource
      ? [...new Set(propagateSources!.map((sd) => sd.class_name))]
      : undefined,
    submitting: Boolean(propagateDialog?.submitting),
    // v0.22.2 · U8 · 提交成功后挂上 job id → 对话框就地转「追踪中…」进行态, 进度读该 job 的
    // 分窗回报; 结果就绪 / 失败时 effect 关闭对话框复位。
    tracking: Boolean(trackingJobId),
    trackingWindow: trackingJobId
      ? trackerJobs.jobs[trackingJobId]?.windowProgress ?? null
      : null,
    onCancel: closePropagateDialog,
    onSubmit: handlePropagateSubmit,
    onRangeChange: setPropagateHighlight,
    brushedRange: propagateBrush,
    // v0.21.27 · U-pvs-1/2 + 框修正 · PVS 点/框种子采集 (仅 sam3_video_interactive, 门控在对话框内)。
    seedCollecting,
    seedPointCount: trackerSeeds.length,
    // 框修正: 已落框数 + 点/框模式切换。
    seedBoxCount: trackerSeedBoxes.length,
    seedMode,
    onChangeSeedMode: changeSeedMode,
    // 目标/帧数跨点与框统计。
    seedTargetCount: new Set([
      ...trackerSeeds.map((s) => s.obj),
      ...trackerSeedBoxes.map((b) => b.obj),
    ]).size,
    seedFrameCount: new Set([
      ...trackerSeeds.map((s) => s.frame),
      ...trackerSeedBoxes.map((b) => b.frame),
    ]).size,
    onToggleSeedCollecting: toggleSeedCollecting,
    onNewSeedTarget: newSeedTarget,
    onClearSeeds: () => {
      setTrackerSeeds([]);
      setTrackerSeedBoxes([]);
      setSeedObj(1);
      setSeedAnchorFrame(null);
    },
  };

  // v0.21.28 · 候选/接受审阅条 props。
  const trackerReviewProps: ComponentProps<typeof VideoTrackerReviewBar> = {
    open: Boolean(trackerReviewCandidate),
    frameCount: trackerReviewCandidate
      ? new Set(trackerReviewCandidate.preview.results.map((r) => r.frame_index)).size
      : 0,
    targetCount: trackerReviewCandidate
      ? new Set(trackerReviewCandidate.preview.results.map((r) => r.instance_id ?? "1")).size
      : 0,
    submitting: trackerReviewCandidate
      ? Boolean(trackerJobs.submitting[trackerReviewCandidate.jobId])
      : false,
    onAccept: () => {
      if (trackerReviewCandidate) void trackerJobs.accept(trackerReviewCandidate.jobId);
    },
    onDiscard: () => {
      if (trackerReviewCandidate) void trackerJobs.discard(trackerReviewCandidate.jobId);
    },
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
    trackerReview: trackerReviewProps,
    issueSection,
  };
}
