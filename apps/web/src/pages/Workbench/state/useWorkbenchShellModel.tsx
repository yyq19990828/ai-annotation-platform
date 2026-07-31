import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/components/ui/Toast";
import { randomId } from "@/utils/id";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/ui/alert-dialog";
import { useProject, useUpdateProject } from "@/hooks/useProjects";
import { useProjectPipelines } from "@/hooks/useProjectPipelines";
import {
  useTaskList,
  useTask,
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useUpdateAnnotation,
  useSubmitTask,
  useVideoManifest,
  useVideoFrameTimetable,
  useMaskCapabilities,
} from "@/hooks/useTasks";
import { usePredictions } from "@/hooks/usePredictions";
import { useAnnotationBulkUpdate } from "@/hooks/useAnnotationGroup";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import { useAcceptNativeMaskCandidate } from "@/hooks/useAcceptNativeMaskCandidate";
import { tasksApi } from "@/api/tasks";
import { rasterMasksApi } from "@/api/rasterMasks";
import {
  maskMutationsApi,
  type MaskMutation,
  type MaskMutationCommitRequest,
  type MaskMutationGeometry,
  type MaskMutationOperation,
  type MaskMutationScope,
} from "@/api/maskMutations";
import { ApiError } from "@/api/client";
import type { AnnotationConversionExecuteResponse } from "@/api/annotationConversions";
import { videoTrackerApi } from "@/api/videoTracker";
import { resolveCrossFrameNavigation } from "./crossFrameTarget";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { predictionsApi } from "@/api/predictions";
import { mlBackendsApi } from "@/api/ml-backends";
import type {
  Annotation,
  TaskResponse,
  AnnotationResponse,
  VideoTrackGeometry,
  VideoTrackMaskGeometry,
  VideoTrackMaskKeyframe,
  MLBackendResponse,
} from "@/types";
import { ANNOTATION_GUIDE_UI_ENABLED } from "@/config/featureFlags";
import { publishTaskBoxCount } from "@/components/PerfHud/useTaskBoxCount";
import { useWorkbenchState, type VideoTool } from "./useWorkbenchState";
import { usePendingGeom } from "./usePendingGeom";
import { useToolBindings, classesForUnit, attributeSchemaForUnit } from "./useToolBindings";
import { videoToolUnit, videoToolEnabled } from "../stage/videoToolUnits";
import type { ToolUnitId } from "@/constants/toolUnits";
import type { AttributeField, ToolBinding, ToolBindings } from "@/api/projects";
import { useViewportTransform } from "./useViewportTransform";
import { useIssuePins } from "./useIssuePins";
import {
  useMaskQcReview,
  collectMaskQcTrackerCandidates,
  type MaskQcLocalAiCandidate,
  type MaskQcTrackerCandidate,
} from "./useMaskQcReview";
import type { MaskQcIssue } from "@/api/maskQc";
import { usePredictionPropagation } from "./usePredictionPropagation";
import { useAiPopoverFrame } from "./useAiPopoverFrame";
import { useVideoTrackerPanelFrame } from "./useVideoTrackerPanelFrame";
import { useAnnotationHistory, type VideoMaskFrameState } from "./useAnnotationHistory";
import { useRecentClasses } from "./useRecentClasses";
import { useSessionStats } from "./useSessionStats";
import { useWorkbenchHotkeys } from "./useWorkbenchHotkeys";
import { useCanvasDraftPersistence } from "./useCanvasDraftPersistence";
import { useWorkbenchTaskFlow } from "./useWorkbenchTaskFlow";
import {
  useInteractiveAI,
  type InteractiveTransport,
  type PendingCandidate,
  type TextOutputMode,
} from "./useInteractiveAI";
import type { VideoSamPrompt } from "../stage/videoStageTypes";
import { isSamCandidateNavTool } from "../stage/videoKonvaInteraction";
import { tightenBboxFromPolygon } from "../stage/shared/geometry/bbox";
import { classColorForCanvas } from "../stage/colors";
import { useRasterMaskRecords } from "../stage/shared/useRasterMaskRecords";
import { useRasterMaskWorkerPool } from "../stage/shared/useRasterMaskWorkerPool";
import { resolveInitialOutputMode, writeStoredOutputMode } from "./samTextOutput";
import { shouldConfirmAnnotationDelete } from "./deleteConfirmation";
import { usePreannotateConfig } from "@/pages/AIPreAnnotate/components/usePreannotateConfig";
import { useMLBackends } from "@/hooks/useMLBackends";
import { useMLCapabilities } from "./useMLCapabilities";
import { useBackendRouting, INTERACTIVE_PROMPTS } from "./useBackendRouting";
import { useCapabilityValidation } from "./useCapabilityValidation";
import { useAiToolModelPref } from "./useAiToolModelPref";
import { useInteractiveBackendPref } from "./useInteractiveBackendPref";
import { InteractiveToolBar } from "../shell/InteractiveToolBar";
import { SecondaryInferenceBar } from "../shell/SecondaryInferenceBar";
import { useSecondaryBarHiddenPref } from "./useSecondaryBarHiddenPref";
import { IssueCreateModal } from "../shell/IssueCreateModal";
import { isAIToolId, TOOL_REGISTRY, type ToolId } from "../stage/tools";
import {
  resolveSamCandidateClass,
  samCandidateDisplayShapes,
  samCandidateGeom,
  shouldShowInManualAnnotationSection,
} from "./useWorkbenchShellModel.helpers";
import { useHoveredCommentStore, selectEffectiveShapes } from "./useHoveredCommentStore";
import { annotationToBox, collectOccludedKeys } from "./transforms";
import { applyVideoKeyframeToGeometry } from "./videoTrackCommands";
import { useAnnotateMode } from "../modes/useAnnotateMode";
import { useReviewMode } from "../modes/useReviewMode";
import { setActiveClassesConfig, UNKNOWN_CLASS } from "../stage/colors";
import type { VideoStageControls } from "../stage/videoStageControls";
import { deriveSamplingStep } from "../stage/videoSamplingGrid";
import { VideoChapterSidebar, pickChapterTargetFrame } from "../stage/VideoChapterSidebar";
import type {
  TimelineRangePurpose,
  VideoTimelineChapterControls,
} from "../stage/VideoPlaybackOverlay";
import type { VideoLoopRegion } from "../stage/videoNavigationState";
import { VideoTrackSidebar, trackRangesOverlap } from "../stage/VideoTrackSidebar";
import type { VideoTrackGapMode } from "../stage/VideoTrackComposeDialog";
import type { TrackFilter } from "../stage/VideoTrackPanel";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import {
  VideoMaskCorrectionDialog,
  type VideoMaskCorrectionIntent,
  type VideoMaskCorrectionModel,
} from "../stage/VideoMaskCorrectionDialog";
import { executeVideoMaskCorrectionFlow } from "./videoMaskCorrectionFlow";
import { VideoTrackerReviewBar } from "../stage/VideoTrackerReviewBar";
import {
  MaskConversionDialog,
  type MaskConversionDialogRequest,
} from "../stage/MaskConversionDialog";
import {
  isAnyVideoSingleFrame,
  isVideoBbox,
  isVideoMask,
  isVideoMaskTrack,
  isVideoPointsTrack,
  isVideoPolylineTrack,
  isVideoTrack,
  resolveTrackAtFrame,
  resolveVideoMaskTrackAtFrame,
} from "../stage/videoStageGeometry";
import { isFrameOutside } from "../stage/videoTrackOutside";
import {
  validateVideoMaskClipboard,
  type VideoMaskClipboardEntry,
} from "../stage/videoMaskClipboard";
import type { VideoMaskKeyframeActionHandlers } from "../stage/videoMaskKeyframeActions";
import { aiBoxOnFrame } from "../stage/aiBoxFrames";
import type { AnnotationCommentAnchor } from "@/api/comments";
import { useUpdateVideoChapter, useVideoChapters } from "@/hooks/useVideoChapters";
import { useVideoTrackerJobs } from "@/hooks/useVideoTrackerJobs";
import type { VideoTrackAnnotation } from "../stage/videoStageTypes";
import type { StageKind } from "../stages/types";
import {
  LARGE_IMAGE_TILES_ENABLED,
  useWorkbenchImageSource,
  workbenchImagePreviewUrl,
} from "../stage/useWorkbenchImageSource";
import { imageTileDeviceBudget, singleImageFitsDecodedBudget } from "../stage/imagePyramid";
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
import { ConversionBatchCardContent } from "../shell/selectionCard/ConversionBatchCardContent";
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
import { getAll as offlineQueueGetAll, removeById as offlineQueueRemoveById } from "./offlineQueue";
import { useWorkbenchOfflineQueue } from "./useWorkbenchOfflineQueue";
import { useImageAnnotationActions } from "../stages/image/useImageAnnotationActions";
import {
  promptMaskLeaveChoice,
  useMaskEditorSession,
  type MaskSessionKey,
} from "./useMaskEditorSession";
import type { UseMaskEditorReturn } from "./useMaskEditor";
import { canCommitMask, canEditMask, maskEditBlockReason } from "./canEditMask";
import { MaskToolbar } from "../shell/MaskToolbar";
import {
  upsertVideoMaskKeyframe,
  useVideoAnnotationActions,
} from "../stages/video/useVideoAnnotationActions";
import { decodeCocoRle, encodeCocoRle } from "../stage/shared/geometry/maskRle";
import {
  planMaskJoin,
  type MaskInstanceOperationPlan,
  type MaskInstanceOperationSpec,
} from "../stage/shared/geometry/maskInstanceOperations";
import {
  maskAlphasIntersect,
  maskMutationExpectedVersions,
  maskMutationScopeFingerprint,
  maskMutationScopeMembers,
  subtractMaskAlpha,
} from "../stage/shared/geometry/maskMutationDraft";
import {
  buildPipelineRunPayload,
  commitAfterNavigationGuard,
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

type PendingMaskAtomicDraft = {
  kind: MaskMutationOperation;
  sourceIds: string[];
  scope: MaskMutationScope;
  /** 预览时的范围快照；提交/重试不得改用后续刷新的版本。 */
  members: AnnotationResponse[];
  operationSpec?: MaskInstanceOperationSpec;
  joinMode?: "replace_sources" | "preserve_sources";
  destructiveConfirmed?: boolean;
  overlapPolicy?: "erase_same_class" | "erase_all";
  overlapResults?: Array<{
    annotationId: string;
    alpha: Uint8Array;
    changedPixels: number;
    area: number;
    unresolved: boolean;
  }>;
  copyKeyframe?: VideoMaskClipboardEntry;
  copyTargetId?: string;
};

type MaskMutationRecovery = {
  retry: boolean;
  refresh: boolean;
};

function maskMutationRecovery(error: unknown): MaskMutationRecovery {
  if (!(error instanceof ApiError)) return { retry: true, refresh: true };
  const detail =
    error.detailRaw && typeof error.detailRaw === "object"
      ? (error.detailRaw as { reason?: string })
      : null;
  const reason = detail?.reason ?? "";
  if (
    [
      "expected_versions_missing",
      "version_mismatch",
      "scope_stale",
      "task_lock_conflict",
      "annotation_locked",
      "segment_lock_conflict",
      "overlap_conflict",
    ].includes(reason)
  ) {
    return { retry: false, refresh: true };
  }
  if (reason === "idempotency_conflict") {
    return { retry: false, refresh: true };
  }
  if (error.status === 422) {
    return { retry: false, refresh: false };
  }
  return {
    retry: error.status >= 500 || error.status === 408 || error.status === 429,
    refresh: error.status === 409 || error.status === 423 || error.status === 428,
  };
}

function maskMutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.detailRaw && typeof error.detailRaw === "object") {
    const detail = error.detailRaw as { reason?: string; message?: string };
    const labels: Record<string, string> = {
      expected_versions_missing: "缺少范围版本，请刷新后重算",
      version_mismatch: "来源 Mask 已变更，草稿已保留",
      scope_stale: "Mask 范围已变更，草稿已保留",
      task_lock_conflict: "任务正由其他用户编辑",
      annotation_locked: "锁定对象阻止了原子提交",
      segment_lock_conflict: "当前视频分段锁已失效",
      idempotency_conflict: "幂等 key 与本次请求不一致",
      overlap_conflict: "范围内仍有重叠 Mask",
    };
    return labels[detail.reason ?? ""] ?? detail.message ?? detail.reason ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

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
  maskCorrectionDialog: ComponentProps<typeof VideoMaskCorrectionDialog>;
  conversionDialog: ComponentProps<typeof MaskConversionDialog>;
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
  const maskNavigationGuardRef = useRef<() => Promise<boolean>>(async () => true);
  const maskInstanceTransitionInFlightRef = useRef(false);
  const maskInstanceCommitInFlightRef = useRef<Promise<boolean> | null>(null);
  const maskInstanceRefreshTokenRef = useRef<object | null>(null);
  const [maskInstanceCommitting, setMaskInstanceCommitting] = useState(false);
  const [maskInstanceRefreshing, setMaskInstanceRefreshing] = useState(false);
  const maskInstanceTransitionBusy = maskInstanceCommitting || maskInstanceRefreshing;
  const onBack = useCallback(() => {
    void maskNavigationGuardRef.current().then((allowed) => {
      if (allowed) navigate(backTarget);
    });
  }, [navigate, backTarget]);
  const updateUrl = useCallback(
    (opts: {
      batchId?: string | null;
      taskId?: string | null;
      replace?: boolean;
      maskGuardApproved?: boolean;
    }) => {
      const nextUrl = updateWorkbenchUrlSearch(location, opts);
      if (opts.maskGuardApproved) {
        if (nextUrl !== currentPath) navigate(nextUrl, { replace: opts.replace ?? false });
        return;
      }
      void maskNavigationGuardRef.current().then((allowed) => {
        if (allowed && nextUrl !== currentPath) {
          navigate(nextUrl, { replace: opts.replace ?? false });
        }
      });
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
  const backends = useMemo(() => (backendsQ.data ?? []) as MLBackendResponse[], [backendsQ.data]);
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

  const aiModel =
    selectedBackend?.name ?? (currentProject?.ml_backend_id ? "已接入模型" : "未接入模型");

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
  const tasks = useMemo(() => taskPages?.flatMap((p) => p.items) ?? [], [taskPages]);
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
    setExemplarOutputMode(resolveInitialOutputMode(projectId, currentProject?.type_key, meUserId));
  }, [projectId, currentProject?.type_key, meUserId, setExemplarOutputMode]);
  const handleSetExemplarOutputMode = useCallback(
    (mode: TextOutputMode) => {
      setExemplarOutputMode(mode);
      if (projectId) writeStoredOutputMode(projectId, mode, meUserId);
    },
    [projectId, meUserId, setExemplarOutputMode],
  );
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
  const editingClassUnit = s.editingClass?.accept?.toolUnitId ?? s.editingClass?.toolUnitId;
  const editingClassClasses = useMemo(() => {
    if (!editingClassUnit) return classes;
    return classesForUnit(currentProject?.tool_bindings, editingClassUnit as ToolUnitId);
  }, [editingClassUnit, currentProject?.tool_bindings, classes]);
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
  const { trackerPanelPosition, setTrackerPanelPosition, trackerPanelSize, setTrackerPanelSize } =
    useVideoTrackerPanelFrame();
  const [stageGeom, setStageGeom] = useState<{
    imgW: number;
    imgH: number;
    vpSize: { w: number; h: number };
  }>({ imgW: 0, imgH: 0, vpSize: { w: 0, h: 0 } });
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
      directTask &&
      (directTask.id === requestedTaskId || !currentTaskId || directTask.id === currentTaskId)
    ) {
      return directTask;
    }
    if (requestedTaskId) return undefined;
    return tasks[0];
  }, [tasks, currentTaskId, requestedTaskId, shouldLoadDirectTask, directTaskQuery.data]);
  const taskId = task?.id;
  const currentTaskIdRef = useRef(taskId);
  currentTaskIdRef.current = taskId;
  const taskIdx = tasks.findIndex((t) => t.id === taskId);
  const selectTask = useCallback(
    async (
      id: string,
      opts: { replace?: boolean; signal?: AbortSignal } = {},
    ): Promise<boolean> => {
      return commitAfterNavigationGuard(maskNavigationGuardRef.current, opts.signal, () => {
        setCurrentTaskId(id);
        setSelectedId(null);
        updateUrl({
          batchId: selectedBatchId,
          taskId: id,
          replace: opts.replace,
          maskGuardApproved: true,
        });
      });
    },
    [selectedBatchId, setCurrentTaskId, setSelectedId, updateUrl],
  );
  const imageWidth = task?.image_width ?? null;
  const imageHeight = task?.image_height ?? null;
  const fileUrl = task?.file_url ?? null;
  const imageMediaKey = task?.dataset_item_id ?? task?.id ?? null;
  const blurhash = task?.blurhash ?? null;
  const thumbnailUrl = task?.thumbnail_url ?? null;
  const { source: workbenchImageSource, retry: retryWorkbenchImagePyramid } =
    useWorkbenchImageSource(task, imageMediaKey);
  const workbenchImagePreview = workbenchImagePreviewUrl(workbenchImageSource);
  const isVideoTask = task?.file_type === "video" || currentProject?.type_key === "video-track";
  const stageKind = currentProject?.type_key === "lidar" ? "3d" : isVideoTask ? "video" : "image";
  const maskCapabilities = useMaskCapabilities(taskId, !!taskId && !isVideoTask);
  const imageMaskSizeSupported =
    !imageWidth || !imageHeight || !maskCapabilities.data
      ? true
      : imageWidth <= maskCapabilities.data.max_dimension &&
        imageHeight <= maskCapabilities.data.max_dimension &&
        imageWidth * imageHeight <= maskCapabilities.data.max_pixels;
  const imageMaskPersistenceMode: "native" | "legacy" | "blocked" = !imageMaskSizeSupported
    ? "blocked"
    : maskCapabilities.data?.write_enabled === true
      ? "native"
      : maskCapabilities.data?.legacy_polygon_commit_enabled === true
        ? "legacy"
        : "blocked";
  const videoManifest = useVideoManifest(taskId, isVideoTask);
  const videoSegmentsQuery = useQuery({
    queryKey: ["video-segments", taskId],
    queryFn: () => videoTrackerApi.segments(taskId as string),
    enabled: isVideoTask && !!taskId,
    staleTime: 30_000,
  });
  const videoFrameTimetable = useVideoFrameTimetable(taskId, isVideoTask && !!videoManifest.data);
  const videoDatasetItemId = videoManifest.data?.dataset_item_id ?? null;
  const videoChaptersQuery = useVideoChapters(isVideoTask ? videoDatasetItemId : null);
  const videoChaptersData = useMemo(() => videoChaptersQuery.data ?? [], [videoChaptersQuery.data]);
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
  const [chapterDraft, setChapterDraft] = useState<{ startFrame: number; endFrame: number } | null>(
    null,
  );
  // v0.21.13 WS4 · 时间轴章节条 ↔ 侧栏行双向 hover 联动的共享态。
  const [hoveredChapterId, setHoveredChapterId] = useState<string | null>(null);
  // v0.21.16 WS3 · 轨迹多选态镜像 (由 roster 的 VideoTrackSidebar 经 onSelectionChange 上报),
  // 供浮卡在多选 ≥2 轨迹时渲染批量卡。roster 仍是唯一 owner, 此处只读镜像, 不双写。
  const [videoBatchTracks, setVideoBatchTracks] = useState<VideoTrackAnnotation[]>([]);
  // v0.21.14 WS3 · AI 传播对话框打开时上报的影响范围 (时间轴高亮「将影响哪段帧」)。
  const [propagateHighlight, setPropagateHighlight] = useState<{
    startFrame: number;
    endFrame: number;
  } | null>(null);
  // v0.21.14 · 传播对话框打开时时间轴 Shift+拖刷选回填的范围 (每次刷选替换新对象喂给对话框)。
  const [propagateBrush, setPropagateBrush] = useState<{
    startFrame: number;
    endFrame: number;
  } | null>(null);
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
  const chapterResizeDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
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
        const job =
          batchSources && batchSources.length >= 2
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
      void maskNavigationGuardRef.current().then((allowed) => {
        if (!allowed) return;
        setSelectedBatchId(batchId);
        setCurrentTaskId(null);
        setSelectedId(null);
        updateUrl({ batchId, taskId: null, maskGuardApproved: true });
      });
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

  const {
    data: annotationsData,
    refetch: refetchAnnotations,
    isSuccess: annotationsReady,
  } = useAnnotations(taskId);
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
    () => (currentProject ? new Set(Object.keys(currentProject.classes_config ?? {})) : null),
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
  const visibleAnnotationIds = useMemo(
    () => new Set(visibleAnnotationsData.map((annotation) => annotation.id)),
    [visibleAnnotationsData],
  );
  const selectedIdsForOrphanFilter = s.selectedIds;
  const replaceSelectedForOrphanFilter = s.replaceSelected;

  useEffect(() => {
    if (!hideOrphanAnnotations || selectedIdsForOrphanFilter.length === 0) return;
    const nextSelectedIds = selectedIdsForOrphanFilter.filter((id) => !orphanAnnotationIds.has(id));
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
        annotation.id === requestedFocusId ||
        (requestedTrackId && annotation.track_id === requestedTrackId),
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
    () =>
      visibleAnnotationsData
        .filter((ann) => shouldShowInManualAnnotationSection(ann, isVideoTask))
        .map((a) => annotationToBox(a, occludedKeys)),
    [visibleAnnotationsData, isVideoTask, occludedKeys],
  );
  const rasterMaskSelectedIds = useMemo(
    () => new Set(s.selectedIds.length > 0 ? s.selectedIds : s.selectedId ? [s.selectedId] : []),
    [s.selectedId, s.selectedIds],
  );
  const rasterMaskWorkerPool = useRasterMaskWorkerPool(taskId);
  const imageRasterMaskDescriptors = useMemo(() => {
    if (isVideoTask || maskCapabilities.data?.read_enabled !== true) return [];
    return visibleAnnotationsData.flatMap((annotation) => {
      if (annotation.geometry.type !== "raster_mask") return [];
      const color = classColorForCanvas(annotation.class_name);
      return [
        {
          id: annotation.id,
          source: "annotation" as const,
          ref: annotation.geometry.mask,
          revision: annotation.version ?? annotation.geometry.mask.sha256,
          color,
          colorRevision: color,
          zOrder: annotation.z_order ?? 0,
          selected: rasterMaskSelectedIds.has(annotation.id),
          load: () => rasterMasksApi.annotationRasterMaskContent(annotation.id),
        },
      ];
    });
  }, [
    isVideoTask,
    maskCapabilities.data?.read_enabled,
    rasterMaskSelectedIds,
    visibleAnnotationsData,
  ]);
  const imageRasterMasks = useRasterMaskRecords({
    scopeKey:
      !isVideoTask && maskCapabilities.data?.read_enabled === true ? (taskId ?? null) : null,
    descriptors: imageRasterMaskDescriptors,
    workerPool: rasterMaskWorkerPool,
  });

  const taskAiMeta = useMemo(() => {
    if (predictionsData.length === 0)
      return { totalCost: 0, avgMs: null as number | null, count: 0 };
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
  const {
    progress: preannotationProgress,
    connection: preannotationConn,
    retries: preannotationRetries,
  } = usePreannotationProgress(projectId);
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
    (targetTaskId: string): Promise<boolean> => {
      const nav = resolveCrossFrameNavigation(
        tasks.map((t) => t.id),
        targetTaskId,
      );
      return selectTask(nav.taskId);
    },
    [tasks, selectTask],
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
  // tracker 可用性按项目已启用、已连接且 reachable 的 backend 分别计算；保留 provider
  // 归属，避免把两个 backend 的原子能力误拼成一个可执行 combo。
  const trackerModelProviders = useMemo(() => {
    const providers: Record<string, string[]> = {};
    for (const backend of backends) {
      const entry = routing.capIndex[backend.id];
      if (backend.state !== "connected" || !entry?.reachable) continue;
      for (const tracker of entry.trackers) {
        (providers[tracker] ??= []).push(backend.name);
      }
      if (
        entry.trackers.includes("sam3_video") &&
        entry.trackers.includes("sam3_video_interactive")
      ) {
        (providers.sam3_video_combo ??= []).push(backend.name);
      }
    }
    return providers;
  }, [backends, routing.capIndex]);
  const allSupportedTrackers = useMemo(
    () => Object.keys(trackerModelProviders),
    [trackerModelProviders],
  );
  const correctionModels = useMemo<VideoMaskCorrectionModel[]>(() => {
    const models = new Map<string, VideoMaskCorrectionModel>();
    for (const backend of backends) {
      const entry = routing.capIndex[backend.id];
      if (backend.state !== "connected" || !entry?.reachable) continue;
      for (const model of entry.videoModels) {
        const nativeMask =
          model.prompts.has("correction_frame") &&
          model.inputs.has("video") &&
          model.inputs.has("mask_prompt") &&
          model.outputs.has("mask");
        const bboxFallback =
          model.inputs.has("video") && model.inputs.has("bbox_prompt") && model.outputs.has("mask");
        if ((!nativeMask && !bboxFallback) || !model.maxWindowFrames) continue;
        for (const modelKey of model.trackers) {
          const candidate: VideoMaskCorrectionModel = {
            backendId: backend.id,
            modelKey,
            modelId: model.id,
            nativeMask,
            textRequired: model.textDrivenTrackers.has(modelKey),
            maxWindowFrames: model.maxWindowFrames,
          };
          const current = models.get(modelKey);
          if (!current || (!current.nativeMask && candidate.nativeMask)) {
            models.set(modelKey, candidate);
          }
        }
      }
    }
    return [...models.values()];
  }, [backends, routing.capIndex]);
  const allTextDrivenTrackers = useMemo(() => {
    const set = new Set<string>();
    for (const backend of backends) {
      const entry = routing.capIndex[backend.id];
      if (backend.state !== "connected" || !entry?.reachable) continue;
      for (const tracker of entry.textDrivenTrackers) set.add(tracker);
    }
    if (trackerModelProviders.sam3_video_combo) set.add("sam3_video_combo");
    return [...set];
  }, [backends, routing.capIndex, trackerModelProviders]);
  // v0.21.23 · 当前激活的 AI 工具。视频侧按 videoTool 解析 —— smart-point / smart-box 与图片
  // 工具同名, 共用 TOOL_REGISTRY, 故交互 prompt 解析与工具上下文浮块可直接复用图片侧那套。
  const activeAiTool = (isVideoTask ? s.videoTool : s.tool) as ToolId;
  // 当前工具对应的交互 prompt (非交互工具回落 point, 仅用于 sam/warmup 的后端选取, 不参与门控)。
  const activeInteractivePrompt = promptOfTool(activeAiTool);
  const [singleFrameOutputGeometry, setSingleFrameOutputGeometry] = useState<"polygon" | "mask">(
    "mask",
  );
  const selectedMaskPromptSource = useMemo(() => {
    if (!s.selectedId || s.selectedIds.length > 1) return null;
    const annotation = visibleAnnotationsData.find((item) => item.id === s.selectedId);
    if (!annotation || annotation.is_locked || !Number.isInteger(annotation.version)) return null;
    const supportedGeometry = isVideoTask
      ? (annotation.geometry.type === "video_mask" &&
          annotation.geometry.frame_index === s.videoFrameIndex) ||
        annotation.geometry.type === "video_track_mask"
      : annotation.geometry.type === "raster_mask";
    if (!supportedGeometry) return null;
    return {
      annotation_id: annotation.id,
      source_version: annotation.version as number,
      class_name: annotation.class_name,
    };
  }, [isVideoTask, s.selectedId, s.selectedIds.length, s.videoFrameIndex, visibleAnnotationsData]);
  const promptInputByFamily: Record<string, string> = {
    point: "point_prompt",
    interactive_box: "bbox_prompt",
    scribble: "scribble_prompt",
  };
  const activePromptInput = activeInteractivePrompt
    ? promptInputByFamily[activeInteractivePrompt]
    : undefined;
  const maskRefinementRequested = selectedMaskPromptSource != null && activePromptInput != null;
  const exactMaskRequirement =
    maskRefinementRequested && activeInteractivePrompt
      ? {
          prompt: activeInteractivePrompt,
          requiredInputs: [activePromptInput, "mask_prompt"],
          output: "mask",
        }
      : null;
  const maskRefinementRouteFor = (
    prompt: "point" | "interactive_box" | "scribble",
    input: string,
  ) =>
    selectedMaskPromptSource == null
      ? null
      : routing.resolveInteractiveRequest({
          prompt,
          requiredInputs: [input, "mask_prompt"],
          output: "mask",
        });
  const maskRefinementRoutes = {
    point: maskRefinementRouteFor("point", "point_prompt"),
    interactive_box: maskRefinementRouteFor("interactive_box", "bbox_prompt"),
    scribble: maskRefinementRouteFor("scribble", "scribble_prompt"),
  };
  const interactiveBackendId = exactMaskRequirement
    ? routing.resolveInteractiveRequest(exactMaskRequirement)
    : routing.resolveInteractive(activeInteractivePrompt ?? "point");

  // 模型选择必须先于交互请求确定：原生 Mask 的 capability、model_id 与候选
  // receipt 都绑定同一个 active model，不能在请求发出后再从工具栏状态猜测。
  const modelPref = useAiToolModelPref(interactiveBackendId);
  const mlCapabilities = useMLCapabilities(
    projectId ?? null,
    interactiveBackendId,
    modelPref.savedModelId ?? null,
    exactMaskRequirement,
  );
  const activeGeometricOutputs =
    mlCapabilities.activeModel?.supported_geometric_outputs ??
    mlCapabilities.capability?.supported_geometric_outputs ??
    [];
  const activeModelSupportsNativeMask = activeGeometricOutputs.includes("mask");
  const nativeMaskOutputDisabledReason = !activeModelSupportsNativeMask
    ? "当前模型未声明原生 Mask 输出能力"
    : !isVideoTask && imageMaskPersistenceMode !== "native"
      ? "当前图片项目尚未开启原生 Raster Mask 编辑"
      : undefined;
  const activeModelSupportsPromptInput =
    activePromptInput != null && mlCapabilities.isInputSupported(activePromptInput);
  const activeModelSupportsMaskPrompt = mlCapabilities.isInputSupported("mask_prompt");
  const maskRefinementDisabledReason =
    nativeMaskOutputDisabledReason ??
    (!activeModelSupportsMaskPrompt
      ? "当前模型未声明 Mask prompt 输入能力"
      : !activeModelSupportsPromptInput
        ? "当前模型未声明该交互提示输入能力"
        : undefined);
  const canRefineSelectedMask =
    selectedMaskPromptSource != null &&
    exactMaskRequirement != null &&
    interactiveBackendId != null &&
    maskRefinementDisabledReason == null;
  const maskRefinementToolDisabledReason = (prompt: keyof typeof maskRefinementRoutes) =>
    nativeMaskOutputDisabledReason ??
    (maskRefinementRoutes[prompt] == null
      ? "没有模型同时支持该提示、Mask prompt 与原生 Mask 输出"
      : undefined);
  const effectiveSingleFrameOutputGeometry: "polygon" | "mask" =
    activeAiTool !== "magic-box" &&
    (canRefineSelectedMask || singleFrameOutputGeometry === "mask") &&
    nativeMaskOutputDisabledReason == null
      ? "mask"
      : "polygon";
  const samRequestContextDefaults = useMemo<Record<string, unknown>>(
    () => ({
      ...(mlCapabilities.activeModelId ? { model_id: mlCapabilities.activeModelId } : {}),
      output_geometry: effectiveSingleFrameOutputGeometry,
      ...(canRefineSelectedMask &&
      (activeAiTool === "smart-point" ||
        activeAiTool === "smart-box" ||
        activeAiTool === "smart-scribble")
        ? {
            mask_prompt_source: {
              annotation_id: selectedMaskPromptSource.annotation_id,
              source_version: selectedMaskPromptSource.source_version,
            },
          }
        : {}),
    }),
    [
      activeAiTool,
      canRefineSelectedMask,
      effectiveSingleFrameOutputGeometry,
      mlCapabilities.activeModelId,
      selectedMaskPromptSource,
    ],
  );

  // v0.21.4 起视频单题 AI 用它抓当前帧; v0.21.23 交互式 SAM 复用同一取帧口。
  const videoControlsRef = useRef<VideoStageControls | null>(null);
  const maskQcAiCandidateRef = useRef<MaskQcLocalAiCandidate | null>(null);
  const getMaskQcTrackerCandidates = useCallback(
    (issue: MaskQcIssue, targetFrame: number): MaskQcTrackerCandidate[] =>
      collectMaskQcTrackerCandidates(issue, targetFrame, trackerJobs.candidates, trackerJobs.jobs),
    [trackerJobs.candidates, trackerJobs.jobs],
  );
  const maskQcReview = useMaskQcReview({
    enabled: mode === "review",
    taskId,
    annotations: annotationsData,
    annotationsReady,
    visibleAnnotationIds,
    selectedId: s.selectedId,
    isVideoTask,
    videoManifestReady:
      !isVideoTask ||
      (videoManifest.isSuccess &&
        videoManifest.data?.task_id === taskId &&
        (videoManifest.data?.metadata.frame_count ?? 0) > 0),
    frameIndex: s.videoFrameIndex,
    stageGeom,
    workerPool: rasterMaskWorkerPool,
    getAiCandidate: () => maskQcAiCandidateRef.current,
    getTrackerCandidates: getMaskQcTrackerCandidates,
    videoControlsRef,
    selectTask,
    setSelectedId,
    setFrameIndex: s.setVideoFrameIndex,
    setVp,
  });
  const maskCompareInteractionBlocked = maskQcReview.store !== null;

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
    cacheScope: [
      isVideoTask ? videoFrameIndex : "image",
      mlCapabilities.activeModelId ?? "default",
      effectiveSingleFrameOutputGeometry,
      selectedMaskPromptSource
        ? `${selectedMaskPromptSource.annotation_id}@${selectedMaskPromptSource.source_version}`
        : "no-mask-prompt",
    ].join(":"),
    requestContextDefaults: samRequestContextDefaults,
  });
  const samDisplayCandidates = useMemo(
    () => samCandidateDisplayShapes(sam.candidates),
    [sam.candidates],
  );
  const activeMaskQcAiCandidate = sam.candidates[sam.activeIdx];
  maskQcAiCandidateRef.current =
    activeMaskQcAiCandidate?.type === "mask" && taskId
      ? {
          taskId,
          digest: activeMaskQcAiCandidate.candidateId.replace(/^sha256:/, ""),
          rle: activeMaskQcAiCandidate.rle,
          frameIndex: activeMaskQcAiCandidate.frameIndex,
          refineSource: activeMaskQcAiCandidate.refineSource,
        }
      : null;
  const samMaskCandidateDescriptors = useMemo(
    () =>
      sam.candidates.flatMap((candidate, index) => {
        if (candidate.type !== "mask" || index !== sam.activeIdx) return [];
        return [
          {
            id: candidate.id,
            source: "interactive" as const,
            ref: {
              size: candidate.rle.size,
              sha256: candidate.candidateId.replace(/^sha256:/, ""),
            },
            revision: candidate.promptRevision,
            color: "#a855f7",
            colorRevision: "sam-mask-purple",
            zOrder: index,
            selected: index === sam.activeIdx,
            load: async () => candidate.rle,
          },
        ];
      }),
    [sam.activeIdx, sam.candidates],
  );
  const samMaskScopeKey =
    samMaskCandidateDescriptors.length > 0 && taskId
      ? [
          taskId,
          isVideoTask ? videoFrameIndex : "image",
          samMaskCandidateDescriptors.map((item) => item.revision).join(","),
        ].join(":")
      : null;
  const samMaskCandidates = useRasterMaskRecords({
    scopeKey: samMaskScopeKey,
    descriptors: samMaskCandidateDescriptors,
    maxCacheBytes: 32 * 1024 * 1024,
    maxCachedRecords: 1,
    maxConcurrent: 1,
    workerPool: rasterMaskWorkerPool,
  });
  const samCandidateDisplayGeom = useCallback(
    (candidate: PendingCandidate | undefined) => {
      const direct = samCandidateGeom(candidate);
      if (direct) return direct;
      if (candidate?.type !== "mask") return null;
      return samMaskCandidates.records.find((item) => item.id === candidate.id)?.bounds ?? null;
    },
    [samMaskCandidates.records],
  );
  const selectSamCandidateByIndex = sam.select;
  const selectSamMaskCandidate = useCallback(
    (candidateId: string) => {
      const index = sam.candidates.findIndex((candidate) => candidate.id === candidateId);
      if (index >= 0) selectSamCandidateByIndex(index);
    },
    [sam.candidates, selectSamCandidateByIndex],
  );

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
        setTrackerSeedBoxes((prev) => [...prev, { bbox: prompt.bbox, obj: seedObj, frame }]);
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
      interactiveBackendId ? (currentProject?.default_variants?.[interactiveBackendId] ?? {}) : {},
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
    [
      interactiveBackendId,
      interactiveVariantGroups,
      currentProject?.default_variants,
      updateProjectMu,
    ],
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
    const previousPrompt = prevToolPromptRef.current;
    const changed = previousPrompt !== nextPrompt;
    prevToolPromptRef.current = nextPrompt;
    const maskRefinementPrompts = new Set(["point", "interactive_box", "scribble"]);
    const continuesMaskRefinement =
      canRefineSelectedMask &&
      previousPrompt != null &&
      nextPrompt != null &&
      maskRefinementPrompts.has(previousPrompt) &&
      maskRefinementPrompts.has(nextPrompt);
    if (changed && !continuesMaskRefinement) sam.cancel();
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
    if (s.tool !== "smart-scribble" || canRefineSelectedMask) return;
    s.setTool("select");
    sam.cancel();
    pushToast({
      msg: "智能笔迹已结束",
      sub: "请先选中一个已保存、未锁定的原生 Mask",
      kind: "warning",
    });
    // sam / s 为壳层聚合对象，仅按实际门控状态触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRefineSelectedMask, s.tool]);
  useEffect(() => {
    if (!isVideoTask) return;
    if (tool !== "box" && tool !== "select") setTool("box");
  }, [isVideoTask, tool, setTool]);

  const { conflictOpen, setConflictOpen, handleConflictReload, handleConflictOverwrite } =
    useConflictResolution(conflictCbRef, queryClient, taskId);

  useEffect(() => {
    const idx = tasks.findIndex((t) => t.id === taskId);
    const prefetch = (t: TaskResponse | undefined) => {
      if (!t) return;
      queryClient.prefetchQuery({
        queryKey: ["annotations", t.id],
        queryFn: () => tasksApi.getAnnotations(t.id),
      });
      queryClient.prefetchInfiniteQuery({
        queryKey: ["predictions", t.id, undefined, debouncedConf, 100],
        initialPageParam: 0,
        queryFn: () => predictionsApi.listByTask(t.id, undefined, debouncedConf, 100, 0),
      });
      if (stageKind === "image" && t.image_pyramid && LARGE_IMAGE_TILES_ENABLED) {
        void queryClient
          .fetchQuery({
            queryKey: ["image-pyramid", t.id, t.image_pyramid.generation],
            queryFn: ({ signal }) => tasksApi.getImagePyramid(t.id, { signal }),
            staleTime: 30_000,
          })
          .then((pyramid) => {
            if (!pyramid.overview?.url) return;
            const img = new Image();
            img.src = pyramid.overview.url;
          })
          .catch(() => {});
      } else if (stageKind === "image" && t.file_url && !t.image_pyramid?.required) {
        const deviceMemory = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
        const budget = imageTileDeviceBudget(
          typeof deviceMemory === "number" ? deviceMemory : null,
        ).retainedBytes;
        const width = t.image_pyramid?.width ?? t.image_width;
        const height = t.image_pyramid?.height ?? t.image_height;
        const originalAllowed = t.image_pyramid
          ? singleImageFitsDecodedBudget(width, height, budget)
          : width && height
            ? singleImageFitsDecodedBudget(width, height, budget)
            : true;
        const url = t.thumbnail_url ?? (originalAllowed ? t.file_url : null);
        if (!url) return;
        const img = new Image();
        img.src = url;
      }
    };
    prefetch(tasks[idx + 1]);
    prefetch(tasks[idx - 1]);
  }, [taskId, tasks, queryClient, debouncedConf, stageKind]);

  const aiRunning =
    preannotationProgress?.status === "running" ||
    triggerPreannotation.isPending ||
    videoFrameAiRunning;

  const currentBatchStatus = useMemo<string | undefined>(() => {
    if (!task?.batch_id || !batchList) return undefined;
    return batchList.find((b) => b.id === task.batch_id)?.status;
  }, [task?.batch_id, batchList]);

  const history = useAnnotationHistory(taskId, {
    createAnnotation: (payload) => createAnnotation.mutateAsync(payload),
    deleteAnnotation: (id) => deleteAnnotationMut.mutateAsync(id),
    updateAnnotation: (id, payload) => {
      const cached = queryClient.getQueryData<AnnotationResponse[]>(["annotations", taskId]);
      const current =
        cached?.find((annotation) => annotation.id === id) ??
        annotationsRef.current.find((annotation) => annotation.id === id);
      const previousType = current?.geometry.type;
      const nextType = payload.geometry?.type;
      const requiresPrecondition =
        !!nextType &&
        (previousType !== nextType || nextType === "raster_mask" || nextType === "video_mask");
      const etag =
        requiresPrecondition && current?.version != null ? `W/"${current.version}"` : undefined;
      return updateAnnotationMut.mutateAsync({ annotationId: id, payload, etag });
    },
    updateVideoKeyframe: async (id, frameIndex, keyframe) => {
      const ann = annotationsRef.current.find((a) => a.id === id);
      if (!ann || ann.geometry.type !== "video_track_bbox")
        throw new Error("Video track not found");
      const geometry = applyVideoKeyframeToGeometry(ann.geometry, frameIndex, keyframe);
      await updateAnnotationMut.mutateAsync({ annotationId: id, payload: { geometry } });
    },
    updateVideoMaskFrame: async (id: string, frameIndex: number, target: VideoMaskFrameState) => {
      if (!taskId) throw new Error("Task is not available");
      const cached = queryClient.getQueryData<AnnotationResponse[]>(["annotations", taskId]);
      const current =
        cached?.find((annotation) => annotation.id === id) ??
        annotationsRef.current.find((annotation) => annotation.id === id);
      if (!current || current.geometry.type !== "video_track_mask" || current.version == null) {
        throw new Error("Video Mask track not found");
      }
      let updated = current;
      const exact =
        current.geometry.keyframes.find((item) => item.frame_index === frameIndex) ?? null;
      const sameKeyframe = (left: VideoTrackMaskKeyframe, right: VideoTrackMaskKeyframe) =>
        left.mask.sha256 === right.mask.sha256 &&
        left.source === right.source &&
        Boolean(left.occluded) === Boolean(right.occluded) &&
        JSON.stringify(left.attributes ?? null) === JSON.stringify(right.attributes ?? null);
      if (target.keyframe && (!exact || !sameKeyframe(exact, target.keyframe))) {
        updated = await videoTrackerApi.saveMaskKeyframe(
          taskId,
          id,
          frameIndex,
          target.keyframe.mask,
          Number(updated.version),
          {
            source: target.keyframe.source,
            occluded: target.keyframe.occluded,
            attributes: target.keyframe.attributes,
          },
        );
      } else if (!target.keyframe && exact) {
        updated = await videoTrackerApi.operateMaskKeyframe(
          taskId,
          id,
          frameIndex,
          "delete_keyframe",
          Number(updated.version),
        );
      }
      const manualOutside =
        updated.geometry.type === "video_track_mask" &&
        (updated.geometry.outside ?? []).some(
          (range) =>
            range.source !== "prediction" && range.from <= frameIndex && frameIndex <= range.to,
        );
      if (manualOutside !== target.manualOutside) {
        updated = await videoTrackerApi.operateMaskKeyframe(
          taskId,
          id,
          frameIndex,
          target.manualOutside ? "mark_outside" : "restore_held",
          Number(updated.version),
        );
      }
      queryClient.setQueryData<AnnotationResponse[]>(["annotations", taskId], (items) =>
        (items ?? []).map((item) => (item.id === id ? updated : item)),
      );
      return updated;
    },
    removeLocalCreate: async (id: string) => {
      if (!taskId) return;
      queryClient.setQueryData<AnnotationResponse[]>(["annotations", taskId], (prev) =>
        (prev ?? []).filter((a) => a.id !== id),
      );
      const all = await offlineQueueGetAll();
      const target = all.find((op) => op.kind === "create" && op.tmpId === id);
      if (target) await offlineQueueRemoveById(target.id);
    },
    // v0.20.22 · accept undo 防御过滤依赖 (改动 1.5): annotationsRef 已含全量当前标注,
    // undo 时按 id 查 parent_prediction_id, 只删本 predictionId 派生的那批。
    getAnnotation: (id) => annotationsRef.current.find((a) => a.id === id) ?? null,
  });
  const acceptNativeMaskCandidate = useAcceptNativeMaskCandidate({
    taskId,
    queryClient,
    history,
  });

  const { avgMs } = useSessionStats(taskId ?? null, projectId ?? null, "annotate");
  const remainingTaskCount = useMemo(() => {
    if (!tasks.length) return 0;
    return tasks.filter((t) => t.status !== "completed" && t.id !== taskId).length;
  }, [tasks, taskId]);

  const offlineQ = useWorkbenchOfflineQueue({ history, queryClient, pushToast });
  const {
    online,
    queueCount,
    enqueueOnError,
    flushOne: executeOp,
    flushAll: flushOffline,
    drawerOpen: offlineDrawerOpen,
    openDrawer: openOfflineDrawer,
    closeDrawer: closeOfflineDrawer,
  } = offlineQ;

  const isLockedForActions =
    mode === "review"
      ? task?.status === "completed" || !!lockConflict || !!lockError
      : task?.status === "review" || task?.status === "completed" || !!lockConflict || !!lockError;
  const maskEditorSize = resolveMaskEditorSize(
    isVideoTask,
    stageGeom,
    videoManifest.data?.metadata,
  );
  // v0.23.5 · WS-B · mask 编辑会话键: task + frame + selection + annotation version。
  // sessionKey 变化 → useMaskEditorSession 自增 generation, 隔离迟到 GET 回包 (A1)。
  const maskSessionSelection = s.selectedId ?? "blank";
  const maskSessionAnnotationVersion = useMemo(() => {
    if (!s.selectedId) return undefined;
    return annotationsData?.find((a) => a.id === s.selectedId)?.version;
  }, [annotationsData, s.selectedId]);
  const maskSessionKey = useMemo<MaskSessionKey>(
    () => ({
      taskId,
      frameIndex: isVideoTask ? s.videoFrameIndex : 0,
      toolKey: isVideoTask ? `video:${s.videoTool}` : `image:${s.tool}`,
      routeKey: currentPath,
      selectionKey: maskSessionSelection,
      annotationVersion: maskSessionAnnotationVersion,
    }),
    [
      taskId,
      isVideoTask,
      s.videoFrameIndex,
      s.videoTool,
      s.tool,
      currentPath,
      maskSessionSelection,
      maskSessionAnnotationVersion,
    ],
  );
  const maskPhaseStateRef = useRef<"idle" | "loading" | "ready" | "dirty" | "saving" | "error">(
    "idle",
  );
  const commitCurrentMaskRef = useRef<() => Promise<boolean>>(async () => false);
  // 离开 dirty session 必须先取得明确决定。取消即恢复旧 task/frame/tool/selection，
  // 确认才丢弃；session hook 仅在 guard 完成后推进 generation。
  const handleMaskLeaveDirty = useCallback(
    async (previous: MaskSessionKey, next: MaskSessionKey) => {
      const applyContext = (key: MaskSessionKey) => {
        if (key.taskId) setCurrentTaskId(key.taskId);
        setVideoFrameIndex(key.frameIndex);
        setSelectedId(key.selectionKey === "blank" ? null : key.selectionKey);
        const [toolScope, targetTool] = (key.toolKey ?? "").split(":", 2);
        if (toolScope === "video" && targetTool) setVideoTool(targetTool as VideoTool);
        if (toolScope === "image" && targetTool) s.setTool(targetTool as ToolId);
        if (key.routeKey && key.routeKey !== currentPath) navigate(key.routeKey, { replace: true });
      };
      pushToast({
        msg: "有未保存的 Mask 稿件",
        sub: "确认可丢弃；取消将继续编辑",
        kind: "warning",
      });
      if (maskPhaseStateRef.current === "saving" || maskInstanceTransitionInFlightRef.current) {
        pushToast({ msg: "Mask 正在保存", sub: "保存完成后再离开", kind: "warning" });
        applyContext(previous);
        return "continue" as const;
      }
      const choice = promptMaskLeaveChoice((message) => window.confirm(message));
      if (choice === "save") {
        // 先回到旧上下文再提交，避免把旧 Buffer 落到新 task/frame/selection。
        applyContext(previous);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        const saved = await commitCurrentMaskRef.current();
        if (saved) {
          applyContext(next);
          return "save" as const;
        }
      }
      if (choice === "discard") return "discard" as const;

      // continue 必须真正留在旧上下文，不能只保留一块已错配到新帧/新题的 Buffer。
      applyContext(previous);
      return "continue" as const;
    },
    [
      currentPath,
      navigate,
      pushToast,
      s,
      setCurrentTaskId,
      setSelectedId,
      setVideoFrameIndex,
      setVideoTool,
    ],
  );
  const maskEditor = useMaskEditorSession({
    ...maskEditorSize,
    sessionKey: maskSessionKey,
    onLeaveDirty: handleMaskLeaveDirty,
    workerPool: rasterMaskWorkerPool,
  });
  const maskSessionContextRef = useRef({
    key: maskSessionKey,
    generation: maskEditor.generation,
  });
  maskSessionContextRef.current = {
    key: maskSessionKey,
    generation: maskEditor.generation,
  };
  maskPhaseStateRef.current = maskEditor.phase;
  const hasPendingMaskDraft = maskEditor.dirty || maskEditor.instanceOperationPreview !== null;
  maskNavigationGuardRef.current = async () => {
    if (maskInstanceTransitionInFlightRef.current) {
      pushToast({ msg: "Mask 正在处理", sub: "完成后再离开", kind: "warning" });
      return false;
    }
    if (!maskEditor.active || !hasPendingMaskDraft) return true;
    if (maskEditor.phase === "saving") {
      pushToast({ msg: "Mask 正在保存", sub: "保存完成后再离开", kind: "warning" });
      return false;
    }
    const choice = promptMaskLeaveChoice((message) => window.confirm(message));
    if (choice === "continue") return false;
    if (choice === "save") return commitCurrentMaskRef.current();
    if (maskInstanceTransitionInFlightRef.current) return false;
    maskEditor.cancel();
    return true;
  };
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!maskInstanceTransitionBusy && (!maskEditor.active || !hasPendingMaskDraft)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasPendingMaskDraft, maskEditor.active, maskInstanceTransitionBusy]);

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
    samMaskRecords: samMaskCandidates.records,
    acceptNativeMask: acceptNativeMaskCandidate,
    createAnnotationAsync: (payload) => createAnnotation.mutateAsync(payload),
    updateAnnotationAsync: (annotationId, payload, etag) =>
      updateAnnotationMut.mutateAsync({ annotationId, payload, etag }),
    isLocked: isLockedForActions,
    enqueueOnError,
    maskEditor,
    maskPersistenceMode: imageMaskPersistenceMode,
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
    batchChangeToolUnitId,
    setBatchChanging,
    batchChangeTarget,
    samPendingGeom,
    samDefaultClass,
    handlePickMaskPendingClass,
    handleCancelMaskPendingClass,
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
  const imageContextMenuClipboard = useMemo(
    () => ({
      copyAnnotation: (annotation: Annotation) => clipboard.copyAnnotations([annotation]),
      paste: clipboard.paste,
      hasClipboard: clipboard.hasClipboard,
    }),
    [clipboard],
  );

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
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
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

  const handleSelectBox = useCallback(
    (id: string | null, opts?: { shift?: boolean }) => {
      if (!id) {
        s.setSelectedId(null);
        return;
      }
      const isUserBox = annotationsRef.current.some((a) => a.id === id);
      if (opts?.shift && isUserBox) {
        s.toggleSelected(id);
      } else {
        s.setSelectedId(id);
      }
    },
    [s],
  );

  const enterImageRasterMaskEdit = useCallback(
    (id: string) => {
      if (!s.selectedIds.includes(id)) {
        s.setSelectedId(id);
      } else if (s.selectedId !== id) {
        // 编辑对象成为 primary，但保留 Shift 多选集合，供 join 预览消费。
        s.replaceSelected([...s.selectedIds.filter((selectedId) => selectedId !== id), id]);
      }
      s.setTool("mask");
    },
    [s],
  );

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
    () => selectProjectPipelineStages(projectPipelinesQ.data, currentProject?.preannotate_pipeline),
    [projectPipelinesQ.data, currentProject?.preannotate_pipeline],
  );
  const hasProjectPipeline = (projectPipeline?.length ?? 0) > 0;
  const projectPipelineStageCount = projectPipeline?.length ?? 0;
  // claude[bot] P1 #5 · 编排引用的 backend 被删/停时, popover 入口该不可点 + 弹明确原因, 而非默默 422。
  // 复用上面已拉的 backends 列表 (line ~199 backendsQ), 不重复 query。
  const availableBackendIds = useMemo(() => new Set<string>(backends.map((b) => b.id)), [backends]);
  const pipelineMissingBackends = useMemo(
    () => missingBackendIdsForStages(projectPipeline, availableBackendIds),
    [projectPipeline, availableBackendIds],
  );
  const projectPipelineRunnable = hasProjectPipeline && pipelineMissingBackends.length === 0;
  const handleRunAiPipeline = useCallback(() => {
    if (pipelineMissingBackends.length > 0) {
      pushToast({
        msg: "项目编排引用的后端不可用",
        sub: `请到「AI 预标」修编排或重新注册 ${pipelineMissingBackends.length} 个后端`,
        kind: "warning",
      });
      return;
    }
    const payload = buildPipelineRunPayload(projectPipeline, taskId, availableBackendIds);
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
    handleCancelVideoMaskPendingClass,
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
    activeToolHasOwnClasses: toolView.hasOwnClasses,
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
  const selectedVideoSingleMask = useMemo(() => {
    const annotation = visibleAnnotationsData.find((item) => item.id === s.selectedId);
    return annotation &&
      isVideoMask(annotation) &&
      annotation.geometry.frame_index === s.videoFrameIndex
      ? annotation
      : null;
  }, [s.selectedId, s.videoFrameIndex, visibleAnnotationsData]);
  const selectedVideoMaskForTool =
    s.videoTool === "mask-track"
      ? selectedVideoMask
      : s.videoTool === "mask"
        ? selectedVideoSingleMask
        : null;
  const selectedImageRasterMask = useMemo(() => {
    if (isVideoTask) return null;
    const annotation = visibleAnnotationsData.find((item) => item.id === s.selectedId);
    return annotation?.geometry.type === "raster_mask" ? annotation : null;
  }, [isVideoTask, s.selectedId, visibleAnnotationsData]);
  const selectedImageRasterMaskFingerprint = selectedImageRasterMask
    ? `${selectedImageRasterMask.id}:${selectedImageRasterMask.version ?? 0}:${
        selectedImageRasterMask.geometry.type === "raster_mask"
          ? selectedImageRasterMask.geometry.mask.sha256
          : ""
      }`
    : "";
  const selectedVideoMaskFingerprint = selectedVideoMaskForTool
    ? `${selectedVideoMaskForTool.id}:${selectedVideoMaskForTool.version ?? 0}:${selectedVideoMaskForTool.updated_at ?? ""}:${s.videoFrameIndex}`
    : "";
  const maskLoadRle = maskEditor.loadRle;
  const maskLoadBlank = maskEditor.loadBlank;
  const maskFailLoad = maskEditor.failLoad;
  const maskMarkReady = maskEditor.markReady;
  const maskGeneration = maskEditor.generation;
  const maskAcceptedSessionId = maskEditor.acceptedSessionId;
  const maskRequestedSessionId = maskEditor.sessionId;
  useEffect(() => {
    if (maskInstanceTransitionInFlightRef.current || maskInstanceTransitionBusy) return;
    if (maskAcceptedSessionId !== maskRequestedSessionId) return;
    if (!isVideoTask) {
      if (s.tool !== "mask" || maskEditor.phase !== "loading") return;
      if (maskCapabilities.isPending) return;
      if (imageMaskPersistenceMode === "blocked") {
        const error = new Error(
          maskCapabilities.isError ? "Mask 写入能力加载失败" : "当前任务未开启 Mask 写入",
        );
        maskFailLoad(maskGeneration, error);
        return;
      }
      if (selectedImageRasterMask) {
        if (imageMaskPersistenceMode !== "native") {
          const error = new Error("当前任务未开启原生 Mask 编辑");
          maskFailLoad(maskGeneration, error);
          pushToast({ msg: "Mask 为只读", sub: error.message, kind: "warning" });
          return;
        }
        const gen = maskGeneration;
        void rasterMasksApi
          .annotationRasterMaskContent(selectedImageRasterMask.id)
          .then((rle) => maskLoadRle(gen, rle))
          .catch((error: unknown) => {
            maskFailLoad(gen, error);
            pushToast({ msg: "Mask 内容加载失败", sub: String(error), kind: "error" });
          });
        return;
      }
      if (maskEditor.active) maskMarkReady(maskGeneration);
      else maskLoadBlank(maskGeneration);
      return;
    }
    if (s.videoTool !== "mask" && s.videoTool !== "mask-track") return;
    if (maskEditor.phase !== "loading") return;
    if (!selectedVideoMaskForTool) {
      maskLoadBlank(maskGeneration);
      return;
    }
    // v0.23.5 · WS-B/A1 · 捕获本次加载的 generation, 交给 loadRle/loadBlank 隔离迟到回包。
    // sessionKey 变化时 useMaskEditorSession 已自增 generation, 旧 gen 的回包被静默丢弃,
    // 不会覆盖用户在新帧上落笔后的 Buffer。
    const gen = maskGeneration;
    const loadMask =
      selectedVideoMaskForTool.geometry.type === "video_mask"
        ? rasterMasksApi.annotationRasterMaskContent(selectedVideoMaskForTool.id)
        : rasterMasksApi.annotationVideoMaskContent(selectedVideoMaskForTool.id, s.videoFrameIndex);
    void loadMask
      .then((rle) => {
        maskLoadRle(gen, rle);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          maskLoadBlank(gen);
          return;
        }
        maskFailLoad(gen, error);
        pushToast({ msg: "Mask 内容加载失败", sub: String(error), kind: "error" });
      });
  }, [
    isVideoTask,
    maskAcceptedSessionId,
    maskRequestedSessionId,
    maskLoadRle,
    maskLoadBlank,
    maskFailLoad,
    maskMarkReady,
    maskGeneration,
    maskEditor.active,
    maskEditor.phase,
    imageMaskPersistenceMode,
    maskCapabilities.isError,
    maskCapabilities.isPending,
    maskInstanceTransitionBusy,
    pushToast,
    s.tool,
    s.videoFrameIndex,
    s.videoTool,
    selectedImageRasterMask,
    selectedImageRasterMaskFingerprint,
    selectedVideoMaskForTool,
    selectedVideoMaskFingerprint,
  ]);

  const editingImageRasterMaskId =
    !isVideoTask &&
    s.tool === "mask" &&
    selectedImageRasterMask &&
    maskEditor.active &&
    maskEditor.phase !== "loading"
      ? selectedImageRasterMask.id
      : null;
  const imageMaskInteractionBlocked =
    !isVideoTask &&
    (imageMaskPersistenceMode === "blocked" ||
      (!!selectedImageRasterMask && imageMaskPersistenceMode !== "native"));
  const retryImageMaskSession = useCallback(() => {
    if (imageMaskPersistenceMode === "blocked") {
      const gen = maskGeneration;
      void maskCapabilities
        .refetch()
        .then(({ data }) => {
          if (data?.write_enabled !== true && data?.legacy_polygon_commit_enabled !== true) {
            maskFailLoad(gen, new Error("当前任务未开启 Mask 写入"));
            return;
          }
          if (selectedImageRasterMask) {
            if (data.write_enabled !== true) {
              maskFailLoad(gen, new Error("当前任务未开启原生 Mask 编辑"));
              return;
            }
            void rasterMasksApi
              .annotationRasterMaskContent(selectedImageRasterMask.id)
              .then((rle) => maskLoadRle(gen, rle))
              .catch((error: unknown) => maskFailLoad(gen, error));
            return;
          }
          maskLoadBlank(gen);
        })
        .catch((error: unknown) => maskFailLoad(gen, error));
      return;
    }
    if (selectedImageRasterMask && !maskEditor.active) {
      const gen = maskGeneration;
      void rasterMasksApi
        .annotationRasterMaskContent(selectedImageRasterMask.id)
        .then((rle) => maskLoadRle(gen, rle))
        .catch((error: unknown) => {
          maskFailLoad(gen, error);
          pushToast({ msg: "Mask 内容加载失败", sub: String(error), kind: "error" });
        });
      return;
    }
    maskEditor.recoverFromError();
  }, [
    imageMaskPersistenceMode,
    maskCapabilities,
    maskEditor,
    maskFailLoad,
    maskGeneration,
    maskLoadBlank,
    maskLoadRle,
    pushToast,
    selectedImageRasterMask,
  ]);
  const [maskConversionRequest, setMaskConversionRequest] =
    useState<MaskConversionDialogRequest | null>(null);
  const openAnnotationConversion = useCallback(
    (annotationIds: string | string[]) => {
      const ids = Array.isArray(annotationIds) ? annotationIds : [annotationIds];
      const annotations = ids
        .map((id) => annotationsRef.current.find((item) => item.id === id))
        .filter((item): item is AnnotationResponse => item !== undefined);
      if (!taskId || annotations.length !== ids.length) {
        pushToast({ msg: "转换条件未就绪", sub: "请刷新标注后重试", kind: "warning" });
        return;
      }
      const sourceTypes = new Set(annotations.map((item) => item.geometry.type));
      if (sourceTypes.size !== 1) {
        pushToast({ msg: "批量转换要求来源类型一致", kind: "warning" });
        return;
      }
      if (isLockedForActions || annotations.some((item) => item.is_locked)) {
        pushToast({ msg: "锁定或只读对象不能转换", kind: "warning" });
        return;
      }
      const sourceType = annotations[0].geometry.type;
      const supported = new Set([
        "polygon",
        "multi_polygon",
        "raster_mask",
        "video_polygon",
        "video_track_polygon",
        "video_track_mask",
      ]);
      if (!supported.has(sourceType)) {
        pushToast({ msg: "当前几何类型暂不支持转换", sub: sourceType, kind: "warning" });
        return;
      }
      const singleFrameIndexes = annotations
        .filter((item) => item.geometry.type === "video_polygon")
        .map((item) =>
          item.geometry.type === "video_polygon" ? item.geometry.frame_index : s.videoFrameIndex,
        );
      if (new Set(singleFrameIndexes).size > 1) {
        pushToast({ msg: "视频单帧批量转换要求对象位于同一帧", kind: "warning" });
        return;
      }
      setMaskConversionRequest({
        taskId,
        annotationIds: ids,
        sourceType,
        ...(sourceType.startsWith("video_")
          ? { frameIndex: singleFrameIndexes[0] ?? s.videoFrameIndex }
          : {}),
      });
    },
    [isLockedForActions, pushToast, s.videoFrameIndex, taskId],
  );
  const completeAnnotationConversion = useCallback(
    async (result: AnnotationConversionExecuteResponse) => {
      await queryClient.invalidateQueries({ queryKey: ["annotations", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      const selected = result.created_annotations[0] ?? result.updated_annotations[0];
      if (selected) s.setSelectedId(selected.id);
      pushToast({
        msg: "转换已完成",
        sub: `${result.report.source_count} 个来源 · ${result.report.result_count} 个结果`,
        kind: "success",
      });
    },
    [pushToast, queryClient, s, taskId],
  );

  const cancelVideoMaskEdit = useCallback(() => {
    if (maskInstanceTransitionInFlightRef.current) {
      pushToast({ msg: "Mask 正在处理", sub: "完成后再取消", kind: "warning" });
      return;
    }
    if (handleCancelVideoMaskPendingClass()) return;
    maskEditor.cancel();
    s.setVideoTool("select");
  }, [handleCancelVideoMaskPendingClass, maskEditor, pushToast, s]);
  const cancelImageMaskEdit = useCallback(() => {
    if (maskInstanceTransitionInFlightRef.current) {
      pushToast({ msg: "Mask 正在处理", sub: "完成后再取消", kind: "warning" });
      return;
    }
    if (handleCancelMaskPendingClass()) return;
    cancelMaskEdit();
  }, [cancelMaskEdit, handleCancelMaskPendingClass, pushToast]);
  const [videoMaskCorrectionOpen, setVideoMaskCorrectionOpen] = useState(false);
  const [videoMaskCorrectionSubmitting, setVideoMaskCorrectionSubmitting] = useState(false);
  const [videoMaskCorrectionContext, setVideoMaskCorrectionContext] = useState<{
    annotationId: string;
    frameIndex: number;
    sessionId: string;
    segmentId?: string;
    segmentStart: number;
    segmentEnd: number;
  } | null>(null);
  const [savedVideoMaskCorrection, setSavedVideoMaskCorrection] = useState<Awaited<
    ReturnType<typeof handleVideoMaskCommit>
  > | null>(null);
  const [videoMaskCorrectionCreateError, setVideoMaskCorrectionCreateError] = useState<
    string | null
  >(null);
  const [videoMaskCorrectionCreateRetryable, setVideoMaskCorrectionCreateRetryable] =
    useState(true);
  const currentVideoSegment = useMemo(
    () =>
      videoSegmentsQuery.data?.segments.find(
        (segment) =>
          segment.start_frame <= s.videoFrameIndex && s.videoFrameIndex <= segment.end_frame,
      ) ?? null,
    [s.videoFrameIndex, videoSegmentsQuery.data?.segments],
  );
  const pendingMaskAtomicDraftRef = useRef<PendingMaskAtomicDraft | null>(null);
  const maskAtomicIdempotencyRef = useRef<{
    previewId: number;
    key: string;
    payload: MaskMutationCommitRequest | null;
  } | null>(null);
  const [maskInstanceCommitError, setMaskInstanceCommitError] = useState<string | null>(null);
  const [maskInstanceRecovery, setMaskInstanceRecovery] = useState<MaskMutationRecovery>({
    retry: false,
    refresh: false,
  });
  const [maskInstanceDeleteConfirmOpen, setMaskInstanceDeleteConfirmOpen] = useState(false);
  const clearMaskInstanceFailure = useCallback(() => {
    setMaskInstanceCommitError(null);
    setMaskInstanceRecovery({ retry: false, refresh: false });
  }, []);
  const showMaskInstanceFailure = useCallback(
    (message: string, recovery: MaskMutationRecovery = { retry: false, refresh: false }) => {
      setMaskInstanceCommitError(message);
      setMaskInstanceRecovery(recovery);
    },
    [],
  );
  const currentSelectedNativeMask = useCallback(() => {
    if (!s.selectedId) return null;
    const annotation = annotationsRef.current.find((item) => item.id === s.selectedId);
    if (!annotation) return null;
    if (isVideoTask) {
      return annotation.geometry.type === "video_track_mask" ? annotation : null;
    }
    return annotation.geometry.type === "raster_mask" ? annotation : null;
  }, [isVideoTask, s.selectedId]);
  const nativeMaskTrackLocallyLocked = useCallback(
    (annotation: AnnotationResponse) =>
      isVideoTask &&
      annotation.geometry.type === "video_track_mask" &&
      s.lockedVideoTrackIds.has(annotation.geometry.track_id),
    [isVideoTask, s.lockedVideoTrackIds],
  );

  const snapshotMaskMembers = useCallback(
    (members: readonly AnnotationResponse[]) => members.map((annotation) => ({ ...annotation })),
    [],
  );

  useEffect(() => {
    if (maskEditor.instanceOperationPreview) return;
    pendingMaskAtomicDraftRef.current = null;
    maskAtomicIdempotencyRef.current = null;
    setMaskInstanceDeleteConfirmOpen(false);
    clearMaskInstanceFailure();
  }, [clearMaskInstanceFailure, maskEditor.instanceOperationPreview]);

  const loadNativeMaskRle = useCallback(
    (annotation: AnnotationResponse) => {
      if (annotation.geometry.type === "raster_mask") {
        return rasterMasksApi.annotationRasterMaskContent(annotation.id);
      }
      if (annotation.geometry.type === "video_track_mask") {
        return rasterMasksApi.annotationVideoMaskContent(annotation.id, s.videoFrameIndex);
      }
      return Promise.reject(new Error("对象不是原生 Mask"));
    },
    [s.videoFrameIndex],
  );

  const prepareMaskJoin = useCallback(
    async (requestedMode: "replace_sources" | "preserve_sources" = "replace_sources") => {
      const joinMode = isVideoTask ? "preserve_sources" : requestedMode;
      const primary = currentSelectedNativeMask();
      const primaryRle = maskEditor.commitToRle();
      if (isVideoTask && !currentVideoSegment) {
        pushToast({ msg: "无法合并 Mask", sub: "当前帧没有可编辑分段", kind: "warning" });
        return;
      }
      if (!primary || !primaryRle || primary.is_locked || nativeMaskTrackLocallyLocked(primary)) {
        pushToast({ msg: "无法合并 Mask", sub: "请先选中可编辑的原生 Mask", kind: "warning" });
        return;
      }
      const selectedIds = [primary.id, ...s.selectedIds.filter((id) => id !== primary.id)];
      const selectedSources = selectedIds
        .map((id) => annotationsRef.current.find((item) => item.id === id))
        .filter((item): item is AnnotationResponse => !!item);
      const sources = selectedSources
        .filter((item) => item.class_name === primary.class_name)
        .filter((item) =>
          isVideoTask
            ? item.geometry.type === "video_track_mask" &&
              resolveVideoMaskTrackAtFrame(item.geometry, s.videoFrameIndex) !== null
            : item.geometry.type === "raster_mask",
        );
      if (sources.length < 2 || sources.length !== selectedIds.length) {
        pushToast({ msg: "至少选择两个当前可见的同类 Mask", kind: "warning" });
        return;
      }
      if (sources.some((item) => item.is_locked || nativeMaskTrackLocallyLocked(item))) {
        pushToast({ msg: "已选 Mask 中存在锁定对象", kind: "warning" });
        return;
      }
      const scope: MaskMutationScope = {
        media: isVideoTask ? "video" : "image",
        frame_index: isVideoTask ? s.videoFrameIndex : null,
        segment_id: isVideoTask ? (currentVideoSegment?.id ?? null) : null,
        instance_filter: "same_class",
        class_name: primary.class_name,
        overlap_policy: "allow",
        strict_non_overlap: false,
      };
      const members = maskMutationScopeMembers(annotationsRef.current, scope);
      try {
        maskMutationExpectedVersions(members);
        const rles = await Promise.all(
          sources.map((item) =>
            item.id === primary.id ? Promise.resolve(primaryRle) : loadNativeMaskRle(item),
          ),
        );
        const [height, width] = primaryRle.size;
        const plan = planMaskJoin(rles.map(decodeCocoRle), width, height);
        if (!maskEditor.previewInstanceOperation("join_masks", plan)) return;
        pendingMaskAtomicDraftRef.current = {
          kind: "join_masks",
          sourceIds: sources.map((item) => item.id),
          scope,
          members: snapshotMaskMembers(members),
          joinMode,
        };
        maskAtomicIdempotencyRef.current = null;
        clearMaskInstanceFailure();
      } catch (error) {
        pushToast({
          msg: "Mask 合并预览失败",
          sub: maskMutationErrorMessage(error),
          kind: "error",
        });
      }
    },
    [
      clearMaskInstanceFailure,
      currentSelectedNativeMask,
      currentVideoSegment,
      isVideoTask,
      loadNativeMaskRle,
      maskEditor,
      nativeMaskTrackLocallyLocked,
      pushToast,
      s.selectedIds,
      s.videoFrameIndex,
      snapshotMaskMembers,
    ],
  );

  const prepareMaskOverlap = useCallback(
    async (policy: "erase_same_class" | "erase_all") => {
      const primary = currentSelectedNativeMask();
      const primaryRle = maskEditor.commitToRle();
      if (isVideoTask && !currentVideoSegment) {
        pushToast({ msg: "无法生成非重叠预览", sub: "当前帧没有可编辑分段", kind: "warning" });
        return;
      }
      if (!primary || !primaryRle || primary.is_locked || nativeMaskTrackLocallyLocked(primary)) {
        pushToast({ msg: "无法生成非重叠预览", sub: "请先选中可编辑的原生 Mask", kind: "warning" });
        return;
      }
      const scope: MaskMutationScope = {
        media: isVideoTask ? "video" : "image",
        frame_index: isVideoTask ? s.videoFrameIndex : null,
        segment_id: isVideoTask ? (currentVideoSegment?.id ?? null) : null,
        instance_filter: policy === "erase_all" ? "all" : "same_class",
        class_name: policy === "erase_all" ? null : primary.class_name,
        overlap_policy: policy,
        strict_non_overlap: true,
      };
      const members = maskMutationScopeMembers(annotationsRef.current, scope);
      const primaryAlpha = decodeCocoRle(primaryRle);
      const focusAlpha = new Uint8Array(primaryAlpha.length);
      try {
        maskMutationExpectedVersions(members);
        const others = members.filter((item) => item.id !== primary.id);
        const otherRles = await Promise.all(others.map(loadNativeMaskRle));
        const beforeAlphas = otherRles.map(decodeCocoRle);
        const results: NonNullable<PendingMaskAtomicDraft["overlapResults"]> = [];
        for (let index = 0; index < others.length; index += 1) {
          const annotation = others[index];
          const before = beforeAlphas[index];
          const result = subtractMaskAlpha(before, primaryAlpha);
          if (result.changedPixels === 0) continue;
          for (let pixel = 0; pixel < before.length; pixel += 1) {
            if (before[pixel] && primaryAlpha[pixel]) focusAlpha[pixel] = 255;
          }
          results.push({
            annotationId: annotation.id,
            alpha: result.alpha,
            changedPixels: result.changedPixels,
            area: result.area,
            unresolved:
              annotation.is_locked ||
              nativeMaskTrackLocallyLocked(annotation) ||
              (isVideoTask && result.area === 0),
          });
        }
        const resultById = new Map(results.map((item) => [item.annotationId, item]));
        const finalMasks = [
          { annotation: primary, alpha: primaryAlpha },
          ...others.map((annotation, index) => {
            const result = resultById.get(annotation.id);
            return {
              annotation,
              alpha: result && !result.unresolved ? result.alpha : beforeAlphas[index],
            };
          }),
        ];
        for (let left = 0; left < finalMasks.length; left += 1) {
          for (let right = left + 1; right < finalMasks.length; right += 1) {
            const leftMask = finalMasks[left];
            const rightMask = finalMasks[right];
            if (!maskAlphasIntersect(leftMask.alpha, rightMask.alpha)) continue;
            for (let pixel = 0; pixel < leftMask.alpha.length; pixel += 1) {
              if (leftMask.alpha[pixel] && rightMask.alpha[pixel]) focusAlpha[pixel] = 255;
            }
            for (const item of [leftMask, rightMask]) {
              if (item.annotation.id === primary.id) continue;
              const existing = resultById.get(item.annotation.id);
              if (existing) {
                existing.unresolved = true;
                continue;
              }
              const area = item.alpha.reduce((sum, value) => sum + (value ? 1 : 0), 0);
              const unresolved = {
                annotationId: item.annotation.id,
                alpha: item.alpha,
                changedPixels: 0,
                area,
                unresolved: true,
              };
              results.push(unresolved);
              resultById.set(item.annotation.id, unresolved);
            }
          }
        }
        if (results.length === 0) {
          pushToast({ msg: "当前范围没有重叠 Mask" });
          return;
        }
        const sourceArea = primaryAlpha.reduce((sum, value) => sum + (value ? 1 : 0), 0);
        const plan: MaskInstanceOperationPlan = {
          kind: "overlap",
          sourceCount: members.length,
          resultCount:
            members.length - results.filter((item) => item.area === 0 && !item.unresolved).length,
          sourceAreas: [sourceArea],
          resultAreas: [sourceArea, ...results.map((item) => item.area)],
          primary: primaryAlpha,
          created: [],
          focusAlpha,
        };
        if (!maskEditor.previewInstanceOperation("overlap", plan)) return;
        pendingMaskAtomicDraftRef.current = {
          kind: "overlap",
          sourceIds: [primary.id],
          scope,
          members: snapshotMaskMembers(members),
          overlapPolicy: policy,
          overlapResults: results,
        };
        maskAtomicIdempotencyRef.current = null;
        const unresolved = results.filter((item) => item.unresolved).length;
        if (unresolved) {
          showMaskInstanceFailure(`${unresolved} 个锁定或视频空结果对象未解决，严格提交将被阻止`);
        } else {
          clearMaskInstanceFailure();
        }
      } catch (error) {
        pushToast({ msg: "非重叠预览失败", sub: maskMutationErrorMessage(error), kind: "error" });
      }
    },
    [
      clearMaskInstanceFailure,
      currentSelectedNativeMask,
      currentVideoSegment,
      isVideoTask,
      loadNativeMaskRle,
      maskEditor,
      nativeMaskTrackLocallyLocked,
      pushToast,
      s.videoFrameIndex,
      showMaskInstanceFailure,
      snapshotMaskMembers,
    ],
  );

  const runMaskInstanceOperation = useCallback(
    async (name: string, operationSpec: MaskInstanceOperationSpec) => {
      if (name !== "copy_component" && name !== "split_components") return false;
      const primary = currentSelectedNativeMask();
      if (!primary || primary.is_locked || nativeMaskTrackLocallyLocked(primary)) return false;
      if (isVideoTask && !currentVideoSegment) {
        showMaskInstanceFailure("当前帧没有可编辑分段");
        return false;
      }
      const scope: MaskMutationScope = {
        media: isVideoTask ? "video" : "image",
        frame_index: isVideoTask ? s.videoFrameIndex : null,
        segment_id: isVideoTask ? (currentVideoSegment?.id ?? null) : null,
        instance_filter: "same_class",
        class_name: primary.class_name,
        overlap_policy: "allow",
        strict_non_overlap: false,
      };
      const members = maskMutationScopeMembers(annotationsRef.current, scope);
      try {
        maskMutationExpectedVersions(members);
      } catch (error) {
        showMaskInstanceFailure(maskMutationErrorMessage(error), { retry: false, refresh: true });
        return false;
      }
      const previewed = await maskEditor.runInstanceOperation(name, operationSpec);
      if (!previewed) return false;
      pendingMaskAtomicDraftRef.current = {
        kind: name,
        sourceIds: [primary.id],
        scope,
        members: snapshotMaskMembers(members),
        operationSpec,
      };
      maskAtomicIdempotencyRef.current = null;
      clearMaskInstanceFailure();
      return true;
    },
    [
      clearMaskInstanceFailure,
      currentSelectedNativeMask,
      currentVideoSegment,
      isVideoTask,
      maskEditor,
      nativeMaskTrackLocallyLocked,
      s.videoFrameIndex,
      showMaskInstanceFailure,
      snapshotMaskMembers,
    ],
  );
  const stageMaskEditor = useMemo<UseMaskEditorReturn>(
    () => ({
      ...maskEditor,
      phase: maskInstanceTransitionBusy ? "saving" : maskEditor.phase,
      runInstanceOperation: runMaskInstanceOperation,
      cancelOperation: () => {
        if (!maskInstanceTransitionInFlightRef.current) maskEditor.cancelOperation();
      },
      cancel: () => {
        if (!maskInstanceTransitionInFlightRef.current) maskEditor.cancel();
      },
    }),
    [maskEditor, maskInstanceTransitionBusy, runMaskInstanceOperation],
  );

  const [videoMaskClipboard, setVideoMaskClipboard] = useState<VideoMaskClipboardEntry | null>(
    null,
  );
  const [videoMaskCopying, setVideoMaskCopying] = useState(false);
  const [videoMaskMutating, setVideoMaskMutating] = useState(false);
  const [pendingVideoMaskIntent, setPendingVideoMaskIntent] = useState<{
    id: string;
    taskId: string;
    kind: "paste_same" | "paste_new" | "split_components";
    annotationId: string;
    frameIndex: number;
    rle?: VideoMaskClipboardEntry["rle"];
    clipboard?: VideoMaskClipboardEntry;
    segmentId?: string;
  } | null>(null);
  const videoMaskCopyTokenRef = useRef<object | null>(null);
  const videoMaskMutationRef = useRef<Promise<void> | null>(null);
  const setVideoMaskAnnotationCache = useCallback(
    (annotation: AnnotationResponse) => {
      if (!taskId) return;
      queryClient.setQueryData<AnnotationResponse[]>(["annotations", taskId], (items) =>
        (items ?? []).map((item) => (item.id === annotation.id ? annotation : item)),
      );
    },
    [queryClient, taskId],
  );

  const copyCurrentVideoMask = useCallback(
    (annotation: AnnotationResponse) => {
      if (!taskId || annotation.geometry.type !== "video_track_mask" || annotation.version == null)
        return;
      const resolved = resolveVideoMaskTrackAtFrame(annotation.geometry, s.videoFrameIndex);
      if (!resolved) {
        pushToast({ msg: "当前帧没有可复制的 Mask", kind: "warning" });
        return;
      }
      const token = {};
      videoMaskCopyTokenRef.current = token;
      setVideoMaskCopying(true);
      const sourceVersion = Number(annotation.version);
      void rasterMasksApi
        .annotationVideoMaskContent(annotation.id, s.videoFrameIndex)
        .then((rle) => {
          if (videoMaskCopyTokenRef.current !== token) return;
          const source = annotationsRef.current.find((item) => item.id === annotation.id);
          const current =
            source?.geometry.type === "video_track_mask"
              ? resolveVideoMaskTrackAtFrame(source.geometry, s.videoFrameIndex)
              : null;
          if (
            !source ||
            Number(source.version) !== sourceVersion ||
            current?.mask.sha256 !== resolved.mask.sha256
          ) {
            pushToast({ msg: "复制来源已更新", sub: "请重新复制当前帧", kind: "warning" });
            return;
          }
          setVideoMaskClipboard({
            taskId,
            sourceAnnotationId: annotation.id,
            sourceVersion,
            sourceFrameIndex: s.videoFrameIndex,
            resolvedKeyframeFrame: resolved.keyframeFrame,
            className: annotation.class_name,
            mask: resolved.mask,
            rle,
          });
          pushToast({
            msg: "已复制当前 Mask",
            sub: `F${s.videoFrameIndex} · 来源关键帧 F${resolved.keyframeFrame}`,
            kind: "success",
          });
        })
        .catch((error: unknown) => {
          if (videoMaskCopyTokenRef.current !== token) return;
          pushToast({ msg: "复制 Mask 失败", sub: String(error), kind: "error" });
        })
        .finally(() => {
          if (videoMaskCopyTokenRef.current === token) setVideoMaskCopying(false);
        });
    },
    [pushToast, s.videoFrameIndex, taskId],
  );

  const validateMaskPaste = useCallback(
    (target: AnnotationResponse) => {
      const source = videoMaskClipboard
        ? annotationsRef.current.find((item) => item.id === videoMaskClipboard.sourceAnnotationId)
        : undefined;
      const reason = validateVideoMaskClipboard(videoMaskClipboard, {
        taskId,
        source,
        width: maskEditorSize.width,
        height: maskEditorSize.height,
      });
      if (reason) return { reason, source: undefined };
      if (target.class_name !== videoMaskClipboard?.className) {
        return { reason: "目标轨迹与复制来源类别不一致", source: undefined };
      }
      return { reason: null, source };
    },
    [maskEditorSize.height, maskEditorSize.width, taskId, videoMaskClipboard],
  );

  const pasteVideoMaskSameTrack = useCallback(
    (annotation: AnnotationResponse) => {
      if (annotation.geometry.type !== "video_track_mask") return;
      const { reason } = validateMaskPaste(annotation);
      if (reason || !videoMaskClipboard || !taskId) {
        pushToast({ msg: "无法粘贴 Mask", sub: reason ?? undefined, kind: "warning" });
        return;
      }
      if (
        maskEditor.dirty &&
        s.selectedId === annotation.id &&
        s.videoTool === "mask-track" &&
        !window.confirm("当前 Mask 稿件尚未保存，是否用剪贴板内容覆盖？")
      )
        return;
      setPendingVideoMaskIntent({
        id: randomId(),
        taskId,
        kind: "paste_same",
        annotationId: annotation.id,
        frameIndex: s.videoFrameIndex,
        rle: videoMaskClipboard.rle,
      });
      s.setSelectedId(annotation.id);
      s.setVideoTool("mask-track");
    },
    [maskEditor.dirty, pushToast, s, taskId, validateMaskPaste, videoMaskClipboard],
  );

  const pasteVideoMaskNewTrack = useCallback(
    (annotation: AnnotationResponse) => {
      if (annotation.geometry.type !== "video_track_mask") return;
      const { reason, source } = validateMaskPaste(annotation);
      if (reason || !source || !videoMaskClipboard || !taskId) {
        pushToast({ msg: "无法粘贴为新轨迹", sub: reason ?? undefined, kind: "warning" });
        return;
      }
      if (!currentVideoSegment) {
        pushToast({ msg: "当前帧没有可编辑分段", kind: "warning" });
        return;
      }
      const resolvedSource =
        source.geometry.type === "video_track_mask"
          ? resolveVideoMaskTrackAtFrame(source.geometry, videoMaskClipboard.sourceFrameIndex)
          : null;
      if (resolvedSource?.mask.sha256 !== videoMaskClipboard.mask.sha256) {
        pushToast({ msg: "复制来源已变化", sub: "请重新复制后再粘贴", kind: "warning" });
        return;
      }
      setPendingVideoMaskIntent({
        id: randomId(),
        taskId,
        kind: "paste_new",
        annotationId: annotation.id,
        frameIndex: s.videoFrameIndex,
        clipboard: videoMaskClipboard,
        segmentId: currentVideoSegment.id,
      });
      s.setSelectedId(annotation.id);
      s.setVideoTool("mask-track");
    },
    [currentVideoSegment, pushToast, s, taskId, validateMaskPaste, videoMaskClipboard],
  );

  const previewVideoMaskNewTrack = useCallback(
    (input: {
      targetId: string;
      frameIndex: number;
      segmentId: string;
      clipboard: VideoMaskClipboardEntry;
      annotations: readonly AnnotationResponse[];
    }) => {
      const source = input.annotations.find(
        (item) => item.id === input.clipboard.sourceAnnotationId,
      );
      const target = input.annotations.find((item) => item.id === input.targetId);
      const reason = validateVideoMaskClipboard(input.clipboard, {
        taskId,
        source,
        width: maskEditorSize.width,
        height: maskEditorSize.height,
      });
      if (reason || !source || source.geometry.type !== "video_track_mask") {
        throw new Error(reason ?? "复制来源已失效");
      }
      if (!target || target.geometry.type !== "video_track_mask") throw new Error("粘贴目标已失效");
      if (target.class_name !== input.clipboard.className)
        throw new Error("目标轨迹与复制来源类别不一致");
      const resolved = resolveVideoMaskTrackAtFrame(
        source.geometry,
        input.clipboard.sourceFrameIndex,
      );
      if (resolved?.mask.sha256 !== input.clipboard.mask.sha256)
        throw new Error("复制来源已变化，请重新复制");
      const alpha = decodeCocoRle(input.clipboard.rle);
      const area = alpha.reduce((total, value) => total + (value ? 1 : 0), 0);
      const scope: MaskMutationScope = {
        media: "video",
        frame_index: input.frameIndex,
        segment_id: input.segmentId,
        instance_filter: "same_class",
        class_name: input.clipboard.className,
        overlap_policy: "allow",
        strict_non_overlap: false,
      };
      const members = maskMutationScopeMembers(input.annotations, scope);
      if (!members.some((item) => item.id === source.id)) members.push(source);
      members.sort((left, right) => left.id.localeCompare(right.id));
      const plan: MaskInstanceOperationPlan = {
        kind: "copy_keyframe",
        sourceCount: 1,
        resultCount: 2,
        sourceAreas: [area],
        resultAreas: [area, area],
        primary: alpha.slice(),
        created: [alpha.slice()],
        focusAlpha: alpha.slice(),
      };
      if (!maskEditor.previewInstanceOperation("copy_keyframe", plan)) return false;
      pendingMaskAtomicDraftRef.current = {
        kind: "copy_keyframe",
        sourceIds: [source.id],
        scope,
        members: snapshotMaskMembers(members),
        copyKeyframe: input.clipboard,
        copyTargetId: target.id,
      };
      maskAtomicIdempotencyRef.current = null;
      clearMaskInstanceFailure();
      return true;
    },
    [
      clearMaskInstanceFailure,
      maskEditor,
      maskEditorSize.height,
      maskEditorSize.width,
      snapshotMaskMembers,
      taskId,
    ],
  );

  const mutateVideoMaskFrame = useCallback(
    (
      annotation: AnnotationResponse,
      operation: "delete_keyframe" | "mark_outside" | "restore_held",
    ) => {
      if (
        videoMaskMutationRef.current ||
        !taskId ||
        annotation.geometry.type !== "video_track_mask"
      )
        return;
      if (annotation.version == null) {
        pushToast({ msg: "Mask 版本缺失，请刷新", kind: "warning" });
        return;
      }
      const frameIndex = s.videoFrameIndex;
      const state = (geometry: VideoTrackMaskGeometry): VideoMaskFrameState => ({
        keyframe: geometry.keyframes.find((item) => item.frame_index === frameIndex) ?? null,
        manualOutside: (geometry.outside ?? []).some(
          (range) =>
            range.source !== "prediction" && range.from <= frameIndex && frameIndex <= range.to,
        ),
      });
      const before = state(annotation.geometry);
      setVideoMaskMutating(true);
      const execute = async () => {
        try {
          const updated = await videoTrackerApi.operateMaskKeyframe(
            taskId,
            annotation.id,
            frameIndex,
            operation,
            Number(annotation.version),
          );
          if (updated.geometry.type !== "video_track_mask") throw new Error("服务端返回了无效几何");
          setVideoMaskAnnotationCache(updated);
          history.push({
            kind: "videoMaskFrame",
            annotationId: annotation.id,
            frameIndex,
            before,
            after: state(updated.geometry),
          });
          pushToast({
            msg:
              operation === "delete_keyframe"
                ? "已删除当前 Mask 关键帧"
                : operation === "mark_outside"
                  ? "已标记当前帧消失"
                  : "已恢复当前帧保持状态",
            kind: "success",
          });
        } catch (error: unknown) {
          pushToast({
            msg: "Mask 帧操作失败",
            sub:
              error instanceof ApiError && error.status === 409
                ? "轨迹版本或锁状态已变化，请刷新后重试"
                : String(error),
            kind: "error",
          });
        } finally {
          videoMaskMutationRef.current = null;
          setVideoMaskMutating(false);
        }
      };
      const promise = execute();
      videoMaskMutationRef.current = promise;
    },
    [history, pushToast, s.videoFrameIndex, setVideoMaskAnnotationCache, taskId],
  );

  const deleteCurrentVideoMaskKeyframe = useCallback(
    (annotation: AnnotationResponse) => {
      if (annotation.geometry.type !== "video_track_mask") return;
      const exact = annotation.geometry.keyframes.some(
        (item) => item.frame_index === s.videoFrameIndex,
      );
      if (
        !exact ||
        annotation.geometry.keyframes.length <= 1 ||
        isFrameOutside(annotation.geometry, s.videoFrameIndex)
      ) {
        pushToast({
          msg: "当前 Mask 关键帧不可删除",
          sub: "需为可见的精确关键帧，且轨迹至少保留一帧",
          kind: "warning",
        });
        return;
      }
      mutateVideoMaskFrame(annotation, "delete_keyframe");
    },
    [mutateVideoMaskFrame, pushToast, s.videoFrameIndex],
  );

  const toggleCurrentVideoMaskOutside = useCallback(
    (annotation: AnnotationResponse) => {
      if (annotation.geometry.type !== "video_track_mask") return;
      const manualOutside = (annotation.geometry.outside ?? []).some(
        (range) =>
          range.source !== "prediction" &&
          range.from <= s.videoFrameIndex &&
          s.videoFrameIndex <= range.to,
      );
      if (isFrameOutside(annotation.geometry, s.videoFrameIndex) && !manualOutside) {
        pushToast({
          msg: "预测 outside 不可人工恢复",
          sub: "仅人工标记的消失状态可以在此恢复",
          kind: "warning",
        });
        return;
      }
      mutateVideoMaskFrame(annotation, manualOutside ? "restore_held" : "mark_outside");
    },
    [mutateVideoMaskFrame, pushToast, s.videoFrameIndex],
  );

  const splitCurrentVideoMaskComponents = useCallback(
    (annotation: AnnotationResponse) => {
      if (!taskId || annotation.geometry.type !== "video_track_mask") return;
      setPendingVideoMaskIntent({
        id: randomId(),
        taskId,
        kind: "split_components",
        annotationId: annotation.id,
        frameIndex: s.videoFrameIndex,
      });
      s.setSelectedId(annotation.id);
      s.setVideoTool("mask-track");
    },
    [s, taskId],
  );

  useEffect(() => {
    if (
      pendingVideoMaskIntent &&
      (pendingVideoMaskIntent.taskId !== taskId ||
        pendingVideoMaskIntent.frameIndex !== s.videoFrameIndex)
    )
      setPendingVideoMaskIntent(null);
  }, [pendingVideoMaskIntent, s.videoFrameIndex, taskId]);

  useEffect(() => {
    const intent = pendingVideoMaskIntent;
    if (!intent || !taskId) return;
    if (
      s.selectedId !== intent.annotationId ||
      s.videoFrameIndex !== intent.frameIndex ||
      s.videoTool !== "mask-track" ||
      maskEditor.acceptedSessionId !== maskEditor.sessionId ||
      maskEditor.phase === "loading" ||
      maskEditor.phase === "saving" ||
      maskEditor.phase === "idle"
    )
      return;
    setPendingVideoMaskIntent(null);
    if (intent.kind === "paste_same" && intent.rle) {
      maskEditor.materializeFromRle(intent.rle);
      pushToast({ msg: "已粘贴到当前轨迹", sub: "保存后才会写入新关键帧", kind: "success" });
      return;
    }
    if (intent.kind === "paste_new" && intent.clipboard && intent.segmentId) {
      try {
        if (
          previewVideoMaskNewTrack({
            targetId: intent.annotationId,
            frameIndex: intent.frameIndex,
            segmentId: intent.segmentId,
            clipboard: intent.clipboard,
            annotations: annotationsRef.current,
          })
        ) {
          pushToast({ msg: "已生成新 Mask 轨迹预览", sub: "确认后才会原子提交", kind: "success" });
        } else throw new Error("Mask 编辑会话已变化，请重试");
      } catch (error) {
        pushToast({ msg: "无法粘贴为新轨迹", sub: String(error), kind: "error" });
      }
      return;
    }
    void runMaskInstanceOperation("split_components", {
      type: "split_components",
      keep: "largest",
      connectivity: maskEditor.connectivity,
    }).then((previewed) => {
      if (!previewed) pushToast({ msg: "当前 Mask 无可拆分组件", kind: "warning" });
    });
  }, [
    maskEditor,
    pendingVideoMaskIntent,
    previewVideoMaskNewTrack,
    pushToast,
    runMaskInstanceOperation,
    s.selectedId,
    s.videoFrameIndex,
    s.videoTool,
    taskId,
  ]);

  const videoMaskKeyframeActions = useMemo<VideoMaskKeyframeActionHandlers>(
    () => ({
      clipboardLabel: videoMaskClipboard
        ? `F${videoMaskClipboard.sourceFrameIndex}（关键帧 F${videoMaskClipboard.resolvedKeyframeFrame}）`
        : null,
      hasClipboard: videoMaskClipboard !== null,
      busy: videoMaskCopying || videoMaskMutating || maskInstanceTransitionBusy,
      copyCurrent: copyCurrentVideoMask,
      pasteSameTrack: pasteVideoMaskSameTrack,
      pasteNewTrack: pasteVideoMaskNewTrack,
      deleteCurrentKeyframe: deleteCurrentVideoMaskKeyframe,
      toggleCurrentOutside: toggleCurrentVideoMaskOutside,
      splitCurrentComponents: splitCurrentVideoMaskComponents,
    }),
    [
      copyCurrentVideoMask,
      deleteCurrentVideoMaskKeyframe,
      maskInstanceTransitionBusy,
      pasteVideoMaskNewTrack,
      pasteVideoMaskSameTrack,
      splitCurrentVideoMaskComponents,
      toggleCurrentVideoMaskOutside,
      videoMaskClipboard,
      videoMaskCopying,
      videoMaskMutating,
    ],
  );

  const commitMaskInstanceOperation = useCallback((): Promise<boolean> => {
    if (maskInstanceCommitInFlightRef.current) {
      return maskInstanceCommitInFlightRef.current;
    }
    if (maskInstanceTransitionInFlightRef.current) return Promise.resolve(false);
    maskInstanceTransitionInFlightRef.current = true;
    const execute = async (): Promise<boolean> => {
      const preview = maskEditor.instanceOperationPreview;
      const pending = pendingMaskAtomicDraftRef.current;
      if (!taskId || !preview || !pending || !maskEditor.buffer) return false;
      if (pending.kind !== preview.plan.kind) {
        showMaskInstanceFailure("预览与提交草稿不一致，请刷新后重算", {
          retry: false,
          refresh: true,
        });
        return false;
      }
      const primary = pending.members.find((item) => item.id === pending.sourceIds[0]);
      if (!primary) {
        showMaskInstanceFailure("预览来源已失效，请刷新后重算", {
          retry: false,
          refresh: true,
        });
        return false;
      }
      if (pending?.overlapResults?.some((item) => item.unresolved)) {
        showMaskInstanceFailure("存在锁定对象或视频当前帧会被擦空，请先解除冲突");
        return false;
      }
      if (
        pending?.overlapResults?.some((result) => {
          const annotation = pending.members.find((item) => item.id === result.annotationId);
          return !annotation || nativeMaskTrackLocallyLocked(annotation);
        })
      ) {
        showMaskInstanceFailure("预览后有受影响的视频 Mask 轨迹被锁定，请刷新后重算", {
          retry: false,
          refresh: true,
        });
        return false;
      }
      const operation = preview.plan.kind;
      const sourceIds = operation === "join_masks" ? pending.sourceIds : [primary.id];
      const sources = sourceIds
        .map((id) => pending.members.find((item) => item.id === id))
        .filter((item): item is AnnotationResponse => !!item);
      if (
        sources.length !== sourceIds.length ||
        sources.some((item) => item.is_locked || nativeMaskTrackLocallyLocked(item))
      ) {
        showMaskInstanceFailure("来源 Mask 已缺失或锁定，请刷新后重算", {
          retry: false,
          refresh: true,
        });
        return false;
      }
      const scope = pending.scope;
      const members = pending.members;
      const mutationFrameIndex = scope.frame_index ?? 0;
      const mutationIsVideo = scope.media === "video";
      let expectedVersions: Array<{ annotation_id: string; version: number }>;
      let fingerprint: string;
      try {
        expectedVersions = maskMutationExpectedVersions(members);
        fingerprint = await maskMutationScopeFingerprint(scope, members);
      } catch (error) {
        showMaskInstanceFailure(maskMutationErrorMessage(error), { retry: false, refresh: true });
        return false;
      }
      const [height, width] =
        preview.plan.primary.length === maskEditor.buffer.data.length
          ? [maskEditor.buffer.height, maskEditor.buffer.width]
          : [0, 0];
      if (!height || !width) {
        showMaskInstanceFailure("Mask 预览尺寸已失效，请重算");
        return false;
      }
      const geometryForReference = (
        annotation: AnnotationResponse,
        reference: Awaited<ReturnType<typeof rasterMasksApi.uploadTaskContent>>,
        create: boolean,
      ): MaskMutationGeometry => {
        if (!mutationIsVideo) return { type: "raster_mask", mask: reference };
        if (annotation.geometry.type !== "video_track_mask") {
          throw new Error("视频 Mask 来源几何无效");
        }
        if (!create) {
          return upsertVideoMaskKeyframe(annotation.geometry, mutationFrameIndex, reference);
        }
        return {
          type: "video_track_mask",
          track_id: `trk_${randomId().replace(/-/g, "")}`,
          semantic_label: annotation.geometry.semantic_label,
          keyframes: [
            {
              frame_index: mutationFrameIndex,
              mask: reference,
              source: "manual",
              occluded: false,
            },
          ],
          outside: [],
        };
      };
      const uploadAlpha = (alpha: Uint8Array) =>
        rasterMasksApi.uploadTaskContent(taskId, encodeCocoRle(alpha, width, height));

      clearMaskInstanceFailure();
      try {
        const cached =
          maskAtomicIdempotencyRef.current?.previewId === preview.id
            ? maskAtomicIdempotencyRef.current
            : null;
        let payload = cached?.payload ?? null;
        if (!payload) {
          const mutations: MaskMutation[] = [];
          const affected: NonNullable<
            NonNullable<MaskMutationCommitRequest["report"]>["affected_annotations"]
          > = [];
          if (operation === "copy_keyframe") {
            if (!pending.copyKeyframe) throw new Error("关键帧剪贴板预览已失效");
            mutations.push({
              kind: "create",
              source_annotation_ids: [primary.id],
              geometry: geometryForReference(primary, pending.copyKeyframe.mask, true),
            });
          } else if (operation === "copy_component") {
            const alpha = preview.plan.created[0];
            if (!alpha) throw new Error("复制预览缺少新实例");
            const reference = await uploadAlpha(alpha);
            mutations.push({
              kind: "create",
              source_annotation_ids: [primary.id],
              geometry: geometryForReference(primary, reference, true),
            });
          } else if (operation === "split_components") {
            const references = await Promise.all([
              uploadAlpha(preview.plan.primary),
              ...preview.plan.created.map(uploadAlpha),
            ]);
            mutations.push({
              kind: "update",
              annotation_id: primary.id,
              geometry: geometryForReference(primary, references[0], false),
            });
            for (let index = 1; index < references.length; index += 1) {
              mutations.push({
                kind: "create",
                source_annotation_ids: [primary.id],
                geometry: geometryForReference(primary, references[index], true),
              });
            }
          } else if (operation === "join_masks") {
            if (sources.length < 2) throw new Error("合并来源已失效");
            const reference = await uploadAlpha(preview.plan.primary);
            if (pending.joinMode === "preserve_sources") {
              mutations.push({
                kind: "create",
                source_annotation_ids: sources.map((source) => source.id),
                geometry: geometryForReference(sources[0], reference, true),
              });
            } else {
              mutations.push({
                kind: "update",
                annotation_id: sources[0].id,
                geometry: geometryForReference(sources[0], reference, false),
              });
              for (const source of sources.slice(1)) {
                mutations.push({ kind: "delete", annotation_id: source.id });
              }
            }
          } else {
            const sourceReference = await uploadAlpha(preview.plan.primary);
            mutations.push({
              kind: "update",
              annotation_id: primary.id,
              geometry: geometryForReference(primary, sourceReference, false),
            });
            for (const result of pending?.overlapResults ?? []) {
              const annotation = members.find((item) => item.id === result.annotationId);
              if (!annotation) throw new Error(`Mask 对象 ${result.annotationId} 已缺失`);
              affected.push({
                annotation_id: annotation.id,
                version: Number(annotation.version),
                changed_pixels: result.changedPixels,
                unresolved: false,
              });
              if (result.area === 0 && !mutationIsVideo) {
                mutations.push({ kind: "delete", annotation_id: annotation.id });
                continue;
              }
              const reference = await uploadAlpha(result.alpha);
              mutations.push({
                kind: "update",
                annotation_id: annotation.id,
                geometry: geometryForReference(annotation, reference, false),
              });
            }
          }
          const idempotency = cached ?? {
            previewId: preview.id,
            key: `mask-${randomId()}`,
            payload: null,
          };
          payload = {
            idempotency_key: idempotency.key,
            operation,
            scope,
            source_frame_index:
              operation === "copy_keyframe" ? pending.copyKeyframe?.sourceFrameIndex : undefined,
            scope_fingerprint: fingerprint,
            expected_versions: expectedVersions,
            mutations,
            report: {
              source_areas: preview.plan.sourceAreas,
              result_areas: preview.plan.resultAreas,
              connectivity: maskEditor.connectivity,
              affected_annotations: affected,
            },
          };
          maskAtomicIdempotencyRef.current = { ...idempotency, payload };
        }
        const responseHolder: {
          value: Awaited<ReturnType<typeof maskMutationsApi.commit>> | null;
        } = { value: null };
        const result = await maskEditor.save(async () => {
          try {
            responseHolder.value = await maskMutationsApi.commit(taskId, payload);
            return { ok: true, retryable: false };
          } catch (error) {
            return {
              ok: false,
              retryable:
                error instanceof ApiError
                  ? error.status === 409 || error.status === 428 || error.status >= 500
                  : true,
              error,
            };
          }
        });
        if (!result.ok) {
          const message = maskMutationErrorMessage(result.error);
          showMaskInstanceFailure(message, maskMutationRecovery(result.error));
          pushToast({ msg: "Mask 原子提交失败", sub: `${message}；草稿已保留`, kind: "error" });
          return false;
        }
        const response = responseHolder.value;
        if (!response) {
          showMaskInstanceFailure("服务端未返回提交结果", {
            retry: true,
            refresh: false,
          });
          return false;
        }
        if (operation === "copy_keyframe") {
          const created = response.created_annotations[0];
          const mutation = payload.mutations[0];
          if (created && mutation?.kind === "create") {
            history.push({
              kind: "create",
              annotationId: created.id,
              payload: {
                annotation_type: "video_track_mask",
                tool_unit_id: primary.tool_unit_id ?? "region",
                class_name: primary.class_name,
                geometry: mutation.geometry,
                attributes: primary.attributes ?? undefined,
              },
            });
          }
        }
        const nextSelectedId =
          response.created_annotations[0]?.id ?? response.updated_annotations[0]?.id ?? null;
        maskEditor.cancel();
        if (isVideoTask) s.setVideoTool("select");
        else s.setTool("box");
        s.setSelectedId(nextSelectedId);
        await queryClient.invalidateQueries({ queryKey: ["annotations", taskId] });
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        pushToast({
          msg: "Mask 实例操作已原子提交",
          sub: `${response.updated_annotations.length} 更新 · ${response.created_annotations.length} 新建 · ${response.deleted_annotation_ids.length} 删除`,
          kind: "success",
        });
        return true;
      } catch (error) {
        const message = maskMutationErrorMessage(error);
        showMaskInstanceFailure(message, maskMutationRecovery(error));
        pushToast({ msg: "Mask 原子提交失败", sub: `${message}；草稿已保留`, kind: "error" });
        return false;
      }
    };
    const tracked = execute().finally(() => {
      if (maskInstanceCommitInFlightRef.current === tracked) {
        maskInstanceCommitInFlightRef.current = null;
        maskInstanceTransitionInFlightRef.current = false;
        setMaskInstanceCommitting(false);
      }
    });
    maskInstanceCommitInFlightRef.current = tracked;
    setMaskInstanceCommitting(true);
    return tracked;
  }, [
    clearMaskInstanceFailure,
    history,
    isVideoTask,
    maskEditor,
    nativeMaskTrackLocallyLocked,
    pushToast,
    queryClient,
    s,
    showMaskInstanceFailure,
    taskId,
  ]);

  const maskInstanceDeleteCount = useMemo(() => {
    const pending = pendingMaskAtomicDraftRef.current;
    if (!maskEditor.instanceOperationPreview || !pending || pending.scope.media !== "image") {
      return 0;
    }
    if (pending.kind === "join_masks" && pending.joinMode !== "preserve_sources") {
      return Math.max(0, pending.sourceIds.length - 1);
    }
    if (pending.kind === "overlap") {
      return (
        pending.overlapResults?.filter((item) => item.area === 0 && !item.unresolved).length ?? 0
      );
    }
    return 0;
  }, [maskEditor.instanceOperationPreview]);
  const maskInstancePreviewDetail = useMemo(() => {
    const pending = pendingMaskAtomicDraftRef.current;
    if (!maskEditor.instanceOperationPreview || !pending) return null;
    if (pending.kind === "join_masks") {
      return pending.joinMode === "preserve_sources" || pending.scope.media === "video"
        ? `创建 1 个合并副本，保留 ${pending.sourceIds.length} 个来源`
        : `更新主实例，删除 ${Math.max(0, pending.sourceIds.length - 1)} 个来源`;
    }
    if (pending.kind === "overlap") {
      const changed = pending.overlapResults?.filter((item) => item.changedPixels > 0).length ?? 0;
      const unresolved = pending.overlapResults?.filter((item) => item.unresolved).length ?? 0;
      return `影响 ${changed} 个实例·删除 ${maskInstanceDeleteCount} 个·未解决 ${unresolved} 个`;
    }
    return `面积 ${maskEditor.instanceOperationPreview.plan.sourceAreas.join("+")} → ${maskEditor.instanceOperationPreview.plan.resultAreas.join("+")} px`;
  }, [maskEditor.instanceOperationPreview, maskInstanceDeleteCount]);
  const maskInstancePreviewRows = useMemo(() => {
    const pending = pendingMaskAtomicDraftRef.current;
    if (!maskEditor.instanceOperationPreview || !pending) return [];
    const row = (
      annotationId: string,
      changedPixels: number | null,
      status: "update" | "delete" | "source" | "unresolved",
    ) => {
      const annotation = pending.members.find((item) => item.id === annotationId);
      return {
        annotationId,
        version: typeof annotation?.version === "number" ? annotation.version : null,
        changedPixels,
        status,
      };
    };
    if (pending.kind === "overlap") {
      return [
        row(pending.sourceIds[0], 0, "update"),
        ...(pending.overlapResults ?? []).map((result) =>
          row(
            result.annotationId,
            result.changedPixels,
            result.unresolved
              ? "unresolved"
              : result.area === 0 && pending.scope.media === "image"
                ? "delete"
                : "update",
          ),
        ),
      ];
    }
    if (pending.kind === "join_masks") {
      return pending.sourceIds.map((annotationId, index) =>
        row(
          annotationId,
          null,
          pending.joinMode === "replace_sources" ? (index === 0 ? "update" : "delete") : "source",
        ),
      );
    }
    return pending.sourceIds.map((annotationId) =>
      row(annotationId, null, pending.kind === "split_components" ? "update" : "source"),
    );
  }, [maskEditor.instanceOperationPreview]);
  const maskInstanceCommitBlocked = useMemo(() => {
    if (!maskEditor.instanceOperationPreview) return false;
    const pending = pendingMaskAtomicDraftRef.current;
    const unresolved =
      pending?.overlapResults?.some((result) => {
        const annotation = pending.members.find((item) => item.id === result.annotationId);
        return result.unresolved || !annotation || nativeMaskTrackLocallyLocked(annotation);
      }) ?? false;
    return unresolved || (!!maskInstanceCommitError && !maskInstanceRecovery.retry);
  }, [
    maskEditor.instanceOperationPreview,
    maskInstanceCommitError,
    maskInstanceRecovery.retry,
    nativeMaskTrackLocallyLocked,
  ]);
  const requestCommitMaskInstanceOperation = useCallback((): Promise<boolean> => {
    const pending = pendingMaskAtomicDraftRef.current;
    if (maskInstanceDeleteCount > 0 && pending && !pending.destructiveConfirmed) {
      setMaskInstanceDeleteConfirmOpen(true);
      return Promise.resolve(false);
    }
    return commitMaskInstanceOperation();
  }, [commitMaskInstanceOperation, maskInstanceDeleteCount]);
  const confirmDestructiveMaskInstanceOperation = useCallback(() => {
    const pending = pendingMaskAtomicDraftRef.current;
    if (pending) pending.destructiveConfirmed = true;
    setMaskInstanceDeleteConfirmOpen(false);
    void commitMaskInstanceOperation();
  }, [commitMaskInstanceOperation]);

  const refreshMaskInstanceOperation = useCallback(async () => {
    const draft = pendingMaskAtomicDraftRef.current;
    if (!draft || !taskId || maskInstanceTransitionInFlightRef.current) return;
    const refreshToken = {};
    const startContext = maskSessionContextRef.current;
    maskInstanceTransitionInFlightRef.current = true;
    maskInstanceRefreshTokenRef.current = refreshToken;
    setMaskInstanceRefreshing(true);
    let resetStarted = false;
    let staleContext = false;
    const assertCurrentContext = () => {
      const current = maskSessionContextRef.current;
      const sameScope =
        currentTaskIdRef.current === taskId &&
        current.key.taskId === startContext.key.taskId &&
        current.key.frameIndex === startContext.key.frameIndex &&
        current.key.toolKey === startContext.key.toolKey &&
        current.key.routeKey === startContext.key.routeKey &&
        current.key.selectionKey === startContext.key.selectionKey;
      const expectedGeneration =
        current.generation === startContext.generation ||
        current.generation === startContext.generation + 1;
      if (
        maskInstanceRefreshTokenRef.current !== refreshToken ||
        !sameScope ||
        !expectedGeneration
      ) {
        staleContext = true;
        throw new Error("Mask 会话已切换，忽略迟到的刷新结果");
      }
    };
    try {
      // Fully detach the failed editor before publishing refetched annotation
      // versions. This guarantees a non-error phase and lets an expected
      // primary-version change advance the session without a second dirty
      // leave decision.
      resetStarted = true;
      maskEditor.cancel();
      maskAtomicIdempotencyRef.current = null;
      const refreshed = await refetchAnnotations();
      if (refreshed.isError) {
        throw refreshed.error ?? new Error("标注范围刷新失败");
      }
      assertCurrentContext();
      const nextAnnotations = refreshed.data ?? [];
      if (draft.kind === "copy_keyframe") {
        const clipboard = draft.copyKeyframe;
        const targetId = draft.copyTargetId;
        if (
          !clipboard ||
          !targetId ||
          draft.scope.frame_index === null ||
          !draft.scope.segment_id
        ) {
          throw new Error("关键帧粘贴预览缺少重算上下文");
        }
        const nextTarget = nextAnnotations.find((item) => item.id === targetId);
        if (!nextTarget) throw new Error("粘贴目标已被删除");
        annotationsRef.current = nextAnnotations;
        maskEditor.rebaseSession({
          ...startContext.key,
          annotationVersion: nextTarget.version,
        });
        maskEditor.initFromRle(clipboard.rle);
        assertCurrentContext();
        clearMaskInstanceFailure();
        if (
          !previewVideoMaskNewTrack({
            targetId,
            frameIndex: draft.scope.frame_index,
            segmentId: draft.scope.segment_id,
            clipboard,
            annotations: nextAnnotations,
          })
        )
          throw new Error("关键帧粘贴预览重算失败");
        return;
      }
      const nextPrimary = nextAnnotations.find((item) => item.id === draft.sourceIds[0]);
      if (!nextPrimary) throw new Error("预览来源已被删除");
      assertCurrentContext();
      annotationsRef.current = nextAnnotations;
      maskEditor.rebaseSession({
        ...startContext.key,
        annotationVersion: nextPrimary.version,
      });
      const nextRle = await loadNativeMaskRle(nextPrimary);
      assertCurrentContext();
      maskEditor.initFromRle(nextRle);
      assertCurrentContext();
      clearMaskInstanceFailure();
      if (draft.kind === "join_masks") {
        await prepareMaskJoin(draft.joinMode);
      } else if (draft.kind === "overlap" && draft.overlapPolicy) {
        await prepareMaskOverlap(draft.overlapPolicy);
      } else if (draft.operationSpec) {
        await runMaskInstanceOperation(draft.kind, draft.operationSpec);
      } else {
        throw new Error("预览缺少可重算的操作参数");
      }
    } catch (error) {
      if (staleContext) return;
      const message = maskMutationErrorMessage(error);
      showMaskInstanceFailure(message, { retry: false, refresh: true });
      pushToast({
        msg: "Mask 范围刷新失败",
        sub: resetStarted ? "原预览已撤销，请重新刷新范围" : "原预览与幂等请求已保留",
        kind: "error",
      });
    } finally {
      if (maskInstanceRefreshTokenRef.current === refreshToken) {
        maskInstanceRefreshTokenRef.current = null;
        maskInstanceTransitionInFlightRef.current = false;
        setMaskInstanceRefreshing(false);
      }
    }
  }, [
    clearMaskInstanceFailure,
    loadNativeMaskRle,
    maskEditor,
    prepareMaskJoin,
    prepareMaskOverlap,
    previewVideoMaskNewTrack,
    pushToast,
    refetchAnnotations,
    runMaskInstanceOperation,
    showMaskInstanceFailure,
    taskId,
  ]);
  useEffect(() => {
    if (
      !videoMaskCorrectionOpen ||
      !videoMaskCorrectionContext ||
      videoMaskCorrectionContext.segmentId
    )
      return;
    const segment = videoSegmentsQuery.data?.segments.find(
      (item) =>
        item.start_frame <= videoMaskCorrectionContext.frameIndex &&
        videoMaskCorrectionContext.frameIndex <= item.end_frame,
    );
    if (!segment) return;
    setVideoMaskCorrectionContext((current) => {
      if (
        !current ||
        current.segmentId ||
        current.frameIndex !== videoMaskCorrectionContext.frameIndex
      ) {
        return current;
      }
      return {
        ...current,
        segmentId: segment.id,
        segmentStart: segment.start_frame,
        segmentEnd: segment.end_frame,
      };
    });
  }, [videoMaskCorrectionContext, videoMaskCorrectionOpen, videoSegmentsQuery.data?.segments]);
  const openVideoMaskCorrection = useCallback(() => {
    if (!selectedVideoMask) return;
    setSavedVideoMaskCorrection(null);
    setVideoMaskCorrectionCreateError(null);
    setVideoMaskCorrectionCreateRetryable(true);
    setVideoMaskCorrectionContext({
      annotationId: selectedVideoMask.id,
      frameIndex: s.videoFrameIndex,
      sessionId: maskEditor.sessionId,
      segmentId: currentVideoSegment?.id,
      segmentStart: currentVideoSegment?.start_frame ?? 0,
      segmentEnd: currentVideoSegment?.end_frame ?? Math.max(0, videoFrameCount - 1),
    });
    setVideoMaskCorrectionOpen(true);
  }, [
    currentVideoSegment,
    maskEditor.sessionId,
    s.videoFrameIndex,
    selectedVideoMask,
    videoFrameCount,
  ]);
  const changeVideoMaskCorrectionOpen = useCallback((open: boolean) => {
    setVideoMaskCorrectionOpen(open);
    if (open) return;
    setSavedVideoMaskCorrection(null);
    setVideoMaskCorrectionCreateError(null);
    setVideoMaskCorrectionCreateRetryable(true);
    setVideoMaskCorrectionContext(null);
  }, []);
  const commitVideoMask = useCallback(() => {
    const trackLocked =
      !!selectedVideoMaskForTool &&
      selectedVideoMaskForTool.geometry.type === "video_track_mask" &&
      s.lockedVideoTrackIds.has(selectedVideoMaskForTool.geometry.track_id);
    if (
      !canEditMask({
        taskReadOnly: isLockedForActions || maskCompareInteractionBlocked,
        annotationLocked: !!selectedVideoMaskForTool?.is_locked,
        trackLocked,
        segmentLocked: !!lockConflict || !!lockError,
        editorPhase: maskEditor.phase,
      }) ||
      !canCommitMask(maskEditor.phase, maskEditor.dirty)
    ) {
      pushToast({
        msg: "当前 Mask 不可提交",
        sub: "请检查锁状态或等待加载/保存完成",
        kind: "warning",
      });
      return Promise.resolve({ ok: false, retryable: false, savedKeyframe: null });
    }
    const rle = maskEditor.commitToRle();
    if (!rle || !maskEditor.buffer || maskEditor.buffer.countSet() === 0) {
      pushToast({ msg: "Mask 为空，未提交", kind: "warning" });
      return Promise.resolve({ ok: false, retryable: false, savedKeyframe: null });
    }
    // v0.23.5 · WS-B/A7 · 经 session 单飞 save: 重复 Enter / 双击只产生一次 mutation;
    // 失败保留 buffer/history 进入 error 相位, 可 retry (A2)。
    let savedKeyframe: Awaited<ReturnType<typeof handleVideoMaskCommit>> | null = null;
    let classSelectionCancelled = false;
    return maskEditor
      .save(async () => {
        try {
          savedKeyframe = await handleVideoMaskCommit(
            rle,
            s.videoFrameIndex,
            selectedVideoMaskForTool,
            s.videoTool === "mask-track" ? "track" : "frame",
          );
          if (!savedKeyframe) {
            classSelectionCancelled = true;
            return { ok: false, retryable: false };
          }
          if (savedKeyframe.annotation.version != null) {
            // 保存回包会先把 annotation version 写入 query cache。若仍让 session
            // change guard 处理这次“已确认的新版本”，它会把随后切回 select 的动作
            // 当成离开 saving 会话并恢复旧工具，最终留下未激活的 Mask toolbar。
            maskEditor.rebaseSession({
              ...maskSessionContextRef.current.key,
              annotationVersion: savedKeyframe.annotation.version,
            });
          }
          return { ok: true, retryable: false };
        } catch (error: unknown) {
          const retryable =
            error instanceof ApiError ? error.status === 409 || error.status >= 500 : false;
          return { ok: false, retryable, error };
        }
      })
      .then((result) => {
        if (classSelectionCancelled) {
          maskEditor.recoverFromError();
          return { ...result, savedKeyframe };
        }
        if (result.ok) {
          maskEditor.cancel();
          s.setVideoTool("select");
          if (savedKeyframe) s.setSelectedId(savedKeyframe.annotation.id);
        } else {
          pushToast({
            msg: "Mask 保存失败",
            sub: result.retryable ? "稿件已保留，可重试" : String(result.error),
            kind: "error",
          });
        }
        return { ...result, savedKeyframe };
      });
  }, [
    handleVideoMaskCommit,
    isLockedForActions,
    lockConflict,
    lockError,
    maskCompareInteractionBlocked,
    maskEditor,
    pushToast,
    s,
    selectedVideoMaskForTool,
  ]);
  const submitVideoMaskCorrection = useCallback(
    async (intent: VideoMaskCorrectionIntent) => {
      setVideoMaskCorrectionSubmitting(true);
      let savedDuringSubmit = savedVideoMaskCorrection;
      try {
        const outcome = await executeVideoMaskCorrectionFlow({
          intent,
          savedKeyframe: savedDuringSubmit,
          saveKeyframe: async () => {
            if (
              !videoMaskCorrectionContext ||
              videoMaskCorrectionContext.annotationId !== selectedVideoMask?.id ||
              videoMaskCorrectionContext.frameIndex !== s.videoFrameIndex ||
              videoMaskCorrectionContext.sessionId !== maskEditor.sessionId
            ) {
              pushToast({
                msg: "Mask 纠错上下文已变化",
                sub: "请回到原轨迹和帧后重新打开",
                kind: "warning",
              });
              changeVideoMaskCorrectionOpen(false);
              return null;
            }
            const saved = await commitVideoMask();
            return saved.ok ? saved.savedKeyframe : null;
          },
          onKeyframeSaved: (savedKeyframe) => {
            savedDuringSubmit = savedKeyframe;
            setSavedVideoMaskCorrection(savedKeyframe);
          },
          createPropagation: async (savedKeyframe, correctionIntent) => {
            if (
              !taskId ||
              !correctionIntent.direction ||
              !correctionIntent.modelKey ||
              !correctionIntent.modelId ||
              !correctionIntent.backendId
            ) {
              throw new Error("correction_context_incomplete");
            }
            const sourceVersion = savedKeyframe.annotation.version;
            if (sourceVersion == null) {
              throw new Error("source_annotation_version_missing");
            }
            await trackerJobs.correct(taskId, savedKeyframe.annotation.id, {
              correction_frame: savedKeyframe.frameIndex,
              from_frame: correctionIntent.fromFrame,
              to_frame: correctionIntent.toFrame,
              model_key: correctionIntent.modelKey,
              model_id: correctionIntent.modelId,
              backend_id: correctionIntent.backendId,
              direction: correctionIntent.direction,
              segment_id: correctionIntent.segmentId,
              source_annotation_version: sourceVersion,
              corrected_mask_digest: savedKeyframe.mask.sha256,
              allow_bbox_fallback: correctionIntent.allowBboxFallback,
              text: correctionIntent.text,
            });
          },
        });
        if (outcome.kind === "save_failed") return;
        if (outcome.kind === "saved") {
          changeVideoMaskCorrectionOpen(false);
          pushToast({ msg: "人工 Mask 纠错帧已保存", kind: "success" });
          return;
        }
        changeVideoMaskCorrectionOpen(false);
      } catch (error) {
        const detail =
          error instanceof ApiError && error.detailRaw && typeof error.detailRaw === "object"
            ? (error.detailRaw as { reason?: string })
            : undefined;
        pushToast({
          msg: savedDuringSubmit ? "人工纠错帧已保存，但重传播未启动" : "Mask 纠错帧保存失败",
          sub:
            detail?.reason === "correction_job_active"
              ? "同一轨迹已有纠错作业，请先完成或取消"
              : detail?.reason === "mask_prompt_unsupported"
                ? "模型能力已变化，请刷新后重新选择纠错模型"
                : (detail?.reason ?? String(error)),
          kind: "warning",
        });
        if (savedDuringSubmit) {
          setVideoMaskCorrectionCreateError(
            detail?.reason ?? (error instanceof Error ? error.message : String(error)),
          );
          setVideoMaskCorrectionCreateRetryable(
            error instanceof ApiError
              ? error.status >= 500 || detail?.reason === "correction_job_active"
              : error instanceof Error &&
                  !["correction_context_incomplete", "source_annotation_version_missing"].includes(
                    error.message,
                  ),
          );
        }
      } finally {
        setVideoMaskCorrectionSubmitting(false);
      }
    },
    [
      changeVideoMaskCorrectionOpen,
      commitVideoMask,
      maskEditor.sessionId,
      pushToast,
      s.videoFrameIndex,
      savedVideoMaskCorrection,
      selectedVideoMask?.id,
      taskId,
      trackerJobs,
      videoMaskCorrectionContext,
    ],
  );
  commitCurrentMaskRef.current = async () => {
    if (maskEditor.instanceOperationPreview) {
      return requestCommitMaskInstanceOperation();
    }
    const result = isVideoTask ? await commitVideoMask() : await commitMaskAsPolygon();
    return result.ok;
  };

  // v0.21.23 · 视频交互式 SAM 候选键位: Enter 采纳 / Esc 取消 / Tab 切候选 (与图片侧同键位)。
  // Enter 不直接落库, 而是弹类选择器 —— 与图片侧 samPendingAccept 一致。视频侧的 popover 走
  // fixed anchor (图片侧走 geom + vp 换算), 故需画布把候选外接框底边换算成屏幕坐标。
  const [videoSamPendingAccept, setVideoSamPendingAccept] = useState<{
    idx: number;
    anchor: { left: number; top: number };
  } | null>(null);

  useEffect(() => {
    if (!isVideoTask) return;
    // magic-box 不参与候选导航 (单候选, 自动弹 popover) —— 与图片侧一致。
    if (!isSamCandidateNavTool(s.videoTool)) return;
    if (sam.candidates.length === 0) return;
    // popover 打开时让位: 键盘归它 (Esc 关 popover, Enter 选类)。
    if (videoSamPendingAccept) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      if (e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") return;
      e.preventDefault();
      // stopImmediatePropagation 而非 stopPropagation: 两个 handler 都挂在 window 的捕获阶段,
      // stopPropagation 只拦跨节点传播, 拦不住同一 window 上后注册的 useWorkbenchHotkeys ——
      // 否则视频侧 Tab 会在切候选的同时又触发「同类下一个」的选中循环。
      e.stopImmediatePropagation();
      if (e.key === "Enter") {
        if (!sam.canAcceptCandidates) return;
        const idx = sam.activeIdx;
        const geom = samCandidateDisplayGeom(sam.candidates[idx]);
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
  }, [isVideoTask, s.videoTool, sam, samCandidateDisplayGeom, videoSamPendingAccept]);

  // magic-box: 候选一到就自动弹类选择器 (无需 Enter), 选定类别后收紧成外接框 —— 与图片侧同式。
  useEffect(() => {
    if (!isVideoTask || s.videoTool !== "magic-box") return;
    if (
      sam.isRunning ||
      !sam.canAcceptCandidates ||
      sam.candidates.length === 0 ||
      videoSamPendingAccept
    )
      return;
    const geom = samCandidateDisplayGeom(sam.candidates[0]);
    if (!geom) return;
    const pt = videoControlsRef.current?.normToClient({ x: geom.x, y: geom.y + geom.h });
    setVideoSamPendingAccept({ idx: 0, anchor: { left: pt?.left ?? 0, top: (pt?.top ?? 0) + 6 } });
  }, [
    isVideoTask,
    s.videoTool,
    sam.isRunning,
    sam.canAcceptCandidates,
    sam.candidates,
    samCandidateDisplayGeom,
    videoSamPendingAccept,
  ]);

  // 候选被清空 / 切工具 / 切帧 → popover 一并收起, 避免它悬在一个已不存在的候选上。
  useEffect(() => {
    if (
      videoSamPendingAccept &&
      (!sam.canAcceptCandidates || !sam.candidates[videoSamPendingAccept.idx])
    ) {
      setVideoSamPendingAccept(null);
    }
  }, [sam.canAcceptCandidates, sam.candidates, videoSamPendingAccept]);

  const acceptVideoNativeMaskCandidate = useCallback(
    async (idx: number, cls: string) => {
      const candidate = sam.candidates[idx];
      if (!taskId || candidate?.type !== "mask" || !sam.canAcceptCandidates) return;
      if (isLockedForActions) {
        pushToast({ msg: "任务已锁定", sub: "当前不能采纳 Mask 候选", kind: "warning" });
        return;
      }
      try {
        const accepted = await acceptNativeMaskCandidate({
          candidate,
          className: cls,
          target: candidate.refineSource
            ? {
                mode: "refine",
                source_annotation_id: candidate.refineSource.annotationId,
                source_version: candidate.refineSource.sourceVersion,
                frame_index: candidate.frameIndex ?? s.videoFrameIndex,
              }
            : { mode: "create", frame_index: candidate.frameIndex ?? s.videoFrameIndex },
        });
        if (!accepted) return;
        s.setActiveClass(cls);
        s.setSelectedId(accepted.annotation.id);
        sam.consume(idx);
        pushToast({
          msg: "已采纳当前帧原生 Mask",
          sub: accepted.replayed
            ? "幂等重试已恢复原结果"
            : `F${s.videoFrameIndex} 已写入轨迹关键帧`,
          kind: "success",
        });
      } catch (error) {
        pushToast({
          msg: "原生 Mask 采纳失败",
          sub: error instanceof Error ? error.message : String(error),
          kind: "error",
        });
      }
    },
    [acceptNativeMaskCandidate, isLockedForActions, pushToast, s, sam, taskId],
  );

  // 选定类别 → 按候选几何分流落库 (与图片侧 handleSamCommitClass 一致)。
  // consume 对 point/bbox 清空整个会话, 对 exemplar 只移除被采纳的那条 (多实例, 可继续采纳)。
  const handleVideoSamCommitClass = useCallback(
    (cls: string) => {
      const pending = videoSamPendingAccept;
      if (!pending) return;
      setVideoSamPendingAccept(null);
      if (!sam.canAcceptCandidates) return;
      const c = sam.candidates[pending.idx];
      if (!c) return;
      if (c.type === "mask") {
        void acceptVideoNativeMaskCandidate(pending.idx, cls);
        return;
      }
      // magic-box: 不论候选形态一律收紧成紧凑外接矩形落 video_bbox, 并结束整个会话 (单候选)。
      if (s.videoTool === "magic-box") {
        const tight =
          c.type === "rectanglelabels" && c.bbox
            ? { x: c.bbox.x, y: c.bbox.y, w: c.bbox.width, h: c.bbox.height }
            : c.type === "polygonlabels" && c.points.length >= 3
              ? tightenBboxFromPolygon(c.points)
              : null;
        sam.cancel();
        if (tight) handleVideoCreateWithClass("video_bbox", s.videoFrameIndex, tight, cls);
        return;
      }
      if (c.type === "rectanglelabels" && c.bbox) {
        handleVideoCreateWithClass(
          "video_bbox",
          s.videoFrameIndex,
          {
            x: c.bbox.x,
            y: c.bbox.y,
            w: c.bbox.width,
            h: c.bbox.height,
          },
          cls,
        );
      } else if (c.type === "polygonlabels" && c.points.length >= 3) {
        handleVideoPointsCreateWithClass("video_polygon", s.videoFrameIndex, c.points, cls);
      }
      sam.consume(pending.idx);
    },
    [
      acceptVideoNativeMaskCandidate,
      videoSamPendingAccept,
      sam,
      s.videoTool,
      s.videoFrameIndex,
      handleVideoCreateWithClass,
      handleVideoPointsCreateWithClass,
    ],
  );

  const handleVideoSamCancelClass = useCallback(() => {
    setVideoSamPendingAccept(null);
    // magic-box 只有单个候选: 取消 = 放弃整个会话, 否则 effect 会立刻把 popover 再弹出来。
    if (s.videoTool === "magic-box") sam.cancel();
  }, [s.videoTool, sam]);

  // popover 定位用的候选外接框 (归一化)。
  const videoSamPendingGeom = useMemo(() => {
    if (!videoSamPendingAccept) return null;
    return samCandidateDisplayGeom(sam.candidates[videoSamPendingAccept.idx]);
  }, [videoSamPendingAccept, sam.candidates, samCandidateDisplayGeom]);

  // 候选类和当前类都可能来自前一个工具单位；原生 Mask 只允许当前 region 类别。
  const videoSamDefaultClass = useMemo(() => {
    const label = videoSamPendingAccept
      ? sam.candidates[videoSamPendingAccept.idx]?.label
      : undefined;
    return resolveSamCandidateClass(label, classes, s.activeClass);
  }, [videoSamPendingAccept, sam.candidates, classes, s.activeClass]);

  const handlePickPendingClassAny = useCallback(
    (cls: string) => {
      if (handlePickMaskPendingClass(cls)) return;
      if (handlePickVideoPendingClass(cls)) return;
      handlePickPendingClass(cls);
    },
    [handlePickMaskPendingClass, handlePickPendingClass, handlePickVideoPendingClass],
  );

  const handleCancelPending = useCallback(
    (reason: "escape" | "outside") => {
      if (reason === "escape") {
        if (handleCancelMaskPendingClass()) return;
        if (handleCancelVideoMaskPendingClass()) return;
        s.setPendingDrawing(null);
        return;
      }
      if (s.pendingDrawing) handlePickPendingClassAny(UNKNOWN_CLASS);
      else s.setPendingDrawing(null);
    },
    [s, handleCancelMaskPendingClass, handleCancelVideoMaskPendingClass, handlePickPendingClassAny],
  );

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

  const handleUpdateAttributes = useCallback(
    (annotationId: string, next: Record<string, unknown>) => {
      const ann = annotationsRef.current.find((a) => a.id === annotationId);
      if (!ann) return;
      const before = { attributes: ann.attributes ?? {} };
      const after = { attributes: next };
      updateAnnotationMut.mutate(
        { annotationId, payload: after },
        {
          onSuccess: () => {
            history.push({ kind: "update", annotationId, before, after });
          },
        },
      );
    },
    [updateAnnotationMut, history],
  );

  const hoveredCommentShapes = useHoveredCommentStore(selectEffectiveShapes);

  const { navigateTask, smartNext, handleSubmitTask } = useWorkbenchTaskFlow({
    taskId,
    task,
    tasks,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
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
    () =>
      s.editingClass
        ? (visibleAnnotationsData.find((a) => a.id === s.editingClass!.annotationId) ?? null)
        : null,
    [s.editingClass, visibleAnnotationsData],
  );
  const editingAttributeSchema = useMemo(
    () =>
      editingClassUnit
        ? attributeSchemaForUnit(currentProject?.tool_bindings, editingClassUnit as ToolUnitId)
        : toolView.attributeSchema,
    [currentProject?.tool_bindings, editingClassUnit, toolView.attributeSchema],
  );
  const changeClassAttrEditing = useMemo<ClassPickerAttrEditing | undefined>(() => {
    const ann = editingClassAnnotation;
    const schema = editingAttributeSchema;
    if (!ann || !schema || (schema.fields ?? []).length === 0) return undefined;
    if (isVideoTrack(ann)) {
      // 视频：悬浮框只编辑 mutable 字段的「轨迹默认值」层；逐帧覆盖留给侧栏完整编辑器。
      const mutableFields = (schema.fields ?? []).filter((f) => f.mutable === true);
      if (mutableFields.length === 0) return undefined;
      return {
        schema: { fields: mutableFields },
        attributes: ann.attributes ?? {},
        context: "video",
        readOnly: isLocked || !!lockConflict || !!lockError,
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
  }, [
    editingClassAnnotation,
    editingAttributeSchema,
    isLocked,
    lockConflict,
    lockError,
    handleUpdateTrackAttributes,
    handleUpdateAttributes,
  ]);

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
    () =>
      new Set(["b", "B", "p", "P", "v", "V", "w", "W", "e", "E", "r", "R", "Delete", "Backspace"]),
    [],
  );

  const { spacePan, markSpacePanDrag, nudgeMap } = useWorkbenchHotkeys({
    s,
    history,
    classes,
    currentProject,
    annotationsRef,
    batchChanging,
    setBatchChanging,
    cancelPendingDrawing: () => handleCancelPending("escape"),
    showHotkeys,
    navigateTask,
    smartNext,
    setFitTick,
    onCrossFramePropagate: crossFramePropagate,
    recordRecentClass,
    handleDeleteBox,
    handleBatchDelete,
    handlePatchShapeFlag,
    handleStartChangeClass,
    handleStartBatchChangeClass,
    handleSubmitTask,
    handleAcceptPrediction,
    handleRejectPrediction,
    handleUpdateAttributes,
    handleVideoSetSelectedClass,
    aiBoxes,
    autoAdvanceOnDecide: s.workbenchConfig.common.autoAdvanceOnDecide,
    setShowHotkeys,
    clipboard,
    pushToast,
    stageGeom,
    polygonDraftPoints,
    setPolygonDraftPoints,
    submitPolygon,
    submitPolyline,
    updateMutation: { mutate: (vars) => updateAnnotationMut.mutate(vars) },
    taskId,
    ignoredKeys: stageKind === "3d" ? threeDOwnedKeys : undefined,
    videoMode: isVideoTask,
    samplingActive,
    videoControlsRef,
    isPromptSupported: routing.isPromptSupported,
    aiInteractiveEnabled: currentProject?.ai_interactive_enabled,
    maskEditor: stageMaskEditor,
    commitMaskAsPolygon,
    commitMaskInstanceOperation: () => void requestCommitMaskInstanceOperation(),
    cancelMaskEdit: cancelImageMaskEdit,
    maskTaskReadOnly:
      isLockedForActions ||
      imageMaskInteractionBlocked ||
      maskInstanceTransitionBusy ||
      maskCompareInteractionBlocked,
    maskPixelReadOnly: maskEditor.tiledReadOnly,
    maskInteractionFrozen: maskCompareInteractionBlocked,
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

  const hiddenVideoTrackIds = s.hiddenVideoTrackIds;
  const lockedVideoTrackIds = s.lockedVideoTrackIds;
  const toggleHiddenVideoTrack = s.toggleHiddenVideoTrack;
  const toggleLockedVideoTrack = s.toggleLockedVideoTrack;
  const trackSectionCollapsed = s.trackSectionCollapsed;
  const setTrackSectionCollapsed = s.setTrackSectionCollapsed;

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
        hiddenTrackIds={hiddenVideoTrackIds}
        lockedTrackIds={lockedVideoTrackIds}
        classes={classes}
        onSelect={handleSelectBox}
        onToggleHiddenTrack={toggleHiddenVideoTrack}
        onToggleLockedTrack={toggleLockedVideoTrack}
        onSeekFrame={s.setVideoFrameIndex}
        reviewDisplayMode={mode === "review" ? modeState.diffMode : undefined}
        trackSectionCollapsed={trackSectionCollapsed}
        onToggleTrackSection={() => setTrackSectionCollapsed(!trackSectionCollapsed)}
        onChangeUserBoxClass={handleStartChangeClass}
        onRenameTracks={handleVideoBatchRename}
        onDeleteTracks={handleVideoBatchDelete}
        onUpdate={handleVideoUpdate}
        onConvertToBboxes={handleVideoConvertToBboxes}
        onComposeTracks={handleVideoComposeTracks}
        onSelectionChange={view === "roster" ? setVideoBatchTracks : undefined}
        trackerJobsByAnnotation={trackerJobs.byAnnotation}
        onPropagateTrack={openPropagateDialog}
        onBatchTrack={(annotations) =>
          openPropagateDialog(annotations as TrackerSourceAnnotation[])
        }
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
      visibleAnnotationsData,
      s.selectedId,
      s.selectedIds,
      s.videoFrameIndex,
      meUserId,
      isLocked,
      hiddenVideoTrackIds,
      lockedVideoTrackIds,
      classes,
      handleSelectBox,
      toggleHiddenVideoTrack,
      toggleLockedVideoTrack,
      s.setVideoFrameIndex,
      mode,
      modeState.diffMode,
      handleStartChangeClass,
      handleVideoBatchRename,
      handleVideoBatchDelete,
      handleVideoUpdate,
      handleVideoConvertToBboxes,
      handleVideoComposeTracks,
      trackerJobs.byAnnotation,
      openPropagateDialog,
      trackerJobs.cancel,
      s.trackColorOverrides,
      s.setVideoTrackColor,
      toolView.attributeSchema,
      handleUpdateTrackAttributes,
      handleUpdateKeyframeAttributes,
      handlePropagateKeyframe,
      samplingStep,
      currentProject?.rendering_config?.propagateOverwrite,
      videoFps,
      imageWidth,
      imageHeight,
      trackSectionCollapsed,
      setTrackSectionCollapsed,
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
      : (selectedAiBox?.cls ?? ann?.class_name ?? "选中标注");
    let children: ReactNode;
    if (multi && stageKind === "image") {
      // 图片多选:批量操作(改类 / 合并 / 锁定 / 隐藏 / 删除)收进浮卡,取代退役的贴框浮条。
      const selectedAnns = userBoxes.filter((b) => selectedIds.includes(b.id));
      const allLocked = selectedAnns.length > 0 && selectedAnns.every((a) => a.is_locked);
      const allHidden = selectedAnns.length > 0 && selectedAnns.every((a) => a.is_hidden);
      const conversionSourceType = selectedAnns[0]?.geometry?.type;
      const canBatchConvert = Boolean(
        conversionSourceType &&
        selectedAnns.every((item) => item.geometry?.type === conversionSourceType) &&
        ["polygon", "multi_polygon", "raster_mask"].includes(conversionSourceType) &&
        (conversionSourceType === "raster_mask" || imageMaskPersistenceMode === "native") &&
        !selectedAnns.some((item) => item.is_locked),
      );
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
          onConvert={canBatchConvert ? () => openAnnotationConversion(selectedIds) : undefined}
        />
      );
    } else if (multi && stageKind === "video") {
      // 视频多选:单帧框(video_bbox)走 selectedIds,给批量卡(改类 / 锁 / 隐藏 / 删除 + 聚合为轨迹);
      // 轨迹多选走右栏 roster 的 selectedTrackIds,不进 selectedIds,浮卡保持精简占位。
      const selectedAnns = visibleAnnotationsData.filter((a) => selectedIds.includes(a.id));
      const allVideoBbox =
        selectedAnns.length > 0 && selectedAnns.every((a) => a.geometry.type === "video_bbox");
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
            onAggregate={() =>
              handleVideoComposeTracks({
                operation: "aggregate_bboxes",
                annotationIds: selectedIds,
                deleteSources: true,
              })
            }
            onClear={() => setSelectedId(null)}
          />
        );
      } else {
        const sourceType = selectedAnns[0]?.geometry.type;
        const sameConvertibleSource = Boolean(
          sourceType &&
          ["video_polygon", "video_track_polygon", "video_track_mask"].includes(sourceType) &&
          selectedAnns.every((item) => item.geometry.type === sourceType) &&
          !selectedAnns.some((item) => item.is_locked),
        );
        children = sameConvertibleSource ? (
          <ConversionBatchCardContent
            count={selectionCount}
            sourceType={sourceType!}
            readOnly={isLocked}
            onConvert={() => openAnnotationConversion(selectedIds)}
            onClear={() => setSelectedId(null)}
          />
        ) : (
          <SelectionCardPlaceholder summary={`已选中 ${selectionCount} 个标注。`} />
        );
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
            onConvert={ann.geometry.type === "video_polygon" ? openAnnotationConversion : undefined}
            onEditMask={isVideoMask(ann) ? () => setVideoTool("mask") : undefined}
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
            hidden={hiddenVideoTrackIds.has(ann.geometry.track_id)}
            locked={lockedVideoTrackIds.has(ann.geometry.track_id)}
            onSeekFrame={setVideoFrameIndex}
            onChangeClass={handleStartChangeClass}
            onDelete={handleDeleteBox}
            onToggleHidden={toggleHiddenVideoTrack}
            onToggleLock={toggleLockedVideoTrack}
            onEditMask={isVideoMaskTrack(ann) ? () => setVideoTool("mask-track") : undefined}
            onPropagate={isVideoMaskTrack(ann) ? () => openPropagateDialog(ann) : undefined}
            onConvert={
              ann.geometry.type === "video_track_polygon" || isVideoMaskTrack(ann)
                ? openAnnotationConversion
                : undefined
            }
            maskActions={isVideoMaskTrack(ann) ? videoMaskKeyframeActions : undefined}
          />
        );
      } else if (videoBatchTracks.length >= 2) {
        // v0.21.16 WS3 · 多选 ≥2 条轨迹 → 浮卡渲染批量卡 (与右栏 roster 批量条对等), 不再退化为
        // 「最后选中那条」的单卡。选择态由 roster 实例上报的 videoBatchTracks 镜像驱动。
        const ids = videoBatchTracks.map((t) => t.id);
        const sameClass =
          videoBatchTracks.length === 2 &&
          videoBatchTracks[0].class_name === videoBatchTracks[1].class_name;
        const canMerge = sameClass;
        const canJoin = sameClass && !trackRangesOverlap(videoBatchTracks[0], videoBatchTracks[1]);
        const countHint = `需恰好选中 2 条轨迹（当前 ${videoBatchTracks.length} 条）`;
        const mergeReason = canMerge
          ? null
          : videoBatchTracks.length !== 2
            ? countHint
            : "两条轨迹需同类";
        const joinReason = canJoin
          ? null
          : videoBatchTracks.length !== 2
            ? countHint
            : !sameClass
              ? "两条轨迹需同类"
              : "两条轨迹的可见帧区间不能重叠";
        const setBatchHidden = (hidden: boolean) =>
          videoBatchTracks.forEach((t) => {
            if (hiddenVideoTrackIds.has(t.geometry.track_id) !== hidden)
              toggleHiddenVideoTrack(t.geometry.track_id);
          });
        const setBatchLocked = (locked: boolean) =>
          videoBatchTracks.forEach((t) => {
            if (lockedVideoTrackIds.has(t.geometry.track_id) !== locked)
              toggleLockedVideoTrack(t.geometry.track_id);
          });
        // 全选中才算「已隐藏 / 已锁定」→ 切换按钮翻转为反向动作; 部分选中时仍显示正向动作(与图片侧一致)。
        const allTracksHidden = videoBatchTracks.every((t) =>
          hiddenVideoTrackIds.has(t.geometry.track_id),
        );
        const allTracksLocked = videoBatchTracks.every((t) =>
          lockedVideoTrackIds.has(t.geometry.track_id),
        );
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
            onMerge={() =>
              handleVideoComposeTracks({ operation: "merge_tracks", annotationIds: ids })
            }
            onJoin={(gapMode: VideoTrackGapMode) =>
              handleVideoComposeTracks({ operation: "join_tracks", annotationIds: ids, gapMode })
            }
            onDelete={() => {
              if (window.confirm(`确定删除 ${videoBatchTracks.length} 条轨迹？`))
                handleVideoBatchDelete(videoBatchTracks);
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
          rasterMaskStatus={imageRasterMasks.statusById.get(ann.id)}
          onRetryRasterMask={imageRasterMasks.retry}
          onEditRasterMask={
            imageMaskPersistenceMode === "native" ? enterImageRasterMaskEdit : undefined
          }
          onConvertRegionToRaster={
            imageMaskPersistenceMode === "native" ? openAnnotationConversion : undefined
          }
          onConvertRasterToRegion={openAnnotationConversion}
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
        stageKind === "image" ? () => setSecondaryBarHidden(!secondaryBarHidden) : undefined,
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
    hiddenVideoTrackIds,
    lockedVideoTrackIds,
    toggleHiddenVideoTrack,
    toggleLockedVideoTrack,
    setVideoTool,
    videoMaskKeyframeActions,
    openPropagateDialog,
    handleStartChangeClass,
    handlePatchShapeFlag,
    handleDeleteBox,
    handleUpdateAttributes,
    acceptPredictionFromCard,
    rejectPredictionFromCard,
    handleRefinePrediction,
    openAnnotationConversion,
    imageMaskPersistenceMode,
    enterImageRasterMaskEdit,
    imageRasterMasks.retry,
    imageRasterMasks.statusById,
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
    if (isVideoTask && selectionSourceKind === "prediction" && !selectedAiBox)
      warnings.push("预测来源");
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
  const petCandidateCount =
    (modeState.diffMode !== "final" ? aiBoxes.length : 0) + sam.candidates.length;
  const petContext = useMemo<WorkbenchPetContext>(
    () => ({
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
    }),
    [
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
    ],
  );

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
    isProjectLoading ||
    isTaskListLoading ||
    (shouldLoadDirectTask && directTaskQuery.isLoading)
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
    new Set([...trackerSeeds.map((sd) => sd.obj), ...trackerSeedBoxes.map((sb) => sb.obj)]).size >
    1;
  const trackerSeedTargets = [
    ...new Set([
      ...trackerSeeds.map((seed) => seed.obj),
      ...trackerSeedBoxes.map((seed) => seed.obj),
    ]),
  ]
    .sort((a, b) => a - b)
    .map((targetId) => ({
      targetId,
      pointCount: trackerSeeds.filter((seed) => seed.obj === targetId).length,
      boxCount: trackerSeedBoxes.filter((seed) => seed.obj === targetId).length,
      frames: [
        ...new Set([
          ...trackerSeeds.filter((seed) => seed.obj === targetId).map((seed) => seed.frame),
          ...trackerSeedBoxes.filter((seed) => seed.obj === targetId).map((seed) => seed.frame),
        ]),
      ].sort((a, b) => a - b),
    }));

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
          (result) =>
            result.frame_index === s.videoFrameIndex &&
            !result.outside &&
            result.geometry.type === "mask",
        )
        .map((result) => ({ jobId: trackerReviewCandidate.jobId, result }))
    : [];
  const propagateDialogNextKeyframe = propagateDialogTrack
    ? ([...propagateDialogTrack.geometry.keyframes]
        .map((kf) => kf.frame_index)
        .filter((idx) => idx > s.videoFrameIndex)
        .sort((a, b) => a - b)[0] ?? null)
    : null;
  const propagateDialogPrevKeyframe = propagateDialogTrack
    ? ([...propagateDialogTrack.geometry.keyframes]
        .map((kf) => kf.frame_index)
        .filter((idx) => idx < s.videoFrameIndex)
        .sort((a, b) => b - a)[0] ?? null)
    : null;

  // v0.21.10 · 「当前题 AI」header 待审数: 视频按**当前帧**过滤 (与下方候选列表口径一致), 图像取全部。
  //   aiBoxes 已在源头按 id 去重 (见 useImageAnnotationActions), 故此处只做帧作用域, 消除跨帧+分页
  //   漂移导致的 100→500→100 抖动。
  const aiPopoverBoxCount =
    modeState.diffMode === "final"
      ? 0
      : isVideoTask
        ? aiBoxes.filter((b) => aiBoxOnFrame(b, s.videoFrameIndex)).length
        : aiBoxes.length;

  const maskToolbarSelection = s.selectedId
    ? visibleAnnotationsData.find((annotation) => annotation.id === s.selectedId)
    : null;
  const maskToolbarTrackLocked = !!(
    isVideoTask &&
    maskToolbarSelection &&
    isVideoMaskTrack(maskToolbarSelection) &&
    s.lockedVideoTrackIds.has(maskToolbarSelection.geometry.track_id)
  );
  const maskToolbarEditContext = {
    taskReadOnly:
      isLockedForActions || imageMaskInteractionBlocked || maskCompareInteractionBlocked,
    annotationLocked: !!maskToolbarSelection?.is_locked,
    trackLocked: maskToolbarTrackLocked,
    segmentLocked: !!lockConflict || !!lockError,
    editorPhase: maskInstanceTransitionBusy ? "saving" : maskEditor.phase,
  };
  const maskToolbarBaseBlockReason = maskEditBlockReason(maskToolbarEditContext);
  const maskToolbarBlockReason = maskEditor.tiledReadOnly
    ? ("large_canvas_budget_exceeded" as const)
    : maskToolbarBaseBlockReason;
  const selectedMaskJoinCandidates = [
    ...new Set([...(s.selectedId ? [s.selectedId] : []), ...s.selectedIds]),
  ]
    .map((id) => visibleAnnotationsData.find((annotation) => annotation.id === id))
    .filter((annotation): annotation is AnnotationResponse => !!annotation)
    .filter((annotation) => annotation.class_name === maskToolbarSelection?.class_name)
    .filter((annotation) => !annotation.is_locked)
    .filter((annotation) => !nativeMaskTrackLocallyLocked(annotation))
    .filter((annotation) =>
      isVideoTask
        ? annotation.geometry.type === "video_track_mask" &&
          resolveVideoMaskTrackAtFrame(annotation.geometry, s.videoFrameIndex) !== null
        : annotation.geometry.type === "raster_mask",
    );
  const canPrepareMaskJoin =
    selectedMaskJoinCandidates.length >= 2 && (!isVideoTask || currentVideoSegment !== null);

  const layout: ComponentProps<typeof WorkbenchLayout> = {
    gridTemplateColumns: `${leftOpen ? `clamp(180px, ${leftPct}%, 600px)` : "0px"} 48px 1fr ${rightOpen ? `clamp(180px, ${rightPct}%, 600px)` : "0px"}`,
    taskQueue: {
      open: leftOpen,
      classes,
      // 3D 点云台用当前 3D 工具单位的 classesConfig;2D 仍用项目级。
      classesConfig: stageKind === "3d" ? classesConfig : currentProject?.classes_config,
      toolLabel:
        stageKind === "3d"
          ? s.threeDTool === "point-mask"
            ? "点云分割"
            : "3D 框"
          : TOOL_REGISTRY[s.tool].label,
      toolIcon:
        stageKind === "3d"
          ? s.threeDTool === "point-mask"
            ? "scissors"
            : "rect"
          : TOOL_REGISTRY[s.tool].icon,
      activeClass: s.activeClass,
      recentClasses,
      tasks,
      taskId,
      taskIdx,
      hasNextPage,
      isFetchingNextPage,
      onFetchNextPage: fetchNextPage,
      onSelectTask: selectTask,
      batches: activeBatches,
      selectedBatchId,
      onSelectBatch: handleSelectBatch,
      totalCount: tasksTotal,
      isOwner,
      onGoToBatchSettings: () => {
        if (projectId) navigate(`/projects/${projectId}/settings?section=batches`);
      },
      width: leftPx,
      onResize: onResizeLeft,
      widthMin: sidebarMinPx,
      widthMax: sidebarMaxPx,
      widthResetTo: sidebarResetPx,
      onDetachQueue: detachTaskQueue,
      onDetachPalette: detachClassPalette,
      // v0.13.3-5 · 3D 点云台:左栏色板可点选 = 放置新框的类别(2D 仍只读图例)。
      classPickable: stageKind === "3d" && !isLocked,
      onPickClass: s.setActiveClass,
    },
    toolDock: {
      tool: s.tool,
      onSetTool: s.setTool,
      videoTool: s.videoTool,
      onSetVideoTool: s.setVideoTool,
      isPromptSupported: routing.isPromptSupported,
      toolDisabledReasons: {
        "smart-point":
          selectedMaskPromptSource != null ? maskRefinementToolDisabledReason("point") : undefined,
        "smart-box":
          selectedMaskPromptSource != null
            ? maskRefinementToolDisabledReason("interactive_box")
            : undefined,
        "smart-scribble":
          selectedMaskPromptSource == null
            ? "请先选中一个已保存、未锁定的原生 Mask"
            : maskRefinementToolDisabledReason("scribble"),
      },
      capabilitiesLoading: routing.isLoading,
      reviewMode: mode === "review",
      videoMode: isVideoTask,
      enabledToolUnits,
      aiInteractiveEnabled: currentProject?.ai_interactive_enabled,
      isVideoToolEnabled,
      threeDMode: stageKind === "3d",
      threeDTool: s.threeDTool,
      onSetThreeDTool: s.setThreeDTool,
    },
    banners: {
      mode,
      task,
      lockError,
      lockConflict,
      claimInfo: modeState.claimInfo,
      canWithdraw: bannerActions.canWithdraw,
      isWithdrawing: bannerActions.isWithdrawing,
      isReopening: bannerActions.isReopening,
      isAcceptingRejection: bannerActions.isAcceptingRejection,
      onWithdraw: bannerActions.onWithdraw,
      onReopen: bannerActions.onReopen,
      onAcceptRejection: bannerActions.onAcceptRejection,
    },
    topbar: {
      projectName,
      projectDisplayId,
      task,
      taskIdx,
      taskTotal: tasks.length,
      aiRunning,
      batchStatus: currentBatchStatus,
      isSubmitting: isSubmittingTask,
      confThreshold: s.confThreshold,
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
      onPrev: () => navigateTask("prev"),
      onNext: () => navigateTask("next"),
      onSubmit: topbarActions.onSubmit ?? handleSubmitTask,
      onSmartNextOpen: topbarActions.onSmartNextOpen,
      onSmartNextUncertain: topbarActions.onSmartNextUncertain,
      onOpenWorkbenchSettings: () => setWorkbenchSettingsOpen(true),
      canWithdraw: topbarActions.canWithdraw,
      canReopen: topbarActions.canReopen,
      isWithdrawing: topbarActions.isWithdrawing,
      isReopening: topbarActions.isReopening,
      onWithdraw: topbarActions.onWithdraw,
      onReopen: topbarActions.onReopen,
      isSkipping: topbarActions.isSkipping,
      onSkip: topbarActions.onSkip,
      mode,
      onApprove: topbarActions.onApprove,
      onReject: topbarActions.onReject,
      isApproving: topbarActions.isApproving,
      isRejecting: topbarActions.isRejecting,
      reviewInfoSlot: topbarActions.reviewInfoSlot,
    },
    stageHost: {
      common: {
        stageKind,
        maskCompareStore: maskQcReview.store,
        taskId: taskId ?? null,
        readOnly: isLocked || !!lockConflict || !!lockError,
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
            {(isVideoTask
              ? s.videoTool === "mask" || s.videoTool === "mask-track"
              : s.tool === "mask") && (
              <MaskToolbar
                active={maskEditor.active}
                tool={maskEditor.tool}
                brushShape={maskEditor.brushShape}
                connectivity={maskEditor.connectivity}
                radius={maskEditor.radius}
                dirty={hasPendingMaskDraft}
                phase={maskEditor.phase}
                canUndo={maskEditor.canUndo}
                canRedo={maskEditor.canRedo}
                operationPreview={maskEditor.operationPreview}
                instanceOperationPreview={maskEditor.instanceOperationPreview}
                operationStatus={maskEditor.operationStatus}
                operationError={maskEditor.operationError}
                canEdit={maskToolbarBlockReason === null}
                canCommit={maskToolbarBaseBlockReason === null}
                interactionFrozen={maskCompareInteractionBlocked}
                largeCanvas={maskEditor.backend === "tiled"}
                editBlockReason={maskToolbarBlockReason}
                onSetTool={maskEditor.setTool}
                onSetBrushShape={maskEditor.setBrushShape}
                onSetConnectivity={maskEditor.setConnectivity}
                onSetRadius={maskEditor.setRadius}
                onConfirmOperation={maskEditor.confirmOperation}
                onCancelOperation={stageMaskEditor.cancelOperation}
                onRunOperation={maskEditor.runOperation}
                onRunInstanceOperation={runMaskInstanceOperation}
                onCommitInstanceOperation={() => void requestCommitMaskInstanceOperation()}
                onPrepareJoin={(joinMode) => void prepareMaskJoin(joinMode)}
                onPrepareOverlap={(policy) => void prepareMaskOverlap(policy)}
                onRefreshInstanceOperation={() => void refreshMaskInstanceOperation()}
                canPrepareJoin={canPrepareMaskJoin}
                joinSupportsReplace={!isVideoTask}
                instanceCommitting={maskInstanceCommitting}
                instanceRefreshing={maskInstanceRefreshing}
                instanceCommitError={maskInstanceCommitError}
                instanceCanRetry={maskInstanceRecovery.retry}
                instanceCanRefresh={maskInstanceRecovery.refresh}
                instancePreviewDetail={maskInstancePreviewDetail}
                instancePreviewRows={maskInstancePreviewRows}
                instanceCommitBlocked={maskInstanceCommitBlocked}
                onUndo={maskEditor.undo}
                onRedo={maskEditor.redo}
                onRetry={isVideoTask ? maskEditor.recoverFromError : retryImageMaskSession}
                onCommit={isVideoTask ? commitVideoMask : commitMaskAsPolygon}
                onCommitAndPropagate={
                  isVideoTask && selectedVideoMask ? openVideoMaskCorrection : undefined
                }
                onOpenConversion={
                  isVideoTask
                    ? selectedVideoMask
                      ? () => openAnnotationConversion(selectedVideoMask.id)
                      : undefined
                    : selectedImageRasterMask
                      ? () => openAnnotationConversion(selectedImageRasterMask.id)
                      : undefined
                }
                onCancel={isVideoTask ? cancelVideoMaskEdit : cancelImageMaskEdit}
              />
            )}
            <AlertDialog
              open={maskInstanceDeleteConfirmOpen}
              onOpenChange={setMaskInstanceDeleteConfirmOpen}
            >
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    确认删除 {maskInstanceDeleteCount} 个 Mask 实例？
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    本次原子操作会删除面积为零或被替换的图片 Mask。提交后需通过审计记录追溯。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>返回预览</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={confirmDestructiveMaskInstanceOperation}
                  >
                    确认删除并提交
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
                canRetry={sam.canRetry}
                onRetry={sam.retryLast}
                exemplarOutputMode={s.exemplarOutputMode}
                singleFrameOutputGeometry={effectiveSingleFrameOutputGeometry}
                onSetSingleFrameOutputGeometry={setSingleFrameOutputGeometry}
                nativeMaskOutputDisabledReason={nativeMaskOutputDisabledReason}
                maskPromptSourceLabel={
                  canRefineSelectedMask && selectedMaskPromptSource
                    ? `精修 Mask · ${selectedMaskPromptSource.class_name}`
                    : undefined
                }
                onSetExemplarOutputMode={(mode) => {
                  // 切输出形态时若 exemplar 会话进行中, 用当前会话重跑 (output 透传)。
                  handleSetExemplarOutputMode(mode);
                  sam.rerunExemplar(mode);
                }}
                exemplarText={sam.exemplarText}
                onSetExemplarText={sam.setExemplarText}
                exemplarThreshold={sam.exemplarThreshold}
                onSetExemplarThreshold={sam.setExemplarThreshold}
                exemplarThresholdDefault={((): number | undefined => {
                  const def = (
                    mlCapabilities.paramsSchema?.properties?.score_threshold as
                      | { default?: unknown }
                      | undefined
                  )?.default;
                  return typeof def === "number" ? def : undefined;
                })()}
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
                interactiveBackends={(activeInteractivePrompt
                  ? routing.candidatesFor(activeInteractivePrompt)
                  : []
                )
                  .map((id) => backends.find((b) => b.id === id))
                  .filter((b): b is MLBackendResponse => !!b)}
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
              samPendingAnchor={isVideoTask ? (videoSamPendingAccept?.anchor ?? null) : null}
              samDefaultClass={isVideoTask ? videoSamDefaultClass : samDefaultClass}
              batchChanging={batchChanging}
              batchChangeTarget={batchChangeTarget}
              imageOverlayEnabled={stageKind === "image"}
              stageGeom={stageGeom}
              vp={vp}
              classes={classes}
              editingClassClasses={editingClassClasses}
              batchChangeClasses={
                batchChangeToolUnitId
                  ? classesForUnit(
                      currentProject?.tool_bindings,
                      batchChangeToolUnitId as ToolUnitId,
                    )
                  : classes
              }
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
        samCandidates: isVideoTask ? samDisplayCandidates : undefined,
        samMaskRecords: isVideoTask ? samMaskCandidates.records : undefined,
        onSelectSamMaskCandidate: isVideoTask ? selectSamMaskCandidate : undefined,
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
        videoMaskEditor: isVideoTask ? stageMaskEditor : undefined,
        videoMaskKeyframeActions: isVideoTask ? videoMaskKeyframeActions : undefined,
        onVideoMaskCommit: isVideoTask
          ? () => {
              if (maskEditor.instanceOperationPreview) void requestCommitMaskInstanceOperation();
              else void commitVideoMask();
            }
          : undefined,
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
        rasterMaskRecords: imageRasterMasks.records,
        rasterMaskStatusById: imageRasterMasks.statusById,
        onRetryRasterMask: imageRasterMasks.retry,
        editingRasterMaskId: editingImageRasterMaskId,
        maskReadOnly: imageMaskInteractionBlocked,
        fileUrl,
        imageSource: workbenchImageSource,
        onRetryImagePyramid: retryWorkbenchImagePyramid,
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
          if (prompt.kind === "scribble")
            return sam.runScribble(prompt.points, prompt.alt ? 0 : 1, prompt.width, extra);
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
        samCandidates: samDisplayCandidates,
        samMaskRecords: samMaskCandidates.records,
        onSelectSamMaskCandidate: selectSamMaskCandidate,
        samActiveIdx: sam.activeIdx,
        samSessionPoints: sam.sessionPoints,
        samSessionScribbles: sam.sessionScribbles,
        samSessionExemplars: sam.sessionExemplars,
        samSubTool: s.samSubTool,
        samPolarity: s.samPolarity,
        onRefineSamCandidate: handleRefineSamCandidate,
      },
      editors: {
        polygonDraft:
          s.tool === "polygon" ? polygonHandle : s.tool === "polyline" ? polylineHandle : undefined,
        keypointDraft: s.tool === "keypoint" ? keypointHandle : undefined,
        keypointSchema: toolView.keypointSchema,
        canvasShapes: s.canvasDraft.shapes,
        canvasEditable: s.canvasDraft.active,
        canvasStroke: s.canvasDraft.stroke,
        onCanvasStrokeCommit: (points, stroke) =>
          s.appendCanvasShape({ type: "line", points, stroke }),
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
        maskEditor: stageMaskEditor,
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
      userBoxesCount: userBoxes.length,
      aiBoxesCount: aiBoxes.length,
      activeClass: s.activeClass,
      imageWidth,
      imageHeight,
      cursor,
      preannotationProgress,
      preannotationConn,
      preannotationRetries,
      avgLeadMs: avgMs,
      remainingTaskCount,
      offlineQueueCount: queueCount,
      online,
      onShowQueueDrawer: openOfflineDrawer,
      lockRemainingMs: remainingMs,
      lockError,
      lockConflict,
      diffMode: modeState.diffMode,
      onSetDiffMode: modeState.onSetDiffMode,
    },
    inspector: {
      open: rightOpen,
      width: rightPx,
      onResize: onResizeRight,
      readOnly: isLocked,
      // v0.20.19 · 属性区折叠态走 workbench.layout 服务端偏好, 选框/刷新/换设备保留。
      attrCollapsed: s.attrPanelCollapsed,
      onToggleAttrCollapsed: () => s.setAttrPanelCollapsed(!s.attrPanelCollapsed),
      // v0.20.22 · AI 待审 / 人工两大分组头折叠 (同一 workbench.layout 管道跨设备持久)。
      aiSectionCollapsed: s.aiSectionCollapsed,
      onToggleAiSection: () => s.setAiSectionCollapsed(!s.aiSectionCollapsed),
      manualSectionCollapsed: s.manualSectionCollapsed,
      onToggleManualSection: () => s.setManualSectionCollapsed(!s.manualSectionCollapsed),
      widthMin: sidebarMinPx,
      widthMax: sidebarMaxPx,
      widthResetTo: sidebarResetPx,
      onDetach: detachInspector,
      capabilityWarnings,
      onFillAttribute: handleFillAttribute,
      aiBoxes: modeState.diffMode !== "final" ? aiBoxes : [],
      predictionSourceFilter,
      userBoxes,
      orphanUserBoxIds: orphanAnnotationIds,
      rasterMaskStatusById: imageRasterMasks.statusById,
      onRetryRasterMask: imageRasterMasks.retry,
      selectedId: s.selectedId,
      selectedIds: s.selectedIds,
      dimmedAiIds,
      imageWidth,
      imageHeight,
      onSelect: handleSelectBox,
      onAcceptPrediction: handleAcceptPrediction,
      onRejectPrediction: handleRejectPrediction,
      onRefinePrediction: handleRefinePrediction,
      onRefineUserPolygon: handleRefineUserPolygon,
      onEditRasterMask:
        imageMaskPersistenceMode === "native" ? enterImageRasterMaskEdit : undefined,
      onClearSelection: () => s.setSelectedId(null),
      onDeleteUserBox: handleDeleteBox,
      onChangeUserBoxClass: handleStartChangeClass,
      onToggleUserBoxFlag: (id: string, flag: "is_locked" | "is_hidden") => {
        const ann = userBoxes.find((b) => b.id === id);
        if (!ann) return;
        const cur = !!ann[flag];
        handlePatchShapeFlag(id, flag, !cur);
      },
      attributeSchema: toolView.attributeSchema,
      selectedAnnotation: selectedAnnotationForPanel,
      onUpdateAttributes: handleUpdateAttributes,
      onBulkUpdateAttributes: (ids, patch) => {
        if (!taskId || ids.length === 0) return;
        bulkUpdateMut.mutate({ ids, patch });
      },
      hasMorePredictions: modeState.diffMode !== "final" && !!predictionsInfinite.hasNextPage,
      isFetchingMorePredictions:
        modeState.diffMode !== "final" && predictionsInfinite.isFetchingNextPage,
      onFetchMorePredictions: () => predictionsInfinite.fetchNextPage(),
      currentFrameIndex: isVideoTask ? s.videoFrameIndex : undefined,
      onSeekFrame: isVideoTask ? s.setVideoFrameIndex : undefined,
      videoTrackPanel: isVideoTask
        ? (frameFilter) => (
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
          )
        : undefined,
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
      aiModel,
      aiRunning,
      aiBoxCount: aiPopoverBoxCount,
      isVideoTask,
      confThreshold: s.confThreshold,
      aiTakeoverRate,
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
    hotkeys: {
      open: showHotkeys,
      onClose: () => setShowHotkeys(false),
      attributeSchema: toolView.attributeSchema,
    },
    offlineQueue: {
      open: offlineDrawerOpen,
      onClose: closeOfflineDrawer,
      currentTaskId: taskId,
      onFlushOne: executeOp,
      onFlushAll: flushOffline,
    },
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
    conflict: {
      open: conflictOpen,
      onReload: handleConflictReload,
      onOverwrite: handleConflictOverwrite,
      onClose: () => setConflictOpen(false),
    },
    rejectModal: modeState.rejectModal
      ? {
          open: modeState.rejectModal.open,
          count: 1,
          onClose: modeState.rejectModal.onClose,
          onConfirm: modeState.rejectModal.onConfirm,
          skipReasonHint: modeState.rejectModal.skipReasonHint,
        }
      : undefined,
    deleteConfirm: deleteConfirm
      ? {
          open: true,
          count: deleteConfirm.count,
          onCancel: closeDeleteConfirm,
          onConfirm: confirmDelete,
        }
      : undefined,
    guidePanel:
      ANNOTATION_GUIDE_UI_ENABLED && projectId
        ? {
            projectId,
            content:
              (currentProject as unknown as { annotation_guide?: string | null } | undefined)
                ?.annotation_guide ?? null,
          }
        : undefined,
    // v0.11.5 · B 组 · DiscussionPanel 转正 → 右栏固定两段布局 (上 AIInspectorPanel + 下 DiscussionPanel)。
    discussionPanel: {
      maskQc:
        mode === "review" && projectId && taskId
          ? {
              projectId,
              taskId,
              activeIssue: maskQcReview.issue,
              phase: maskQcReview.phase,
              error: maskQcReview.error,
              compare: maskQcReview.compare,
              baseline: maskQcReview.baseline,
              aiCandidateAvailable: maskQcAiCandidateRef.current !== null,
              trackerCandidates: maskQcReview.issue
                ? getMaskQcTrackerCandidates(
                    maskQcReview.issue,
                    maskQcReview.issue.frame_start ?? 0,
                  )
                : [],
              trackerCandidateKey: maskQcReview.trackerCandidate?.key ?? null,
              mode: maskQcReview.mode,
              onNavigateIssue: (issue) => {
                void maskQcReview.navigate(issue);
              },
              onReplayFeedback: maskQcReview.replayFeedback,
              onRetryNavigation: maskQcReview.retry,
              onClearIssue: maskQcReview.clear,
              onSetMode: maskQcReview.setMode,
              onSetBaseline: maskQcReview.setBaseline,
              onSetTrackerCandidate: maskQcReview.setTrackerCandidate,
              onDecideTrackerRegion: async (issue, candidate, decision) => {
                const outcome = await trackerJobs.decide(candidate.jobId, {
                  qc_issue_id: issue.id,
                  candidate_digest: candidate.digest,
                  decision,
                });
                if (outcome.ok) maskQcReview.clear();
                return outcome;
              },
              onUpdateIssue: maskQcReview.updateIssue,
            }
          : undefined,
      annotationId: s.selectedId,
      taskId: taskId ?? null,
      projectId: projectId ?? null,
      currentUserId: meUserId ?? null,
      // v0.11.5+ · 评论内画布批注 (live 绘图) + 视频帧锚点 + 点评论跳帧的桥接，
      // 恢复 B1 去 flag 时随 AIInspectorPanel 内嵌一起删掉的接线。
      backgroundUrl: workbenchImagePreview,
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
    preferNonMockModel: allSupportedTrackers.length > 0,
    // 仅把当前项目真正可执行的 tracker 与 provider 下发给选择器。
    supportedTrackers: allSupportedTrackers,
    textDrivenTrackers: allTextDrivenTrackers,
    trackerModelProviders,
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
      ? (trackerJobs.jobs[trackingJobId]?.windowProgress ?? null)
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
    // 按目标逐行展示点数、框数和所在帧；当前目标即下一个种子的归属。
    seedTargets: trackerSeedTargets,
    activeSeedTargetId: seedObj,
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
    preview: trackerReviewCandidate?.preview ?? null,
    submitting: trackerReviewCandidate
      ? Boolean(trackerJobs.submitting[trackerReviewCandidate.jobId])
      : false,
    onDecide: async (selection) => {
      if (!trackerReviewCandidate) return { ok: false, reason: "candidate_missing" };
      return trackerJobs.decide(trackerReviewCandidate.jobId, selection);
    },
    onRefresh: () => {
      if (trackerReviewCandidate) void trackerJobs.refreshReview(trackerReviewCandidate.jobId);
    },
  };

  const maskCorrectionDialogProps: ComponentProps<typeof VideoMaskCorrectionDialog> = {
    open: videoMaskCorrectionOpen,
    frameIndex: videoMaskCorrectionContext?.frameIndex ?? s.videoFrameIndex,
    minFrame: videoMaskCorrectionContext?.segmentStart ?? 0,
    maxFrame: videoMaskCorrectionContext?.segmentEnd ?? Math.max(0, videoFrameCount - 1),
    segmentId: videoMaskCorrectionContext?.segmentId,
    models: correctionModels,
    keyframeSaved: savedVideoMaskCorrection !== null,
    createError: videoMaskCorrectionCreateError,
    createRetryable: videoMaskCorrectionCreateRetryable,
    submitting: videoMaskCorrectionSubmitting,
    onOpenChange: changeVideoMaskCorrectionOpen,
    onSubmit: submitVideoMaskCorrection,
  };

  const conversionDialogProps: ComponentProps<typeof MaskConversionDialog> = {
    open: maskConversionRequest !== null,
    request: maskConversionRequest,
    onOpenChange: (open) => {
      if (!open) setMaskConversionRequest(null);
    },
    onCompleted: completeAnnotationConversion,
  };

  const issueSection =
    projectId && taskId
      ? ({
          openIssueCount,
          stageKind,
          issuePinDropArmed,
          // v0.11.5 · issue FAB → 切到 DiscussionPanel issues tab (旧浮层 IssueListPanel 已删)。
          // v0.13.10+ · 不再把已分离的标注详情合并回去；讨论面板仍嵌入时才展开右栏。
          onOpenList: () => {
            if (!s.workbenchLayout.floatingDiscussion.detached && !s.rightOpen)
              s.setRightOpen(true);
            requestIssuesTab();
          },
          onToggleIssuePinDrop: () => setIssuePinDropArmed((v) => !v),
          createModal: {
            open: issueCreateOpen,
            projectId,
            taskId,
            listParams: issueListParams,
            prefilledAnchor: issuePinPrefill,
            onClose: () => {
              setIssueCreateOpen(false);
              setIssuePinPrefill(null);
            },
          },
        } satisfies WorkbenchShellIssueSection)
      : undefined;

  return {
    kind: "ready",
    layout,
    propagateDialog: propagateDialogProps,
    maskCorrectionDialog: maskCorrectionDialogProps,
    conversionDialog: conversionDialogProps,
    trackerReview: trackerReviewProps,
    issueSection,
  };
}
