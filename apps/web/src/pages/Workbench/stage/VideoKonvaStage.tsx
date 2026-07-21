import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Stage, Layer, Line, Circle } from "react-konva";
import type Konva from "konva";
import { Icon } from "@/components/ui/Icon";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { DropdownItem } from "@/components/ui/DropdownMenu";
import type { AnnotationResponse, TaskVideoFrameTimetableResponse, TaskVideoManifestResponse, VideoBboxGeometry, VideoPolygonGeometry, VideoPolylineGeometry, VideoSamplingConfig, VideoTrackGeometry, VideoTrackMaskGeometry, VideoTrackPolygonGeometry, VideoTrackPolylineGeometry } from "@/types";
import type { WorkbenchCommonPreferences } from "@/api/auth";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { useElementSize, useViewportTransform } from "../state/useViewportTransform";
import type { PendingDrawing, VideoTool } from "../state/useWorkbenchState";
import type { DiffMode } from "../modes/types";
import { FloatingDock } from "../shell/FloatingDock";
import { Minimap } from "./Minimap";
import { VideoKonvaMediaLayer, pickMediaImageSource } from "./VideoKonvaMediaLayer";
import { VideoKonvaTracksLayer } from "./VideoKonvaTracksLayer";
import { VideoKonvaMaskLayer } from "./VideoKonvaMaskLayer";
import { MaskOverlayLayer } from "./overlays/MaskOverlayLayer";
import type { UseMaskEditorReturn } from "../state/useMaskEditor";
import { canCommitMask, canEditMask } from "../state/canEditMask";
import { VideoKonvaOverlayLayer } from "./VideoKonvaOverlayLayer";
import { VideoKonvaIssueLayer } from "./VideoKonvaIssueLayer";
import { VideoKonvaInteractionLayer, type VideoHandleBox, type VideoPreviewBox } from "./VideoKonvaInteractionLayer";
import {
  VideoPlaybackOverlay,
  type VideoLargeFrameStep,
  type VideoTimelineChapter,
  type VideoTimelineChapterControls,
} from "./VideoPlaybackOverlay";
import { VideoQcWarnings } from "./VideoQcWarnings";
import { useVideoKonvaInteraction, isSamProbeTool } from "./videoKonvaInteraction";
import { videoIntrinsicSize, clientToVideoNorm, videoNormToClient } from "./videoKonvaCoordinates";
import { deriveVideoFrameViews } from "./videoFrameViews";
import { useVideoReferenceConfig } from "./videoReferencePredict";
import { classColor, colorToHex, getTrackColor, hexToRgba } from "./colors";
import { useVideoPolygonDraft } from "./useVideoPolygonDraft";
import { CLOSE_DISTANCE } from "./tools/PolygonTool";
import { deriveTrackNumber, isAnyVideoSingleFrame, isAnyVideoTrack, isVideoBbox, isVideoPolygon, isVideoPolygonTrack, isVideoPolyline, isVideoPolylineTrack, isVideoTrack, normalizeGeom, shapeIou, shortTrackId, sortedKeyframes } from "./videoStageGeometry";
import { buildSelectedTrackTimeline } from "./videoTrackTimeline";
import { pickTopVideoEntryAt, pickTopVideoMaskAt } from "./videoStagePicking";
import { useVideoMaskFrames, type VideoMaskCandidate } from "./videoMaskFrames";
import { useVideoTrackActions } from "./useVideoTrackActions";
import { buildVideoContextMenuItems } from "./videoContextMenuItems";
import { useCanvasContextMenu } from "./useCanvasContextMenu";
import type { VideoManagedTrackAnnotation, VideoTrackCompositionOptions, VideoTrackConversionOptions, VideoSamPrompt } from "./videoStageTypes";
import { DEFAULT_ANNOTATION_VISUAL, type AnnotationVisualConfig } from "./annotationVisual";
import { clampScale } from "./shared/viewport/zoom";
import { useVideoPlaybackController } from "./useVideoPlaybackController";
import type { VideoLoopRegion } from "./videoNavigationState";
import { collectPredictedFrames, resolveAiBoxAtFrame } from "./aiBoxFrames";
import { collectFrameCategories, nextInCategory, nextCategory, type FrameObjectRef } from "./frameObjectCycle";
import type { VideoStageControls } from "./videoStageControls";
import { VideoKonvaAiLayer } from "./VideoKonvaAiLayer";
import { VideoSamCandidateOverlay, type VideoSamCandidateShape } from "./VideoSamCandidateOverlay";
import { SelectionOverlay } from "./SelectionOverlay";
import { VideoStickyTrackHint } from "./VideoStickyTrackHint";
import type { AiBox } from "../state/transforms";
import styles from "./VideoKonvaStage.module.css";

/** v0.21.23 · SAM 提示框描边色，与图片侧 SAM_CANDIDATE_STROKE 同值（canvas 数据域颜色）。 */
const SAM_PROBE_STROKE = "#a855f7";
const EMPTY_SAM_CANDIDATES: VideoSamCandidateShape[] = [];
const EMPTY_SESSION_POINTS: { pt: [number, number]; polarity: 1 | 0; obj?: number }[] = [];
const EMPTY_SESSION_BOXES: { bbox: [number, number, number, number]; obj?: number }[] = [];
const EMPTY_ANNOTATIONS: AnnotationResponse[] = [];
const EMPTY_AI_BOXES: AiBox[] = [];
const EMPTY_LOCKED = new Set<string>();
// 解构默认值写 `= []` 会每次渲染产生新引用, 把 frameViews 的 memo 打穿(视频画布逐帧重算)。
const EMPTY_SELECTED_IDS: string[] = [];
const EMPTY_MASK_CANDIDATES: VideoMaskCandidate[] = [];

interface VideoKonvaStageProps {
  manifest: TaskVideoManifestResponse | undefined;
  frameTimetable?: TaskVideoFrameTimetableResponse;
  isLoading?: boolean;
  error?: unknown;
  frameIndex?: number;
  autoFitOnResize?: boolean;
  /** v0.21.11 · 选中自动聚焦(common.focusSelectionEnabled); 关闭时选中不移动视口。 */
  focusSelectionEnabled?: boolean;
  /** v0.21.12 · 轨迹「续写后自动前进」(video.trackContinueAutoAdvance); 续写完自动选中下一条待续轨迹。 */
  trackContinueAutoAdvance?: boolean;
  performanceTier?: WorkbenchCommonPreferences["performanceTier"];
  onFrameIndexChange?: (frameIndex: number) => void;
  annotations?: AnnotationResponse[];
  /** v0.21.4 · AI 候选框(全部帧); 舞台内按当前帧过滤 video_bbox 渲染 + 采纳/驳回。 */
  aiBoxes?: AiBox[];
  selectedId?: string | null;
  hiddenTrackIds?: Set<string>;
  reviewDisplayMode?: DiffMode;
  trackColorOverrides?: Record<string, string>;
  activeClass?: string;
  pendingDrawing?: PendingDrawing;
  issuePixelFeedbacks?: AnnotationFeedback[];
  issueHighlightId?: string | null;
  /** 单击 issue 图钉(Shell 据此高亮 + 切到讨论面板 issues tab)。 */
  onIssuePinClick?: (id: string) => void;
  /** 共享视觉规格(线宽/填充/字号/标签);与图片同源。缺省回退默认值。 */
  visual?: AnnotationVisualConfig;
  videoTool?: VideoTool;
  /** 视频工具可用性谓词 (按几何单位 enabled + 单帧/轨迹子开关, 见 stage/videoToolUnits)。 */
  isVideoToolEnabled?: (t: VideoTool) => boolean;
  spacePan?: boolean;
  onSpacePanDragStart?: () => void;
  readOnly?: boolean;
  lockedTrackIds?: Set<string>;
  selectedIds?: string[];
  onSelect?: (id: string | null, opts?: { shift?: boolean }) => void;
  /** 光标归一化坐标上报(供状态栏坐标读出);离开画布时上报 null。 */
  onCursorMove?: (pt: { x: number; y: number } | null) => void;
  onCreate?: (frameIndex: number, geom: { x: number; y: number; w: number; h: number }) => void;
  /** v0.21.20 · 由绘制顶点新建 polygon/polyline track (单关键帧于当前帧)。 */
  onCreatePointsTrack?: (
    type: "video_track_polygon" | "video_track_polyline",
    frameIndex: number,
    points: [number, number][],
  ) => void;
  /** v0.21.21 · 由绘制顶点新建单帧 polygon/polyline (video_polygon/video_polyline)。 */
  onCreatePoints?: (
    type: "video_polygon" | "video_polyline",
    frameIndex: number,
    points: [number, number][],
  ) => void;
  onPendingDraw?: (
    kind: "video_bbox" | "video_track_bbox",
    frameIndex: number,
    geom: { x: number; y: number; w: number; h: number },
    anchor: { left: number; top: number },
  ) => void;
  onUpdate?: (annotation: AnnotationResponse, geometry: VideoBboxGeometry | VideoTrackGeometry | VideoTrackMaskGeometry | VideoPolygonGeometry | VideoPolylineGeometry | VideoTrackPolygonGeometry | VideoTrackPolylineGeometry) => void;
  /** v0.21.23 · 交互式 SAM 提示松手 (归一化坐标)；由 shell 取当前帧图请求候选。 */
  onSamPrompt?: (prompt: VideoSamPrompt) => void;
  /** v0.21.23 · 交互式 SAM 的瞬态候选（不落库；采纳时才建标注）。 */
  samCandidates?: VideoSamCandidateShape[];
  samActiveIdx?: number;
  /** 当前点会话已落的正/负点（多点精修可视化）。 */
  samSessionPoints?: { pt: [number, number]; polarity: 1 | 0; obj?: number }[];
  /** v0.21.27 · 框修正 · 当前帧已落的 PVS 框种子（归一化 xyxy）。 */
  samSessionBoxes?: { bbox: [number, number, number, number]; obj?: number }[];
  /** 追踪任务尚未接受的 mask 候选；使用 job 级内容端点解码。 */
  maskCandidates?: VideoMaskCandidate[];
  maskEditor?: UseMaskEditorReturn;
  onMaskCommit?: () => void;
  onMaskCancel?: () => void;
  /** 工具条上的正/负切换; 与 Alt 等价。 */
  samPolarity?: "positive" | "negative";
  onChangeUserBoxClass?: (id: string) => void;
  onComposeTracks?: (options: VideoTrackCompositionOptions) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  onDelete?: (annotation: AnnotationResponse) => void;
  /** v0.21.4 · AI 候选采纳 / 驳回(贴框快捷条, 复用图片工作台的 handleAcceptPrediction/Reject)。 */
  onAcceptPrediction?: (b: AiBox) => void;
  onRejectPrediction?: (b: AiBox) => void;
  onPropagateTrack?: (annotation: VideoManagedTrackAnnotation) => void;
  onToggleHiddenTrack?: (trackId: string) => void;
  onToggleLockedTrack?: (trackId: string) => void;
  /** 时间轴章节(从工作台 shell 透传)。 */
  chapters?: VideoTimelineChapter[];
  /** v0.21.13 · 章节 × 时间轴联动控制器 (刷选建章节 / resize / hover)。 */
  timelineChapterControls?: VideoTimelineChapterControls;
  /** v0.21.14 WS3 · AI 传播对话框打开时在时间轴高亮的影响范围。 */
  propagateRange?: VideoLoopRegion | null;
  /** 采样配置(帧网格步进策略)。 */
  videoSampling?: VideoSamplingConfig | null;
  /** 默认播放速率。 */
  defaultPlaybackRate?: number;
  /** Shift+←/→ 大步进策略(默认 10)。 */
  largeFrameStep?: VideoLargeFrameStep;
}

const CONTEXT_MENU_DRAG_THRESHOLD_PX = 5;

const noop = () => {};

/**
 * 视频 Konva 渲染栈容器(v0.16.1–v0.16.5)。
 *
 * 底图/播放/标注/交互/右键菜单全栈进 Konva,并补齐旧 SVG 栈的 chrome 奇偶性:
 * VideoPlaybackOverlay(时间轴)、Minimap、VideoQcWarnings。关键帧跳转改由画布内
 * 选中卡(VideoTrackCardContent)承载,旧右上 <details> 快跳浮层已退役。
 * 所有播放/逐帧/书签/循环区间逻辑委托给 useVideoPlaybackController。
 */
export const VideoKonvaStage = forwardRef<VideoStageControls, VideoKonvaStageProps>(function VideoKonvaStage({
  manifest,
  frameTimetable,
  isLoading = false,
  error,
  frameIndex: controlledFrameIndex,
  autoFitOnResize = true,
  focusSelectionEnabled = false,
  trackContinueAutoAdvance = false,
  performanceTier = "standard",
  onFrameIndexChange,
  annotations = EMPTY_ANNOTATIONS,
  aiBoxes = EMPTY_AI_BOXES,
  selectedId = null,
  hiddenTrackIds,
  reviewDisplayMode,
  trackColorOverrides,
  activeClass = "",
  pendingDrawing = null,
  issuePixelFeedbacks,
  issueHighlightId,
  onIssuePinClick,
  visual = DEFAULT_ANNOTATION_VISUAL,
  videoTool = "select",
  isVideoToolEnabled,
  spacePan = false,
  onSpacePanDragStart,
  readOnly = false,
  lockedTrackIds = EMPTY_LOCKED,
  selectedIds = EMPTY_SELECTED_IDS,
  onSelect,
  onCursorMove,
  onCreate,
  onCreatePointsTrack,
  onCreatePoints,
  onPendingDraw,
  onUpdate,
  onSamPrompt,
  samCandidates = EMPTY_SAM_CANDIDATES,
  samActiveIdx = 0,
  samSessionPoints = EMPTY_SESSION_POINTS,
  samSessionBoxes = EMPTY_SESSION_BOXES,
  maskCandidates = EMPTY_MASK_CANDIDATES,
  maskEditor,
  onMaskCommit,
  onMaskCancel,
  samPolarity,
  onChangeUserBoxClass,
  onComposeTracks,
  onConvertToBboxes,
  onDelete,
  onAcceptPrediction,
  onRejectPrediction,
  onPropagateTrack,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  chapters = [],
  timelineChapterControls,
  propagateRange = null,
  videoSampling = null,
  defaultPlaybackRate,
  largeFrameStep = 10,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const setVideoNode = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoEl(node);
  }, []);

  const { ref: setContainerNode, size: viewportSize } = useElementSize(containerRef);
  const { vp, vpRef, setVp, fit, zoomAt } = useViewportTransform();

  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const maskStrokeRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const [maskCursor, setMaskCursor] = useState<{ x: number; y: number } | null>(null);

  // v0.16.3 · 交互:选中轨迹(供 track 工具画框落关键帧 + ghost 可编辑判定)。
  const selectedTrack = useMemo(() => {
    const a = annotations.find((x) => x.id === selectedId);
    return a && isVideoTrack(a) ? a : null;
  }, [annotations, selectedId]);
  const selectedManagedTrack = useMemo<VideoManagedTrackAnnotation | null>(() => {
    const annotation = annotations.find((item) => item.id === selectedId);
    return annotation && (isVideoTrack(annotation) || annotation.geometry.type === "video_track_mask")
      ? annotation as VideoManagedTrackAnnotation
      : null;
  }, [annotations, selectedId]);

  const noopSelect = useCallback(() => {}, []);
  const noopCreate = useCallback(() => {}, []);
  const noopUpdate = useCallback(() => {}, []);

  const size = useMemo(
    () => videoIntrinsicSize(manifest?.metadata.width, manifest?.metadata.height),
    [manifest?.metadata.height, manifest?.metadata.width],
  );

  // 右键上下文菜单状态
  const contextMenu = useCanvasContextMenu();
  const [contextMenuTargetId, setContextMenuTargetId] = useState<string | null>(null);
  const rightDownRef = useRef<{ x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => {
    contextMenu.close();
    setContextMenuTargetId(null);
  }, [contextMenu]);

  // v0.21.9 · 预测帧集合 (video_bbox 帧号 + video_track_bbox 关键帧号, 去重升序); 喂时间轴预测密度轨。
  const predictedFrames = useMemo(() => collectPredictedFrames(aiBoxes), [aiBoxes]);

  // ---- useVideoPlaybackController ----
  // currentFrameEntries 供 QC 用,控制器内部用它做重叠率计算。
  // 此处传空数组占位 — 重叠率 QC 会不计分,属于可接受的简化(旧栈的 currentFrameEntries 走的
  // 是同一帧解析,与 frameViews.entries 语义等价;后续可回填)。
  const controller = useVideoPlaybackController({
    manifest,
    frameTimetable,
    videoRef,
    controlledFrameIndex,
    onFrameIndexChange,
    onSelect: onSelect as ((id: string | null) => void) | undefined,
    performanceTier,
    videoSampling,
    defaultPlaybackRate: defaultPlaybackRate as (1 | 0.25 | 0.5 | 2 | 4) | undefined,
    annotations,
    predictedFrames,
    selectedId,
    selectedTrack,
    trackColorOverrides,
    hiddenTrackIds: hiddenTrackIds ?? EMPTY_LOCKED,
    lockedTrackIds,
    readOnly,
    drag: null,
    currentFrameEntries: [],
    issuePixelFeedbacks,
    onUpdate: (onUpdate ?? noopUpdate) as Parameters<typeof useVideoPlaybackController>[0]["onUpdate"],
    onToggleHiddenTrack,
    onToggleLockedTrack,
    onPropagateTrack,
  });

  const {
    frameIndex,
    isPlaybackActive,
    isJogPlaying,
    jogPlayback,
    playbackError,
    activeBitmap,
    cachedRanges,
    framePreview,
    previewFrame,
    samplingStep,
    maxFrame,
    timebase,
    selectedTrackTimeline,
    selectedTrackColor,
    globalTimelineDensity,
    predictionDensity,
    hasPredictedFrames,
    seekToAdjacentPredictedFrame,
    issueFrames,
    playbackOverlayVisible,
    highlightAction,
    bookmarks,
    loopRegion,
    showPlaybackOverlay,
    schedulePlaybackOverlayHide,
    setNormalizedLoopRegion,
    clearLoopRegion,
    seekToFrame,
    seekOverlayByFrames,
    pausePlayback,
    controls,
  } = controller;

  const effectiveSelectedTrackTimeline = useMemo(
    () => selectedManagedTrack?.geometry.type === "video_track_mask"
      ? buildSelectedTrackTimeline(selectedManagedTrack.geometry, "held")
      : selectedTrackTimeline,
    [selectedManagedTrack, selectedTrackTimeline],
  );
  const effectiveSelectedTrackColor = useMemo(
    () => selectedManagedTrack?.geometry.type === "video_track_mask"
      ? getTrackColor(
          selectedManagedTrack.geometry.track_id,
          selectedManagedTrack.class_name,
          trackColorOverrides,
        )
      : selectedTrackColor,
    [selectedManagedTrack, selectedTrackColor, trackColorOverrides],
  );

  // 当前帧的 pending draft(仅本帧的 video_bbox/video_track_bbox 草稿)。
  const pendingDraft = useMemo(() => {
    if (
      !pendingDrawing
      || (pendingDrawing.kind !== "video_bbox" && pendingDrawing.kind !== "video_track_bbox")
      || pendingDrawing.frameIndex !== frameIndex
    ) {
      return null;
    }
    return { geom: pendingDrawing.geom, className: activeClass || "未分类" };
  }, [activeClass, frameIndex, pendingDrawing]);

  // 标注渲染派生(纯函数,与 VideoStage 现状对齐)。
  const referenceConfig = useVideoReferenceConfig();
  const frameViews = useMemo(
    () => deriveVideoFrameViews({
      annotations,
      frameIndex,
      selectedId,
      selectedIds,
      hiddenTrackIds,
      lockedTrackIds,
      reviewDisplayMode,
      trackColorOverrides,
      visual,
      referenceConfig,
      pendingDraft,
      samplingStep,
    }),
    [annotations, frameIndex, hiddenTrackIds, lockedTrackIds, pendingDraft, referenceConfig, reviewDisplayMode, samplingStep, selectedId, selectedIds, trackColorOverrides, visual],
  );

  const visibleMaskAnnotations = useMemo(
    () => annotations.filter((annotation) => {
      if (annotation.geometry.type !== "video_track_mask") return false;
      return !hiddenTrackIds?.has(annotation.geometry.track_id);
    }),
    [annotations, hiddenTrackIds],
  );
  const maskColorForAnnotation = useCallback(
    (annotation: AnnotationResponse) => {
      if (annotation.geometry.type !== "video_track_mask") return "#a855f7";
      return colorToHex(getTrackColor(
        annotation.geometry.track_id,
        annotation.class_name,
        trackColorOverrides,
      ));
    },
    [trackColorOverrides],
  );
  const maskRecords = useVideoMaskFrames({
    taskId: manifest?.task_id ?? null,
    annotations: visibleMaskAnnotations,
    candidates: maskCandidates,
    frameIndex,
    selectedId,
    colorForAnnotation: maskColorForAnnotation,
  });
  const committedMaskRecords = useMemo(
    () => maskRecords.filter((record) => record.source === "annotation"),
    [maskRecords],
  );
  const displayedMaskRecords = useMemo(
    () => maskEditor?.active && selectedId
      ? maskRecords.filter((record) => record.source === "tracker" || record.id !== selectedId)
      : maskRecords,
    [maskEditor?.active, maskRecords, selectedId],
  );

  // v0.21.4 · AI 候选按当前帧过滤(镜像 deriveVideoFrameViews 对 video_bbox 的帧过滤)。
  // v0.21.9 WS2 · 检测式轨迹候选(video_track_bbox)也纳入: 用 resolveTrackAtFrame 解出当前帧框,
  //   与逐帧 video_bbox 候选同层渲染(此前只在侧栏可见、画布不画)。
  const frameAiBoxes = useMemo(
    () =>
      aiBoxes
        .map((b) => resolveAiBoxAtFrame(b, frameIndex))
        .filter((b): b is (typeof aiBoxes)[number] => b !== null),
    [aiBoxes, frameIndex],
  );
  const selectedAiBox = useMemo(
    () => frameAiBoxes.find((b) => b.id === selectedId) ?? null,
    [frameAiBoxes, selectedId],
  );

  // v0.21.11 · 当前帧三类对象(AI 待审 / 人工 video_bbox / 轨迹当前帧视图)分类 + 空间排序,
  // 供 Tab 同类流转 / ` 跨类跳转。人工 vs 轨迹按 annotation.geometry 类型判别; AI 用扁平 x/y。
  // v0.21.12 · 跨网格帧续写待续轨迹(carryOverGhosts)并入「轨迹」类一起循环。
  // fix · 选中轨迹的参考虚影(ghost)也必须并入「轨迹」类, 否则选中它时 Tab 只在两条间弹
  //       (根因见 collectFrameCategories.selectedTrackGhost 注释)。
  const frameCategories = useMemo(() => {
    const ai: FrameObjectRef[] = frameAiBoxes.map((b) => ({ id: b.id, x: b.x, y: b.y }));
    const entries = frameViews.entries.map((entry) => {
      const ann = annotations.find((a) => a.id === entry.id);
      return { id: entry.id, x: entry.geom.x, y: entry.geom.y, isTrack: Boolean(ann && isVideoTrack(ann)) };
    });
    for (const mask of committedMaskRecords) {
      entries.push({ id: mask.id, x: mask.geom.x, y: mask.geom.y, isTrack: true });
    }
    const carryOverGhosts = frameViews.carryOverGhosts.map((g) => ({ id: g.id, x: g.geom.x, y: g.geom.y }));
    const selectedTrackGhost = frameViews.ghost
      ? { id: frameViews.ghost.id, x: frameViews.ghost.geom.x, y: frameViews.ghost.geom.y }
      : null;
    return collectFrameCategories({ ai, entries, carryOverGhosts, selectedTrackGhost });
  }, [annotations, committedMaskRecords, frameAiBoxes, frameViews.carryOverGhosts, frameViews.entries, frameViews.ghost]);

  const cycleInCategory = useCallback((dir: -1 | 1) => {
    const next = nextInCategory(frameCategories, selectedId, dir);
    if (next) onSelect?.(next);
  }, [frameCategories, onSelect, selectedId]);

  const stepCategory = useCallback((dir: -1 | 1) => {
    const next = nextCategory(frameCategories, selectedId, dir);
    if (next) onSelect?.(next);
  }, [frameCategories, onSelect, selectedId]);

  // v0.21.11 WS2 · 焦点联动: 把对象平移居中(仅出视口/过小才动, 保守不打断已在视口的选中)。
  const focusObject = useCallback((id: string) => {
    if (!viewportSize.w || !viewportSize.h || !size.w || !size.h) return;
    const ai = frameAiBoxes.find((b) => b.id === id);
    const geom = ai
      ? { x: ai.x, y: ai.y, w: ai.w, h: ai.h }
      : frameViews.entries.find((e) => e.id === id)?.geom
        ?? frameViews.carryOverGhosts.find((g) => g.id === id)?.geom
        ?? committedMaskRecords.find((mask) => mask.id === id)?.geom
        ?? null;
    if (!geom) return;
    const cur = vpRef.current;
    const cx = (geom.x + geom.w / 2) * size.w;
    const cy = (geom.y + geom.h / 2) * size.h;
    const objMaxDimPx = Math.max(geom.w * size.w, geom.h * size.h, 1);
    // 保守缩放: 仅当对象在屏过小才放大到舒适尺寸, 否则保持当前 scale(优先平移居中)。
    let scale = cur.scale;
    if (objMaxDimPx * scale < 48) scale = clampScale(140 / objMaxDimPx);
    const margin = 48;
    const screenCx = cx * scale + cur.tx;
    const screenCy = cy * scale + cur.ty;
    const outOfView =
      screenCx < margin || screenCx > viewportSize.w - margin ||
      screenCy < margin || screenCy > viewportSize.h - margin;
    // 已在视口内且无需变焦 → 不动(避免每次选中都重排, 保留上下文)。
    if (!outOfView && scale === cur.scale) return;
    setVp({ scale, tx: viewportSize.w / 2 - cx * scale, ty: viewportSize.h / 2 - cy * scale });
  }, [committedMaskRecords, frameAiBoxes, frameViews.carryOverGhosts, frameViews.entries, setVp, size.h, size.w, viewportSize.h, viewportSize.w, vpRef]);

  // 选中变化即触发焦点联动(键盘两级循环 / 侧栏点选 / 画布点选统一走此)。用 ref 读最新 focusObject,
  // 使 effect 只在 selectedId 变化时跑 —— 否则 focusObject 逐帧变身份会让播放中每帧重排。
  const focusObjectRef = useRef(focusObject);
  focusObjectRef.current = focusObject;
  useEffect(() => {
    if (focusSelectionEnabled && selectedId) focusObjectRef.current(selectedId);
  }, [focusSelectionEnabled, selectedId]);

  // QC 质量警告(关键帧间隔过大 / 当前帧极小框 / 同类高重叠)——与旧 SVG 栈 qualityWarnings 逐位一致。
  // 用当前帧 frameViews.entries(带 geom+className),解决控制器内因 frameIndex→entries 循环依赖
  // 而拿不到当前帧框的问题(此处 entries 已在 controller.frameIndex 之后派生)。
  const videoTracks = useMemo(() => annotations.filter(isVideoTrack), [annotations]);
  const qualityWarnings = useMemo(() => {
    const warnings: string[] = [];
    const maxGap = Math.max(30, Math.round(timebase.fps * 2));
    for (const ann of videoTracks) {
      const keyframes = sortedKeyframes(ann.geometry);
      for (let i = 1; i < keyframes.length; i++) {
        const gap = keyframes[i].frame_index - keyframes[i - 1].frame_index;
        if (gap > maxGap) {
          warnings.push(`${ann.class_name} ${shortTrackId(ann.geometry.track_id)} 关键帧间隔 ${gap} 帧`);
          break;
        }
      }
    }
    const entries = frameViews.entries;
    for (const entry of entries) {
      if (entry.geom.w < 0.003 || entry.geom.h < 0.003) warnings.push(`${entry.className} 当前帧存在极小框`);
    }
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.className === b.className && shapeIou(a.geom, b.geom) > 0.9) {
          warnings.push(`${a.className} 当前帧存在高度重叠框`);
        }
      }
    }
    return [...new Set(warnings)].slice(0, 3);
  }, [frameViews.entries, timebase.fps, videoTracks]);

  const interaction = useVideoKonvaInteraction({
    containerRef,
    vpRef,
    size,
    annotations,
    entries: frameViews.entries,
    maskEntries: committedMaskRecords,
    ghost: frameViews.ghost,
    carryOverGhosts: frameViews.carryOverGhosts,
    selectedTrack,
    videoTool,
    creationEnabled: (videoTool === "box" || videoTool === "track") && (!isVideoToolEnabled || isVideoToolEnabled(videoTool)),
    readOnly,
    isPlaybackActive,
    lockedTrackIds,
    frameIndex,
    trackContinueAutoAdvance,
    onSelect: onSelect ?? noopSelect,
    onCreate: onCreate ?? noopCreate,
    onPendingDraw,
    onUpdate: onUpdate ?? noopUpdate,
    onSamPrompt,
    samPolarity,
  });
  const { drag } = interaction;

  // v0.21.20/21 · polygon/polyline 绘制 (点击落点, Enter/双击闭合)。与拖拽 bbox 正交。
  // 四工具: polygon/polyline = 单帧几何; polygon-track/polyline-track = 轨迹关键帧。
  const pointsDraft = useVideoPolygonDraft();
  // 绘制中的光标归一化坐标(橡皮筋预览段 + 首点吸附高亮用),越界/未绘制时 null。
  const [pointsCursor, setPointsCursor] = useState<{ x: number; y: number } | null>(null);
  const isPointsClosedTool = videoTool === "polygon" || videoTool === "polygon-track";
  const isPointsDrawTool = isPointsClosedTool || videoTool === "polyline" || videoTool === "polyline-track";
  const pointsDrawEnabled = isPointsDrawTool && !readOnly && !isPlaybackActive
    && (!isVideoToolEnabled || isVideoToolEnabled(videoTool));

  const pointFromClientEvt = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return clientToVideoNorm(clientX, clientY, rect, vpRef.current, size);
  }, [size, vpRef]);

  const commitPointsDraft = useCallback(() => {
    const pts = pointsDraft.commit();
    if (!pts) return;
    if (videoTool === "polygon-track" || videoTool === "polyline-track") {
      onCreatePointsTrack?.(
        videoTool === "polyline-track" ? "video_track_polyline" : "video_track_polygon",
        frameIndex,
        pts,
      );
    } else {
      onCreatePoints?.(
        videoTool === "polyline" ? "video_polyline" : "video_polygon",
        frameIndex,
        pts,
      );
    }
  }, [pointsDraft, onCreatePointsTrack, onCreatePoints, videoTool, frameIndex]);

  // 落点: polygon/polyline 工具下 Stage pointerdown 累加顶点 (阻断拖拽/选择分流)。
  const handleStagePointerDown = useCallback((e: Parameters<typeof interaction.onStagePointerDown>[0]) => {
    // v0.23.5 · WS-C · 视频 mask 落点经 canEditMask: 同时检查 task readOnly、选中轨迹 lock、
    // annotation is_locked, 关闭锁定对象经视频 pointer 路径修改的绕过。
    const selectedTrackId = selectedManagedTrack?.geometry.track_id;
    const maskEditable = !!maskEditor && canEditMask({
      taskReadOnly: !!readOnly || isPlaybackActive,
      annotationLocked: !!selectedManagedTrack?.is_locked,
      trackLocked: !!selectedTrackId && lockedTrackIds.has(selectedTrackId),
      segmentLocked: false,
      editorPhase: maskEditor.phase ?? (maskEditor.dirty ? "dirty" : maskEditor.active ? "ready" : "idle"),
    });
    if (videoTool === "mask" && maskEditor && maskEditable) {
      const native = e.evt;
      if (native.button !== 0) return;
      const point = pointFromClientEvt(native.clientX, native.clientY);
      if (!point) return;
      e.cancelBubble = true;
      containerRef.current?.setPointerCapture?.(native.pointerId);
      if (!maskEditor.active) maskEditor.beginBlank();
      maskEditor.beginStroke();
      const x = point.x * size.w;
      const y = point.y * size.h;
      maskEditor.paintAt(x, y);
      maskStrokeRef.current = { lastX: x, lastY: y };
      setMaskCursor(point);
      return;
    }
    if (pointsDrawEnabled) {
      const native = e.evt;
      if (native.button !== 0) return; // 右键/中键平移交容器层
      const pt = pointFromClientEvt(native.clientX, native.clientY);
      if (!pt) return;
      // polygon: 点击落在首点吸附半径内 → 闭合提交(需 ≥3 点)。
      const pts = pointsDraft.draft?.points;
      if (isPointsClosedTool && pts && pts.length >= 3) {
        const [fx, fy] = pts[0];
        if (Math.hypot(pt.x - fx, pt.y - fy) <= CLOSE_DISTANCE) {
          commitPointsDraft();
          return;
        }
      }
      pointsDraft.addPoint(pt, isPointsClosedTool);
      return;
    }
    interaction.onStagePointerDown(e);
  }, [commitPointsDraft, interaction, isPlaybackActive, isPointsClosedTool, lockedTrackIds, maskEditor, pointFromClientEvt, pointsDrawEnabled, pointsDraft, readOnly, selectedManagedTrack, size.h, size.w, videoTool]);

  useEffect(() => {
    if (videoTool !== "mask" || !maskEditor) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const command = event.ctrlKey || event.metaKey;
      const selectedTrackId = selectedManagedTrack?.geometry.track_id;
      const phase = maskEditor.phase ?? (maskEditor.dirty ? "dirty" : maskEditor.active ? "ready" : "idle");
      const editable = canEditMask({
        taskReadOnly: !!readOnly || isPlaybackActive,
        annotationLocked: !!selectedManagedTrack?.is_locked,
        trackLocked: !!selectedTrackId && lockedTrackIds.has(selectedTrackId),
        segmentLocked: false,
        editorPhase: phase,
      });
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!editable) return;
        if (event.shiftKey) maskEditor.redo();
        else maskEditor.undo();
        return;
      }
      if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!editable) return;
        maskEditor.redo();
        return;
      }
      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!editable) return;
        maskEditor.setMode("brush");
      } else if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!editable) return;
        maskEditor.setMode("erase");
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!editable || !canCommitMask(phase, maskEditor.dirty)) return;
        onMaskCommit?.();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMaskCancel?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isPlaybackActive, lockedTrackIds, maskEditor, onMaskCancel, onMaskCommit, readOnly, selectedManagedTrack, videoTool]);

  // Enter/双击 闭合提交; Esc 取消。切工具/只读 时丢弃草稿。
  useEffect(() => {
    if (!pointsDrawEnabled && pointsDraft.draft) pointsDraft.cancel();
  }, [pointsDrawEnabled, pointsDraft]);
  // 切帧时丢弃未提交的顶点草稿: 顶点是起草帧的像素坐标, 若带到新帧提交会错位落在新帧上。
  // ref 守卫「帧真的变了」才取消 (pointsDraft 身份每渲染变, 不守卫会误伤同帧正常绘制)。
  const draftFrameRef = useRef(frameIndex);
  useEffect(() => {
    if (draftFrameRef.current === frameIndex) return;
    draftFrameRef.current = frameIndex;
    if (pointsDraft.draft) pointsDraft.cancel();
  }, [frameIndex, pointsDraft]);
  useEffect(() => {
    if (!pointsDrawEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); commitPointsDraft(); }
      else if (e.key === "Escape") { e.preventDefault(); pointsDraft.cancel(); }
      else if (e.key === "Backspace") { e.preventDefault(); pointsDraft.removeLastPoint(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pointsDrawEnabled, commitPointsDraft, pointsDraft]);

  // 可编辑选中框 → 画 8 向句柄(拖拽中跟随 live geom);live 预览框(画框/移动/缩放)。
  const interactionEditable = !readOnly && !isPlaybackActive;
  const handleBox = useMemo<VideoHandleBox | null>(() => {
    if (!interactionEditable || !selectedId) return null;
    const liveGeom = drag && (drag.kind === "move" || drag.kind === "resize") && drag.id === selectedId
      ? drag.current
      : null;
    const entry = frameViews.entries.find((e) => e.id === selectedId);
    if (entry) {
      // 点集几何 (polygon/polyline/OBB) 不画 8 向 resize 句柄; 顶点句柄单独渲染。
      if (entry.points) return null;
      const ann = annotations.find((a) => a.id === entry.id);
      const trackId = ann && isVideoTrack(ann) ? ann.geometry.track_id : null;
      if (trackId && lockedTrackIds.has(trackId)) return null;
      return { id: entry.id, geom: liveGeom ?? entry.geom, color: entry.color };
    }
    const ghost = frameViews.ghost;
    if (ghost && ghost.id === selectedId) {
      // 点集几何 ghost (polygon/polyline) 不画 8 向 resize 句柄 (与 entry.points 分支一致)。
      if (ghost.points) return null;
      if (selectedTrack && lockedTrackIds.has(selectedTrack.geometry.track_id)) return null;
      return { id: ghost.id, geom: liveGeom ?? ghost.geom, color: ghost.color };
    }
    return null;
  }, [annotations, drag, frameViews.entries, frameViews.ghost, interactionEditable, lockedTrackIds, selectedId, selectedTrack]);

  const preview = useMemo<VideoPreviewBox | null>(() => {
    if (!drag) return null;
    // v0.21.23 · smart-box / exemplar 的提示框预览 (紫色, 与图片侧 SAM 候选同色); point 无框可画。
    // v0.21.26 · exemplar 的 mode==="exemplar" 也画框 (此前只画 "bbox", 导致 exemplar 拖框全程无预览、体感像坏了)。
    if (drag.kind === "samProbe") {
      return drag.mode === "bbox" || drag.mode === "exemplar"
        ? { geom: normalizeGeom(drag.start, drag.current), color: SAM_PROBE_STROKE }
        : null;
    }
    if (drag.kind === "draw") {
      const drawColor = videoTool === "track" && selectedTrack
        ? getTrackColor(selectedTrack.geometry.track_id, selectedTrack.class_name, trackColorOverrides)
        : classColor(activeClass);
      return { geom: normalizeGeom(drag.start, drag.current), color: drawColor };
    }
    if (drag.kind === "move" || drag.kind === "resize") {
      const c = frameViews.entries.find((e) => e.id === drag.id)?.color
        ?? (frameViews.ghost?.id === drag.id ? frameViews.ghost.color : null)
        ?? classColor(activeClass);
      return { geom: drag.current, color: c };
    }
    return null;
  }, [activeClass, drag, frameViews.entries, frameViews.ghost, selectedTrack, trackColorOverrides, videoTool]);

  // v0.16.4 · 右键上下文菜单
  const selectedAnnotation = useMemo(
    () => annotations.find((ann) => ann.id === selectedId) ?? null,
    [annotations, selectedId],
  );
  const contextMenuAnnotation = useMemo(
    () => annotations.find((ann) => ann.id === contextMenuTargetId) ?? null,
    [annotations, contextMenuTargetId],
  );
  const selectedVideoBboxes = useMemo(
    () => annotations.filter((ann) => isVideoBbox(ann) && selectedIds.includes(ann.id)),
    [annotations, selectedIds],
  );
  const trackActions = useVideoTrackActions({
    selectedTrack: selectedManagedTrack,
    frameIndex,
    readOnly,
    hiddenTrackIds: hiddenTrackIds ?? EMPTY_LOCKED,
    lockedTrackIds,
    onUpdate: onUpdate ?? noopUpdate,
    onToggleHiddenTrack,
    onToggleLockedTrack,
    onPropagateTrack,
  });
  const selectedTrackCurrentKeyframe = useMemo(
    () => selectedTrack?.geometry.keyframes.find((kf) => kf.frame_index === frameIndex) ?? null,
    [frameIndex, selectedTrack],
  );
  const selectedManagedCurrentKeyframe = useMemo(
    () => selectedManagedTrack?.geometry.keyframes.find((keyframe) => keyframe.frame_index === frameIndex) ?? null,
    [frameIndex, selectedManagedTrack],
  );

  // v0.21.12 · 粘轨迹态提示数据: 轨迹显示编号 + 当前帧是否已有关键帧(切「延展 / 同帧新建」措辞)。
  // 仅轨迹工具 + 有选中轨迹时非空 → 显式化「下一次画框归属选中轨迹」这一隐式模型。
  const stickyTrackHint = useMemo(() => {
    if (videoTool !== "track" || !selectedTrack) return null;
    const num = deriveTrackNumber(videoTracks).get(selectedTrack.id);
    const label = num != null
      ? `#${num} ${selectedTrack.class_name}`
      : `${shortTrackId(selectedTrack.geometry.track_id)} ${selectedTrack.class_name}`;
    return { label, hasKeyframeAtFrame: selectedTrackCurrentKeyframe != null };
  }, [videoTool, selectedTrack, videoTracks, selectedTrackCurrentKeyframe]);
  const canDeleteSelectedTrackKeyframe = Boolean(
    selectedManagedTrack
    && selectedManagedCurrentKeyframe
    && !readOnly
    && !trackActions.selectedTrackLocked
    && selectedManagedTrack.geometry.keyframes.length > 1,
  );
  const deleteSelectedTrackKeyframe = useCallback(() => {
    if (!selectedManagedTrack || !selectedManagedCurrentKeyframe || !canDeleteSelectedTrackKeyframe) return false;
    if (selectedManagedTrack.geometry.type === "video_track_mask") {
      (onUpdate ?? noopUpdate)(selectedManagedTrack, {
        ...selectedManagedTrack.geometry,
        keyframes: selectedManagedTrack.geometry.keyframes.filter((keyframe) => keyframe.frame_index !== frameIndex),
      });
    } else {
      (onUpdate ?? noopUpdate)(selectedManagedTrack, {
        ...selectedManagedTrack.geometry,
        keyframes: sortedKeyframes(selectedManagedTrack.geometry).filter((keyframe) => keyframe.frame_index !== frameIndex),
      });
    }
    return true;
  }, [canDeleteSelectedTrackKeyframe, frameIndex, noopUpdate, onUpdate, selectedManagedCurrentKeyframe, selectedManagedTrack]);

  const contextMenuItems = useMemo<DropdownItem[]>(() => buildVideoContextMenuItems({
    contextMenuAnnotation,
    selectedAnnotation,
    contextMenuTargetId,
    selectedVideoBboxes,
    readOnly,
    frameIndex,
    trackActions,
    canDeleteSelectedTrackKeyframe,
    deleteSelectedTrackKeyframe,
    onChangeUserBoxClass,
    onComposeTracks,
    onConvertToBboxes,
    onDelete,
    onPropagateTrack,
    onToggleHiddenTrack,
    onToggleLockedTrack,
    hiddenTrackIds,
    lockedTrackIds,
  }), [
    canDeleteSelectedTrackKeyframe, contextMenuAnnotation, contextMenuTargetId, deleteSelectedTrackKeyframe,
    frameIndex, onChangeUserBoxClass, onComposeTracks, onConvertToBboxes, onDelete, onPropagateTrack,
    onToggleHiddenTrack, onToggleLockedTrack, readOnly, selectedAnnotation, selectedVideoBboxes, trackActions,
    hiddenTrackIds, lockedTrackIds,
  ]);

  const handleContextMenu = useCallback((evt: ReactMouseEvent<HTMLDivElement>) => {
    evt.preventDefault();
    const down = rightDownRef.current;
    rightDownRef.current = null;
    closeContextMenu();
    if (down && Math.hypot(evt.clientX - down.x, evt.clientY - down.y) >= CONTEXT_MENU_DRAG_THRESHOLD_PX) return;
    if (readOnly) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = clientToVideoNorm(evt.clientX, evt.clientY, rect, vpRef.current, size);
    if (!point) return;
    const pickables = frameViews.ghost ? [...frameViews.entries, frameViews.ghost] : frameViews.entries;
    const hit = pickTopVideoMaskAt(committedMaskRecords, point) ?? pickTopVideoEntryAt(pickables, point);
    if (!hit) return;
    const hitAnn = annotations.find((a) => a.id === hit.id);
    // v0.21.26 · 命中的不是「可建菜单」的视频几何 → 只选中, 不弹空菜单
    // (此前对 polygon/polyline 无条件 openAt 却给空 [], 表现为「弹一个没条目的菜单」)。
    if (!hitAnn || (!isAnyVideoSingleFrame(hitAnn) && !isAnyVideoTrack(hitAnn))) {
      if (hitAnn) onSelect?.(hit.id);
      return;
    }
    setContextMenuTargetId(hit.id);
    if (isVideoBbox(hitAnn) && selectedIds.includes(hit.id) && selectedVideoBboxes.length > 1) {
      contextMenu.openAt(evt.clientX, evt.clientY);
      return;
    }
    onSelect?.(hit.id);
    contextMenu.openAt(evt.clientX, evt.clientY);
  }, [annotations, closeContextMenu, committedMaskRecords, contextMenu, frameViews.entries, frameViews.ghost, onSelect, readOnly, selectedIds, selectedVideoBboxes.length, size, vpRef]);

  const fitViewport = useCallback(() => {
    fit(viewportSize.w, viewportSize.h, size.w, size.h);
  }, [fit, size.h, size.w, viewportSize.h, viewportSize.w]);

  // 实际尺寸(100% 缩放并居中,对齐旧 SVG 栈 setActualSize)。
  const setActualSize = useCallback(() => {
    if (!viewportSize.w || !viewportSize.h) {
      setVp({ scale: 1, tx: 0, ty: 0 });
      return;
    }
    setVp({
      scale: 1,
      tx: (viewportSize.w - size.w) / 2,
      ty: (viewportSize.h - size.h) / 2,
    });
  }, [setVp, size.h, size.w, viewportSize.h, viewportSize.w]);

  // 首次加载任务必定 fit 一次;之后仅在 autoFitOnResize 开启时跟随尺寸变化(对齐旧栈)。
  const fittedTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const taskId = manifest?.task_id ?? null;
    if (!taskId || !viewportSize.w || !viewportSize.h || !size.w || !size.h) return;
    const firstFit = fittedTaskIdRef.current !== taskId;
    if (!firstFit && !autoFitOnResize) return;
    fittedTaskIdRef.current = taskId;
    fitViewport();
  }, [autoFitOnResize, fitViewport, manifest?.task_id, size.h, size.w, viewportSize.h, viewportSize.w]);

  // ctrl/⌘+滚轮围绕光标缩放(几何边界判断,对齐旧栈 onWheel)。
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (videoTool === "mask" && maskEditor && e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        maskEditor.setRadius(maskEditor.radius + (e.deltaY < 0 ? 2 : -2));
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = containerRef.current;
      if (!el) return;
      // 播放组件(时间轴/控制条/概览导航条)叠在 stage 容器内, 它自有 Ctrl/⌘+滚轮横向缩放;
      // 指针落在整个播放组件上时别让画布抢事件一起缩放(两处 wheel 监听同触发条件的冲突根因)。
      if (e.target instanceof Element && e.target.closest('[data-testid="video-playback-overlay"]')) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, vpRef.current.scale * factor);
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [maskEditor, videoTool, vpRef, zoomAt]);

  // 本地视口/导航快捷键(对齐旧 SVG 栈 VideoStage 本地 keydown):
  // F = fit、0 = 实际尺寸;Home/End = 选中轨迹首/末出现帧(,/. 跳关键帧由中央 hotkeys 分发器处理)。
  useEffect(() => {
    const isInputFocused = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused(e.target)) return;
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        fitViewport();
        return;
      }
      if (e.key === "0" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setActualSize();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const track = selectedManagedTrack;
      if (!track) return;
      const frames = track.geometry.keyframes.map((keyframe) => keyframe.frame_index);
      if (e.key === "Home") {
        const frame = frames.length > 0 ? Math.min(...frames) : null;
        if (frame == null) return;
        e.preventDefault();
        seekToFrame(frame, { recordHistory: true });
        return;
      }
      if (e.key === "End") {
        const frame = frames.length > 0 ? Math.max(...frames) : null;
        if (frame == null) return;
        e.preventDefault();
        seekToFrame(frame, { recordHistory: true });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fitViewport, seekToFrame, selectedManagedTrack, setActualSize]);

  const seekManagedKeyframe = useCallback((dir: -1 | 1, options?: { recordHistory?: boolean }) => {
    if (selectedManagedTrack?.geometry.type !== "video_track_mask") {
      controls.seekToKeyframe(dir, options);
      return;
    }
    const frames = selectedManagedTrack.geometry.keyframes
      .map((keyframe) => keyframe.frame_index)
      .sort((a, b) => a - b);
    const next = dir > 0
      ? frames.find((candidate) => candidate > frameIndex)
      : [...frames].reverse().find((candidate) => candidate < frameIndex);
    if (next != null) seekToFrame(next, options);
  }, [controls, frameIndex, seekToFrame, selectedManagedTrack]);

  // useImperativeHandle 委托给 controller.controls,再覆盖 deleteSelectedTrackKeyframe。
  // (captureCurrentFrameJpeg 由 controller.controls 提供, 见 useVideoPlaybackController。)
  // v0.21.23 · 归一化 → 屏幕坐标; 类选择器 popover 的 fixed anchor 用它 (与 onPendingDraw 同式)。
  const normToClient = useCallback((pt: { x: number; y: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const p = videoNormToClient(pt, rect, vpRef.current, size);
    return { left: p.x, top: p.y };
  }, [size, vpRef]);

  useImperativeHandle(ref, () => ({
    ...controls,
    seekToKeyframe: seekManagedKeyframe,
    toggleSelectedTrackOutside: trackActions.toggleSelectedTrackOutside,
    toggleSelectedTrackOccluded: trackActions.toggleSelectedTrackOccluded,
    toggleSelectedTrackHidden: trackActions.toggleSelectedTrackHidden,
    toggleSelectedTrackLocked: trackActions.toggleSelectedTrackLocked,
    propagateSelectedTrack: trackActions.propagateSelectedTrack,
    normToClient,
    deleteSelectedTrackKeyframe,
    cycleInCategory,
    stepCategory,
    focusObject,
  }), [controls, cycleInCategory, deleteSelectedTrackKeyframe, focusObject, normToClient, seekManagedKeyframe, stepCategory, trackActions]);

  const beginPan = useCallback((evt: ReactPointerEvent<HTMLDivElement>) => {
    const isSpacePan = evt.button === 0 && spacePan;
    const isPan = evt.button === 2 || isSpacePan;
    if (evt.button === 2) rightDownRef.current = { x: evt.clientX, y: evt.clientY };
    if (!isPan) return;
    evt.preventDefault();
    if (isSpacePan) onSpacePanDragStart?.();
    panRef.current = { x: evt.clientX, y: evt.clientY };
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    pausePlayback();
    setPanning(true);
  }, [onSpacePanDragStart, pausePlayback, spacePan]);

  const onPointerMove = useCallback((evt: ReactPointerEvent<HTMLDivElement>) => {
    // 指针在画布上移动即唤出播放浮层(对齐旧 SVG 栈);离开后由 onPointerLeave 计时收起。
    showPlaybackOverlay();
    // 光标归一化坐标上报(状态栏读出),无论是否在平移;越界(letterbox 区)上报 null。
    if (onCursorMove || pointsDrawEnabled || videoTool === "mask") {
      const rect = containerRef.current?.getBoundingClientRect();
      const pt = rect ? clientToVideoNorm(evt.clientX, evt.clientY, rect, vpRef.current, size) : null;
      const inFrame = pt && pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1 ? pt : null;
      onCursorMove?.(inFrame);
      // 橡皮筋预览: 仅绘制工具激活时跟踪, 用于「上一点 → 光标」预览段与首点吸附高亮。
      if (pointsDrawEnabled) setPointsCursor(inFrame);
      if (videoTool === "mask") setMaskCursor(inFrame);
    }
    const maskStroke = maskStrokeRef.current;
    const selectedTrackId = selectedManagedTrack?.geometry.track_id;
    const maskEditable = !!maskEditor && canEditMask({
      taskReadOnly: !!readOnly || isPlaybackActive,
      annotationLocked: !!selectedManagedTrack?.is_locked,
      trackLocked: !!selectedTrackId && lockedTrackIds.has(selectedTrackId),
      segmentLocked: false,
      editorPhase: maskEditor.phase ?? (maskEditor.dirty ? "dirty" : maskEditor.active ? "ready" : "idle"),
    });
    if (maskStroke && maskEditor && maskEditable) {
      const point = pointFromClientEvt(evt.clientX, evt.clientY);
      if (point) {
        const x = point.x * size.w;
        const y = point.y * size.h;
        const dx = x - maskStroke.lastX;
        const dy = y - maskStroke.lastY;
        const distance = Math.hypot(dx, dy);
        const count = Math.max(1, Math.floor(distance / Math.max(1, maskEditor.radius / 2)));
        for (let index = 1; index <= count; index += 1) {
          const ratio = index / count;
          maskEditor.paintAt(maskStroke.lastX + dx * ratio, maskStroke.lastY + dy * ratio);
        }
        maskStrokeRef.current = { lastX: x, lastY: y };
      }
    }
    const start = panRef.current;
    if (!start) return;
    const dx = evt.clientX - start.x;
    const dy = evt.clientY - start.y;
    panRef.current = { x: evt.clientX, y: evt.clientY };
    setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy }));
  }, [isPlaybackActive, lockedTrackIds, maskEditor, onCursorMove, pointFromClientEvt, pointsDrawEnabled, readOnly, selectedManagedTrack, setVp, showPlaybackOverlay, size, videoTool, vpRef]);

  const endPan = useCallback(() => {
    if (maskStrokeRef.current) {
      maskStrokeRef.current = null;
      maskEditor?.endStroke();
    }
    panRef.current = null;
    setPanning(false);
  }, [maskEditor]);

  const onPointerLeave = useCallback(() => {
    onCursorMove?.(null);
    setPointsCursor(null);
    setMaskCursor(null);
    // 指针离开画布 2s 后收起播放浮层,避免其永久遮挡画布。
    schedulePlaybackOverlayHide();
  }, [onCursorMove, schedulePlaybackOverlayHide]);

  // 工具模式光标反馈:平移中 grabbing;按住 Space 可抓;创建工具十字,选择工具普通光标。
  // Konva 容器命中 resize 句柄时由交互层覆盖 stage.container() cursor,未命中则继承此处。
  const creationEnabled = (videoTool === "box" || videoTool === "track") && (!isVideoToolEnabled || isVideoToolEnabled(videoTool));
  // v0.21.23 · 交互式 SAM 工具同样用十字光标 (提示落点即分割位置)。
  // v0.21.26 · 复用交互层同一谓词 isSamProbeTool (含 exemplar / magic-box), 修此前漏登记这两个
  // 工具 → 选中后无十字光标、体感像未进入工具的问题。
  const samProbeTool = isSamProbeTool(videoTool);
  const cursorClass = panning
    ? styles.rootPanning
    : spacePan
      ? styles.toolGrab
      : creationEnabled || pointsDrawEnabled || samProbeTool
        ? styles.toolCrosshair
        : "";

  const videoMinimapVisible = viewportSize.w > 0 && viewportSize.h > 0;

  if (isLoading) {
    return (
      <div className={styles.loadingState}>
        <Icon name="loader2" className="spin" /> 加载视频信息...
      </div>
    );
  }
  if (error || !manifest) {
    return (
      <div className={styles.errorState}>
        <Icon name="warning" size={28} /> 视频 manifest 不可用
      </div>
    );
  }

  return (
    <div
      ref={setContainerNode}
      data-testid="video-konva-stage"
      className={`${styles.root} ${cursorClass}`}
      onContextMenu={handleContextMenu}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={onPointerLeave}
      onDoubleClick={isPointsDrawTool ? undefined : fitViewport}
    >
      <video
        ref={setVideoNode}
        data-testid="video-konva-source"
        src={manifest.video_url}
        poster={manifest.poster_url ?? undefined}
        // v0.21.4 · CORS-clean 加载, 否则 createImageBitmap(video) → canvas 会被跨域 MinIO 视频
        // 污染, 单题 AI 抓帧导出 JPEG 抛 SecurityError。storage 已对 presigned GET 返回 ACAO。
        crossOrigin="anonymous"
        playsInline
        className={styles.hiddenVideo}
      />
      <div className={styles.konvaHost}>
        <Stage
          ref={stageRef}
          width={viewportSize.w || 1}
          height={viewportSize.h || 1}
          x={vp.tx}
          y={vp.ty}
          scaleX={vp.scale}
          scaleY={vp.scale}
          onPointerDown={handleStagePointerDown}
          onDblClick={isPointsDrawTool ? commitPointsDraft : undefined}
        >
          <VideoKonvaMediaLayer
            videoEl={videoEl}
            bitmap={activeBitmap?.bitmap ?? null}
            size={size}
            viewport={viewportSize}
            isPlaybackActive={isPlaybackActive}
          />
          <VideoKonvaTracksLayer
            entries={frameViews.entries}
            previews={frameViews.previews}
            ghost={frameViews.ghost}
            carryOverGhosts={frameViews.carryOverGhosts}
            size={size}
            scale={vp.scale}
            visual={visual}
          />
          <VideoKonvaMaskLayer records={displayedMaskRecords} size={size} />
          {videoTool === "mask" && maskEditor?.active && maskEditor.buffer && (
            <MaskOverlayLayer
              buffer={maskEditor.buffer}
              revision={maskEditor.revision}
              imgW={size.w}
              imgH={size.h}
              visible
            />
          )}
          <VideoKonvaOverlayLayer
            pendingDraft={pendingDraft}
            labels={frameViews.labels}
            size={size}
            scale={vp.scale}
            visual={visual}
          />
          {/* v0.21.4 · AI 候选层(当前帧 video_bbox); select 工具下可点选。 */}
          <VideoKonvaAiLayer
            boxes={frameAiBoxes}
            size={size}
            scale={vp.scale}
            selectedId={selectedId}
            listening={videoTool === "select" && !readOnly}
            visual={visual}
            onSelect={(id) => onSelect?.(id)}
          />
          {issuePixelFeedbacks && issuePixelFeedbacks.length > 0 && (
            <VideoKonvaIssueLayer
              pixelIssues={issuePixelFeedbacks.filter(
                (f) => f.kind === "issue" && f.anchor_type === "pixel" && !!f.anchor_position,
              )}
              frameIndex={frameIndex}
              size={size}
              scale={vp.scale}
              highlightId={issueHighlightId}
              onPinClick={onIssuePinClick}
            />
          )}
          <VideoKonvaInteractionLayer
            size={size}
            scale={vp.scale}
            drag={drag}
            handleBox={handleBox}
            preview={preview}
            onResizeHandlePointerDown={interaction.onResizeHandlePointerDown}
          />
          {videoTool === "mask" && maskCursor && maskEditor && (
            <Layer name="video-mask-cursor" listening={false}>
              <Circle
                x={maskCursor.x * size.w}
                y={maskCursor.y * size.h}
                radius={maskEditor.radius}
                stroke={maskEditor.mode === "erase" ? "#64748b" : "#dc2626"}
                strokeWidth={1.5 / vp.scale}
                dash={[4 / vp.scale, 3 / vp.scale]}
                listening={false}
              />
            </Layer>
          )}
          {pointsDraft.draft && pointsDraft.draft.points.length > 0 && (() => {
            const hex = colorToHex(classColor(activeClass));
            const isPolyline = !pointsDraft.draft.closed;
            const ps = pointsDraft.draft.points;
            const flat = ps.flatMap(([px, py]) => [px * size.w, py * size.h]);
            // 橡皮筋: 追加「最后一点 → 当前光标」预览段。
            if (pointsCursor) flat.push(pointsCursor.x * size.w, pointsCursor.y * size.h);
            // 首点吸附高亮(仅 polygon, ≥3 点且光标进入闭合半径)。
            const canClose = !isPolyline && ps.length >= 3 && !!pointsCursor
              && Math.hypot(pointsCursor.x - ps[0][0], pointsCursor.y - ps[0][1]) <= CLOSE_DISTANCE;
            return (
              <Layer name="points-draft" listening={false}>
                <Line
                  points={flat}
                  closed={false}
                  stroke={hex}
                  strokeWidth={1.5 / vp.scale}
                  dash={[6 / vp.scale, 4 / vp.scale]}
                  lineCap="round"
                  lineJoin="round"
                  fill={isPolyline ? undefined : hexToRgba(hex, 0.1)}
                  listening={false}
                />
                {ps.map(([px, py], i) => (
                  <Circle
                    key={i}
                    x={px * size.w}
                    y={py * size.h}
                    radius={(i === 0 ? 4.5 : 3) / vp.scale}
                    fill={i === 0 && canClose ? hex : "white"}
                    stroke={hex}
                    strokeWidth={1.5 / vp.scale}
                    listening={false}
                  />
                ))}
              </Layer>
            );
          })()}
          {/* polygon/polyline (单帧 + 轨迹) 选中 → 顶点句柄 (拖顶点改形); 命中框内拖拽整体平移由 Stage pickTop 处理。
              轨迹在插值帧编辑会物化关键帧; OBB 暂只读 (entry.points 存在但非可编辑点集几何)。 */}
          {!readOnly && !isPlaybackActive && selectedId && (() => {
            const entry = frameViews.entries.find((e) => e.id === selectedId);
            if (!entry?.points) return null;
            const ann = annotations.find((a) => a.id === selectedId);
            const editablePoly = ann && (isVideoPolygon(ann) || isVideoPolyline(ann)
              || isVideoPolygonTrack(ann) || isVideoPolylineTrack(ann));
            if (!ann || !editablePoly) return null; // OBB 暂只读
            const editing = drag && (drag.kind === "polyVertex" || drag.kind === "polyMove") && drag.id === selectedId;
            const livePoints = editing ? drag.current : entry.points;
            const hex = colorToHex(entry.color);
            const open = isVideoPolyline(ann) || isVideoPolylineTrack(ann);
            const flat = livePoints.flatMap(([px, py]) => [px * size.w, py * size.h]);
            return (
              <Layer name="poly-edit">
                {editing && (
                  <Line
                    points={flat}
                    closed={!open}
                    stroke={hex}
                    strokeWidth={1.5 / vp.scale}
                    dash={[6 / vp.scale, 4 / vp.scale]}
                    lineCap="round"
                    lineJoin="round"
                    fill={open ? undefined : hexToRgba(hex, 0.1)}
                    listening={false}
                  />
                )}
                {livePoints.map(([px, py], i) => (
                  <Circle
                    key={i}
                    x={px * size.w}
                    y={py * size.h}
                    radius={5 / vp.scale}
                    hitStrokeWidth={10 / vp.scale}
                    fill="white"
                    stroke={hex}
                    strokeWidth={1.5 / vp.scale}
                    onPointerDown={(e) => interaction.onVertexPointerDown(selectedId, i, livePoints, e)}
                  />
                ))}
              </Layer>
            );
          })()}
          {/* v0.21.23 · 交互式 SAM 候选 + 点会话（瞬态，不落库；置顶且不吃事件）。 */}
          {(samCandidates.length > 0 ||
            samSessionPoints.length > 0 ||
            samSessionBoxes.length > 0) && (
            <Layer name="sam-candidates" listening={false}>
              <VideoSamCandidateOverlay
                candidates={samCandidates}
                activeIdx={samActiveIdx}
                previewAsBbox={videoTool === "magic-box"}
                sessionPoints={samSessionPoints}
                sessionBoxes={samSessionBoxes}
                width={size.w}
                height={size.h}
                scale={vp.scale}
              />
            </Layer>
          )}
        </Stage>
        {/* 跟踪当前帧屏幕矩形的不可见标记:改类/批量改类弹窗经 [data-video-overlay] 锚到画布上的框
            (Konva 栈无旧 SVG overlay,此 div 复刻其矩形,随 vp 平移/缩放同步)。 */}
        <div
          data-video-overlay
          className={styles.frameMarker}
          // eslint-disable-next-line no-restricted-syntax -- 帧矩形随 vp 动态变化,经 CSS 变量注入。
          style={{
            "--frame-left": `${vp.tx}px`,
            "--frame-top": `${vp.ty}px`,
            "--frame-w": `${size.w * vp.scale}px`,
            "--frame-h": `${size.h * vp.scale}px`,
          } as CSSProperties}
        />
        {/* v0.21.4 · AI 候选贴框快捷条(采纳 / 忽略), 复用图片工作台 SelectionOverlay。 */}
        {selectedAiBox && !readOnly && videoTool === "select" && (
          <SelectionOverlay
            box={selectedAiBox}
            isAi
            imgW={size.w}
            imgH={size.h}
            vp={vp}
            onAccept={() => onAcceptPrediction?.(selectedAiBox)}
            onReject={() => {
              onRejectPrediction?.(selectedAiBox);
              onSelect?.(null);
            }}
          />
        )}
      </div>
      {playbackError && (
        <div data-testid="video-konva-playback-error" className={styles.playbackError}>
          视频无法播放:{playbackError}
        </div>
      )}
      <VideoQcWarnings warnings={qualityWarnings} />
      {stickyTrackHint && (
        <VideoStickyTrackHint
          label={stickyTrackHint.label}
          hasKeyframeAtFrame={stickyTrackHint.hasKeyframeAtFrame}
        />
      )}
      <VideoPlaybackOverlay
        frameIndex={frameIndex}
        maxFrame={maxFrame}
        samplingStep={samplingStep}
        largeFrameStep={largeFrameStep}
        timebase={timebase}
        isPlaying={isPlaybackActive}
        playbackRateLabel={isJogPlaying ? `${jogPlayback.direction < 0 ? "-" : ""}${jogPlayback.rate}x` : undefined}
        selectedTrackTimeline={effectiveSelectedTrackTimeline}
        trackColor={effectiveSelectedTrackColor}
        globalTimelineDensity={globalTimelineDensity}
        predictionDensity={predictionDensity}
        onSeekPredicted={hasPredictedFrames ? seekToAdjacentPredictedFrame : undefined}
        trackColorOverrides={trackColorOverrides}
        loopRegion={loopRegion}
        propagateRange={propagateRange}
        rangeSelectPurpose={timelineChapterControls?.rangeSelectPurpose ?? "loop"}
        bookmarks={bookmarks}
        chapters={chapters}
        issueFrames={issueFrames}
        hoverPreview={framePreview}
        currentFrameEntryCount={frameViews.entries.length}
        visible={playbackOverlayVisible && !drag}
        interactive
        highlightAction={highlightAction}
        onSeek={(frame) => {
          showPlaybackOverlay();
          pausePlayback();
          seekToFrame(frame, { recordHistory: true });
        }}
        onSeekByFrames={seekOverlayByFrames}
        onTogglePlay={controls.togglePlayback}
        onLoopRegionChange={setNormalizedLoopRegion}
        onClearLoopRegion={clearLoopRegion}
        onSeekBookmark={(targetFrame) => seekToFrame(targetFrame, { recordHistory: true })}
        onSeekChapter={(_, frame) => seekToFrame(frame, { recordHistory: true })}
        onRangeSelect={timelineChapterControls?.onRangeSelect}
        hoveredChapterId={timelineChapterControls?.hoveredChapterId ?? null}
        onHoverChapter={timelineChapterControls?.onHoverChapter}
        onChapterResize={timelineChapterControls?.onResizeChapter}
        onHoverFrameChange={previewFrame}
      />
      <ContextMenu
        open={contextMenu.open && contextMenuItems.length > 0}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />
      <FloatingDock
        scale={vp.scale}
        canUndo={false}
        canRedo={false}
        onUndo={noop}
        onRedo={noop}
        onZoomIn={() => setVp((cur) => ({ ...cur, scale: clampScale(cur.scale * 1.2) }))}
        onZoomOut={() => setVp((cur) => ({ ...cur, scale: clampScale(cur.scale / 1.2) }))}
        onFit={fitViewport}
        showHistory={false}
      />
      {videoMinimapVisible && (
        <Minimap
          imgW={size.w}
          imgH={size.h}
          vpSize={viewportSize}
          vp={vp}
          setVp={setVp}
          thumbnailUrl={manifest.poster_url ?? null}
          fileUrl={null}
          frameSource={pickMediaImageSource(isPlaybackActive, videoEl, activeBitmap?.bitmap ?? null) ?? null}
          frameVersion={frameIndex}
          isLive={isPlaybackActive}
          currentFrameIndex={frameIndex}
          maxFrame={maxFrame}
          cachedFrameRanges={cachedRanges}
          bottom={64}
        />
      )}
    </div>
  );
});
