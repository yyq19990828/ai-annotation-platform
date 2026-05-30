import {
  useCallback, useEffect, useMemo, useRef, useState, type ComponentProps,
} from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { predictionsApi } from "@/api/predictions";
import type { Annotation, TaskResponse, AnnotationResponse } from "@/types";
import { ANNOTATION_GUIDE_UI_ENABLED } from "@/config/featureFlags";
import { publishTaskBoxCount } from "@/components/PerfHud/useTaskBoxCount";
import { useWorkbenchState } from "./useWorkbenchState";
import { useToolBindings } from "./useToolBindings";
import { useViewportTransform } from "./useViewportTransform";
import { useAnnotationHistory } from "./useAnnotationHistory";
import { useRecentClasses } from "./useRecentClasses";
import { useSessionStats } from "./useSessionStats";
import { useWorkbenchHotkeys } from "./useWorkbenchHotkeys";
import { useCanvasDraftPersistence } from "./useCanvasDraftPersistence";
import { useWorkbenchTaskFlow } from "./useWorkbenchTaskFlow";
import { useInteractiveAI } from "./useInteractiveAI";
import { useMLCapabilities } from "./useMLCapabilities";
import { useAiToolParamPrefs } from "./useAiToolParamPrefs";
import { deriveDefaults, VARIANT_FIELD_KEYS } from "../components/SchemaForm";
import { AIToolDrawer } from "../shell/AIToolDrawer";
import { IssueCreateModal } from "../shell/IssueCreateModal";
import { isAIToolId, TOOL_REGISTRY } from "../stage/tools";
import { useHoveredCommentStore, selectEffectiveShapes } from "./useHoveredCommentStore";
import { useActiveIssueStore } from "./useActiveIssueStore";
import { annotationToBox, collectOccludedKeys } from "./transforms";
import { applyVideoKeyframeToGeometry } from "./videoTrackCommands";
import { useAnnotateMode } from "../modes/useAnnotateMode";
import { useReviewMode } from "../modes/useReviewMode";
import { setActiveClassesConfig, UNKNOWN_CLASS } from "../stage/colors";
import type { VideoStageControls } from "../stage/VideoStage";
import { deriveSamplingStep } from "../stage/videoSamplingGrid";
import { VideoChapterSidebar, pickChapterTargetFrame } from "../stage/VideoChapterSidebar";
import { VideoTrackSidebar } from "../stage/VideoTrackSidebar";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import { isVideoBbox, isVideoTrack, resolveTrackAtFrame } from "../stage/videoStageGeometry";
import type { AnnotationCommentAnchor } from "@/api/comments";
import { useVideoChapters } from "@/hooks/useVideoChapters";
import { useVideoTrackerJobs } from "@/hooks/useVideoTrackerJobs";
import type { VideoTrackAnnotation } from "../stage/videoStageTypes";
import type { StageKind } from "../stages/types";
import { WorkbenchOverlays } from "../shell/WorkbenchOverlays";
import { WorkbenchLayout } from "../shell/WorkbenchLayout";
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
import styles from "../shell/WorkbenchShell.module.css";

const VARIANT_FIELD_SET = new Set<string>(VARIANT_FIELD_KEYS);

function omitVariantFields(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!value) return out;
  for (const [key, v] of Object.entries(value)) {
    if (!VARIANT_FIELD_SET.has(key)) out[key] = v;
  }
  return out;
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

  const projectName = currentProject?.name ?? "标注工作台";
  const projectDisplayId = currentProject?.display_id ?? "—";
  const aiModel = currentProject?.ai_model ?? "未接入模型";

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
  const { data: taskListData, hasNextPage, isFetchingNextPage, fetchNextPage } = useTaskList(projectId, taskListParams);
  const tasks = taskListData?.pages.flatMap((p) => p.items) ?? [];
  const tasksTotal = taskListData?.pages[0]?.total ?? tasks.length;

  const s = useWorkbenchState();
  const toolView = useToolBindings(currentProject ?? null, s.tool);
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
  void toolView.toolUnitId;
  useEffect(() => {
    setActiveClassesConfig(classesConfig);
    return () => setActiveClassesConfig(undefined);
  }, [classesConfig]);
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
  const [aiDrawerOpen, setAiDrawerOpen] = useState(true);
  const [stageGeom, setStageGeom] = useState<{ imgW: number; imgH: number; vpSize: { w: number; h: number } }>({ imgW: 0, imgH: 0, vpSize: { w: 0, h: 0 } });
  const isNarrow = useMediaQuery("(max-width: 1024px)");
  const { recent: recentClasses, record: recordRecentClass } = useRecentClasses(routeId);

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
      .filter((ann) => !(isVideoTask && ann.geometry.type === "video_track"))
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
      if (typeof frame === "number") s.setVideoFrameIndex(frame);
      return;
    }
    const { imgW, imgH, vpSize } = stageGeom;
    if (!imgW || !imgH || !vpSize.w || !vpSize.h) return;
    setVp((cur) => ({
      ...cur,
      tx: vpSize.w / 2 - target.anchor_position!.x * imgW * cur.scale,
      ty: vpSize.h / 2 - target.anchor_position!.y * imgH * cur.scale,
    }));
  }, [issueFocusTick, activeIssueHighlightId, issuesQuery.data, stageGeom, setVp, isVideoTask, s.setVideoFrameIndex]);
  const submitTaskMut = useSubmitTask();
  const triggerPreannotation = useTriggerPreannotation(projectId);
  const { progress: preannotationProgress, connection: preannotationConn, retries: preannotationRetries } =
    usePreannotationProgress(projectId);
  const { lockError, lockConflict, remainingMs } = useTaskLock(taskId);

  const queryClient = useQueryClient();

  const sam = useInteractiveAI({
    projectId,
    taskId,
    mlBackendId: currentProject?.ml_backend_id ?? null,
  });
  const mlCapabilities = useMLCapabilities(
    projectId ?? null,
    currentProject?.ml_backend_id ?? null,
  );
  const aiParamPrefs = useAiToolParamPrefs(currentProject?.ml_backend_id ?? null);
  useEffect(() => {
    sam.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
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
  useEffect(() => {
    if (s.tool === "text-prompt") s.bumpSamTextFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tool]);
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
    s.setAiToolParams({
      ...aiParamDefaults,
      ...omitVariantFields(aiParamPrefs.savedParams),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.ml_backend_id, mlCapabilities.paramsSchema, aiParamPrefs.loaded, aiParamPrefs.savedParams]);
  useEffect(() => {
    if (!currentProject?.ml_backend_id) return;
    if (Object.keys(s.aiToolParams).length === 0) return;
    if (JSON.stringify(s.aiToolParams) === JSON.stringify(aiParamDefaults)) return;
    aiParamPrefs.save({ ...(aiParamPrefs.savedParams ?? {}), ...s.aiToolParams });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.aiToolParams, currentProject?.ml_backend_id]);
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
      if (!ann || ann.geometry.type !== "video_track") throw new Error("Video track not found");
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
    const mlBackendId = currentProject?.ml_backend_id;
    if (!mlBackendId) {
      pushToast({
        msg: "AI 暂不可用",
        sub: "项目尚未绑定 ML 推理后端,请到「项目设置 → AI 配置」注册并选择",
        kind: "error",
      });
      return;
    }
    const aliases: string[] = [];
    const cfg = currentProject?.classes_config ?? {};
    for (const entry of Object.values(cfg)) {
      const alias = (entry as { alias?: string | null } | undefined)?.alias;
      if (typeof alias === "string" && alias.trim()) aliases.push(alias.trim());
    }
    if (aliases.length === 0) {
      pushToast({
        msg: "AI 暂不可用",
        sub: "项目类别未配置英文 alias,请到「项目设置 → 类别与属性」补全",
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
        // v0.11.24 · 工作台手动「AI 分析」= 重跑覆盖，替换旧 AI 预测（保留人工标注），
        // 否则默认 skip_predicted 会让已预标任务再点无反应。
        predict_mode: "overwrite",
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

  const leftOpen = isNarrow ? false : s.leftOpen;
  const rightOpen = isNarrow ? false : s.rightOpen;
  const toggleLeftSidebar = useCallback(() => {
    s.setLeftOpen(!s.leftOpen);
  }, [s.leftOpen, s.setLeftOpen]);
  const toggleRightSidebar = useCallback(() => {
    s.setRightOpen(!s.rightOpen);
  }, [s.rightOpen, s.setRightOpen]);
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

  if (isProjectLoading) {
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

  if (tasks.length === 0) {
    return {
      kind: "empty",
      emptyState: {
        icon: "inbox",
        message: "该项目暂无任务",
        onBack,
      },
    };
  }

  const propagateDialogTrack = propagateDialog?.annotation ?? null;
  const propagateDialogNextKeyframe = propagateDialogTrack
    ? [...propagateDialogTrack.geometry.keyframes]
        .map((kf) => kf.frame_index)
        .filter((idx) => idx > s.videoFrameIndex)
        .sort((a, b) => a - b)[0] ?? null
    : null;

  const layout: ComponentProps<typeof WorkbenchLayout> = {
    gridTemplateColumns: `${leftOpen ? `${s.leftWidth}px` : "0px"} 48px 1fr ${rightOpen ? `${s.rightWidth}px` : "0px"}`,
    taskQueue: {
      open: leftOpen, classes, classesConfig: currentProject?.classes_config,
      toolLabel: TOOL_REGISTRY[s.tool].label, toolIcon: TOOL_REGISTRY[s.tool].icon,
      activeClass: s.activeClass, recentClasses, tasks, taskId, taskIdx, hasNextPage,
      isFetchingNextPage, onFetchNextPage: fetchNextPage,
      onSelectTask: selectTask, batches: activeBatches, selectedBatchId, onSelectBatch: handleSelectBatch,
      totalCount: tasksTotal, isOwner, onGoToBatchSettings: () => { if (projectId) navigate(`/projects/${projectId}/settings?section=batches`); },
      width: s.leftWidth, onResize: s.setLeftWidth,
    },
    toolDock: {
      tool: s.tool,
      onSetTool: (next) => {
        s.setTool(next);
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
      hideOrphanAnnotations,
      onToggleHideOrphans: () => setHideOrphanAnnotations((value) => !value),
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
      },
      image: {
        fileUrl,
        blurhash,
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
          const extra = { ...s.aiVariant, ...s.aiToolParams };
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
      open: rightOpen, width: s.rightWidth, onResize: s.setRightWidth, readOnly: isLocked,
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
          <VideoTrackSidebar
            annotations={visibleAnnotationsData}
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
    },
    aiPopover: {
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
      paramsSchema: mlCapabilities.paramsSchema,
      supportedVariants: mlCapabilities.capability?.supported_variants,
      aiVariant: s.aiVariant,
      onSetAiVariant: s.setAiVariant,
      params: s.aiToolParams,
      onSetParams: s.setAiToolParams,
    },
    hotkeys: { open: showHotkeys, onClose: () => setShowHotkeys(false), attributeSchema: toolView.attributeSchema },
    offlineQueue: { open: offlineDrawerOpen, onClose: closeOfflineDrawer, currentTaskId: taskId, onFlushOne: executeOp, onFlushAll: flushOffline },
    conflict: { open: conflictOpen, onReload: handleConflictReload, onOverwrite: handleConflictOverwrite, onClose: () => setConflictOpen(false) },
    rejectModal: modeState.rejectModal ? {
      open: modeState.rejectModal.open, count: 1, onClose: modeState.rejectModal.onClose,
      onConfirm: modeState.rejectModal.onConfirm, skipReasonHint: modeState.rejectModal.skipReasonHint,
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
    },
  };

  const propagateDialogProps: ComponentProps<typeof VideoTrackerPropagateDialog> = {
    open: Boolean(propagateDialog),
    frameIndex: s.videoFrameIndex,
    maxFrame: Math.max(0, videoFrameCount - 1),
    nextKeyframeAfter: propagateDialogNextKeyframe,
    samplingStep,
    submitting: Boolean(propagateDialog?.submitting),
    onCancel: () => setPropagateDialog(null),
    onSubmit: handlePropagateSubmit,
  };

  const issueSection = projectId && taskId ? {
    openIssueCount,
    stageKind,
    issuePinDropArmed,
    // v0.11.5 · issue FAB → 切到 DiscussionPanel issues tab (旧浮层 IssueListPanel 已删)。
    // DiscussionPanel 在右栏内，右栏收起时列宽为 0px 被裁切，故先确保右栏展开再切 tab。
    onOpenList: () => {
      if (!s.rightOpen) s.setRightOpen(true);
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
