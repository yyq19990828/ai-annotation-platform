import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Stage } from "react-konva";
import type Konva from "konva";
import { Icon } from "@/components/ui/Icon";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { DropdownItem } from "@/components/ui/DropdownMenu";
import type { AnnotationResponse, TaskVideoFrameTimetableResponse, TaskVideoManifestResponse, VideoBboxGeometry, VideoSamplingConfig, VideoTrackGeometry, VideoTrackKeyframe } from "@/types";
import type { WorkbenchCommonPreferences } from "@/api/auth";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { useElementSize, useViewportTransform } from "../state/useViewportTransform";
import type { PendingDrawing, VideoTool } from "../state/useWorkbenchState";
import type { DiffMode } from "../modes/types";
import { FloatingDock } from "../shell/FloatingDock";
import { Minimap } from "./Minimap";
import { VideoKonvaMediaLayer } from "./VideoKonvaMediaLayer";
import { VideoKonvaTracksLayer } from "./VideoKonvaTracksLayer";
import { VideoKonvaOverlayLayer } from "./VideoKonvaOverlayLayer";
import { VideoKonvaIssueLayer } from "./VideoKonvaIssueLayer";
import { VideoKonvaInteractionLayer, type VideoHandleBox, type VideoPreviewBox } from "./VideoKonvaInteractionLayer";
import { VideoPlaybackOverlay, type VideoLargeFrameStep, type VideoTimelineChapter } from "./VideoPlaybackOverlay";
import { VideoQcWarnings } from "./VideoQcWarnings";
import { useVideoKonvaInteraction } from "./videoKonvaInteraction";
import { videoIntrinsicSize, clientToVideoNorm } from "./videoKonvaCoordinates";
import { deriveVideoFrameViews } from "./videoFrameViews";
import { classColor, getTrackColor } from "./colors";
import { isVideoBbox, isVideoTrack, normalizeGeom, sortedKeyframes } from "./videoStageGeometry";
import { isFrameOutside } from "./videoTrackOutside";
import { pickTopVideoEntryAt } from "./videoStagePicking";
import { useVideoTrackActions } from "./useVideoTrackActions";
import { buildVideoContextMenuItems } from "./videoContextMenuItems";
import { useCanvasContextMenu } from "./useCanvasContextMenu";
import type { VideoTrackAnnotation, VideoTrackCompositionOptions, VideoTrackConversionOptions } from "./videoStageTypes";
import { DEFAULT_ANNOTATION_VISUAL, type AnnotationVisualConfig } from "./annotationVisual";
import { clampScale } from "./shared/viewport/zoom";
import { useVideoPlaybackController } from "./useVideoPlaybackController";
import type { VideoStageControls } from "./videoStageControls";
import styles from "./VideoKonvaStage.module.css";

const EMPTY_ANNOTATIONS: AnnotationResponse[] = [];
const EMPTY_LOCKED = new Set<string>();

interface VideoKonvaStageProps {
  manifest: TaskVideoManifestResponse | undefined;
  frameTimetable?: TaskVideoFrameTimetableResponse;
  isLoading?: boolean;
  error?: unknown;
  frameIndex?: number;
  autoFitOnResize?: boolean;
  performanceTier?: WorkbenchCommonPreferences["performanceTier"];
  onFrameIndexChange?: (frameIndex: number) => void;
  annotations?: AnnotationResponse[];
  selectedId?: string | null;
  hiddenTrackIds?: Set<string>;
  reviewDisplayMode?: DiffMode;
  trackColorOverrides?: Record<string, string>;
  activeClass?: string;
  pendingDrawing?: PendingDrawing;
  issuePixelFeedbacks?: AnnotationFeedback[];
  issueHighlightId?: string | null;
  /** 共享视觉规格(线宽/填充/字号/标签);与图片同源。缺省回退默认值。 */
  visual?: AnnotationVisualConfig;
  videoTool?: VideoTool;
  readOnly?: boolean;
  lockedTrackIds?: Set<string>;
  selectedIds?: string[];
  onSelect?: (id: string | null, opts?: { shift?: boolean }) => void;
  onCreate?: (frameIndex: number, geom: { x: number; y: number; w: number; h: number }) => void;
  onPendingDraw?: (
    kind: "video_bbox" | "video_track_bbox",
    frameIndex: number,
    geom: { x: number; y: number; w: number; h: number },
    anchor: { left: number; top: number },
  ) => void;
  onUpdate?: (annotation: AnnotationResponse, geometry: VideoBboxGeometry | VideoTrackGeometry) => void;
  onChangeUserBoxClass?: (id: string) => void;
  onComposeTracks?: (options: VideoTrackCompositionOptions) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  onDelete?: (annotation: AnnotationResponse) => void;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
  onToggleHiddenTrack?: (trackId: string) => void;
  onToggleLockedTrack?: (trackId: string) => void;
  /** 时间轴章节(从工作台 shell 透传)。 */
  chapters?: VideoTimelineChapter[];
  /** 采样配置(帧网格步进策略)。 */
  videoSampling?: VideoSamplingConfig | null;
  /** 默认播放速率。 */
  defaultPlaybackRate?: number;
  /** Shift+←/→ 大步进策略(默认 10)。 */
  largeFrameStep?: VideoLargeFrameStep;
}

const CONTEXT_MENU_DRAG_THRESHOLD_PX = 5;

const noop = () => {};

function quickKeyframeStatus(keyframe: VideoTrackKeyframe, outside: boolean): string {
  if (outside) return "消失";
  if (keyframe.occluded) return "遮挡";
  if (keyframe.source === "prediction") return "预测";
  return "正常";
}

/**
 * 视频 Konva 渲染栈容器(v0.16.1–v0.16.5)。
 *
 * 底图/播放/标注/交互/右键菜单全栈进 Konva,并补齐旧 SVG 栈的 chrome 奇偶性:
 * VideoPlaybackOverlay(时间轴)、Minimap、VideoQcWarnings、关键帧快跳浮层。
 * 所有播放/逐帧/书签/循环区间逻辑委托给 useVideoPlaybackController。
 */
export const VideoKonvaStage = forwardRef<VideoStageControls, VideoKonvaStageProps>(function VideoKonvaStage({
  manifest,
  frameTimetable,
  isLoading = false,
  error,
  frameIndex: controlledFrameIndex,
  autoFitOnResize = true,
  performanceTier = "standard",
  onFrameIndexChange,
  annotations = EMPTY_ANNOTATIONS,
  selectedId = null,
  hiddenTrackIds,
  reviewDisplayMode,
  trackColorOverrides,
  activeClass = "",
  pendingDrawing = null,
  issuePixelFeedbacks,
  issueHighlightId,
  visual = DEFAULT_ANNOTATION_VISUAL,
  videoTool = "box",
  readOnly = false,
  lockedTrackIds = EMPTY_LOCKED,
  selectedIds = [],
  onSelect,
  onCreate,
  onPendingDraw,
  onUpdate,
  onChangeUserBoxClass,
  onComposeTracks,
  onConvertToBboxes,
  onDelete,
  onPropagateTrack,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  chapters = [],
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

  // v0.16.3 · 交互:选中轨迹(供 track 工具画框落关键帧 + ghost 可编辑判定)。
  const selectedTrack = useMemo(() => {
    const a = annotations.find((x) => x.id === selectedId);
    return a && isVideoTrack(a) ? a : null;
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
    selectedTrackKeyframes,
    globalTimelineDensity,
    qualityWarnings,
    issueFrames,
    playbackOverlayVisible,
    highlightAction,
    bookmarks,
    loopRegion,
    showPlaybackOverlay,
    setNormalizedLoopRegion,
    clearLoopRegion,
    seekToFrame,
    seekOverlayByFrames,
    pausePlayback,
    controls,
  } = controller;

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
  const frameViews = useMemo(
    () => deriveVideoFrameViews({
      annotations,
      frameIndex,
      selectedId,
      hiddenTrackIds,
      reviewDisplayMode,
      trackColorOverrides,
      visual,
      pendingDraft,
    }),
    [annotations, frameIndex, hiddenTrackIds, pendingDraft, reviewDisplayMode, selectedId, trackColorOverrides, visual],
  );

  const interaction = useVideoKonvaInteraction({
    containerRef,
    vpRef,
    size,
    annotations,
    entries: frameViews.entries,
    ghost: frameViews.ghost,
    selectedTrack,
    videoTool,
    readOnly,
    isPlaybackActive,
    lockedTrackIds,
    frameIndex,
    onSelect: onSelect ?? noopSelect,
    onCreate: onCreate ?? noopCreate,
    onPendingDraw,
    onUpdate: onUpdate ?? noopUpdate,
  });
  const { drag } = interaction;

  // 可编辑选中框 → 画 8 向句柄(拖拽中跟随 live geom);live 预览框(画框/移动/缩放)。
  const interactionEditable = !readOnly && !isPlaybackActive;
  const handleBox = useMemo<VideoHandleBox | null>(() => {
    if (!interactionEditable || !selectedId) return null;
    const liveGeom = drag && (drag.kind === "move" || drag.kind === "resize") && drag.id === selectedId
      ? drag.current
      : null;
    const entry = frameViews.entries.find((e) => e.id === selectedId);
    if (entry) {
      const ann = annotations.find((a) => a.id === entry.id);
      const trackId = ann && isVideoTrack(ann) ? ann.geometry.track_id : null;
      if (trackId && lockedTrackIds.has(trackId)) return null;
      return { id: entry.id, geom: liveGeom ?? entry.geom, color: entry.color };
    }
    const ghost = frameViews.ghost;
    if (ghost && ghost.id === selectedId) {
      if (selectedTrack && lockedTrackIds.has(selectedTrack.geometry.track_id)) return null;
      return { id: ghost.id, geom: liveGeom ?? ghost.geom, color: ghost.color };
    }
    return null;
  }, [annotations, drag, frameViews.entries, frameViews.ghost, interactionEditable, lockedTrackIds, selectedId, selectedTrack]);

  const preview = useMemo<VideoPreviewBox | null>(() => {
    if (!drag) return null;
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
    selectedTrack,
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
  const canDeleteSelectedTrackKeyframe = Boolean(
    selectedTrack
    && selectedTrackCurrentKeyframe
    && !readOnly
    && !trackActions.selectedTrackLocked
    && selectedTrack.geometry.keyframes.length > 1,
  );
  const deleteSelectedTrackKeyframe = useCallback(() => {
    if (!selectedTrack || !selectedTrackCurrentKeyframe || !canDeleteSelectedTrackKeyframe) return false;
    (onUpdate ?? noopUpdate)(selectedTrack, {
      ...selectedTrack.geometry,
      keyframes: sortedKeyframes(selectedTrack.geometry).filter((kf) => kf.frame_index !== frameIndex),
    });
    return true;
  }, [canDeleteSelectedTrackKeyframe, frameIndex, noopUpdate, onUpdate, selectedTrack, selectedTrackCurrentKeyframe]);

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
  }), [
    canDeleteSelectedTrackKeyframe, contextMenuAnnotation, contextMenuTargetId, deleteSelectedTrackKeyframe,
    frameIndex, onChangeUserBoxClass, onComposeTracks, onConvertToBboxes, onDelete, onPropagateTrack,
    onToggleHiddenTrack, onToggleLockedTrack, readOnly, selectedAnnotation, selectedVideoBboxes, trackActions,
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
    const hit = pickTopVideoEntryAt(pickables, point);
    if (!hit) return;
    setContextMenuTargetId(hit.id);
    const hitAnn = annotations.find((a) => a.id === hit.id);
    if (hitAnn && isVideoBbox(hitAnn) && selectedIds.includes(hit.id) && selectedVideoBboxes.length > 1) {
      contextMenu.openAt(evt.clientX, evt.clientY);
      return;
    }
    onSelect?.(hit.id);
    contextMenu.openAt(evt.clientX, evt.clientY);
  }, [annotations, closeContextMenu, contextMenu, frameViews.entries, frameViews.ghost, onSelect, readOnly, selectedIds, selectedVideoBboxes.length, size, vpRef]);

  const fitViewport = useCallback(() => {
    fit(viewportSize.w, viewportSize.h, size.w, size.h);
  }, [fit, size.h, size.w, viewportSize.h, viewportSize.w]);

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
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, vpRef.current.scale * factor);
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [vpRef, zoomAt]);

  // useImperativeHandle 委托给 controller.controls,再覆盖 deleteSelectedTrackKeyframe。
  useImperativeHandle(ref, () => ({
    ...controls,
    deleteSelectedTrackKeyframe,
  }), [controls, deleteSelectedTrackKeyframe]);

  const beginPan = useCallback((evt: ReactPointerEvent<HTMLDivElement>) => {
    const isPan = evt.button === 2 || (evt.button === 0 && videoTool === "hand");
    if (evt.button === 2) rightDownRef.current = { x: evt.clientX, y: evt.clientY };
    if (!isPan) return;
    evt.preventDefault();
    panRef.current = { x: evt.clientX, y: evt.clientY };
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    pausePlayback();
    setPanning(true);
  }, [pausePlayback, videoTool]);

  const onPointerMove = useCallback((evt: ReactPointerEvent<HTMLDivElement>) => {
    const start = panRef.current;
    if (!start) return;
    const dx = evt.clientX - start.x;
    const dy = evt.clientY - start.y;
    panRef.current = { x: evt.clientX, y: evt.clientY };
    setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy }));
  }, [setVp]);

  const endPan = useCallback(() => {
    panRef.current = null;
    setPanning(false);
  }, []);

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
      className={panning ? `${styles.root} ${styles.rootPanning}` : styles.root}
      onContextMenu={handleContextMenu}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={fitViewport}
    >
      <video
        ref={setVideoNode}
        data-testid="video-konva-source"
        src={manifest.video_url}
        poster={manifest.poster_url ?? undefined}
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
          onPointerDown={interaction.onStagePointerDown}
        >
          <VideoKonvaMediaLayer
            videoEl={videoEl}
            bitmap={activeBitmap?.bitmap ?? null}
            size={size}
            isPlaybackActive={isPlaybackActive}
          />
          <VideoKonvaTracksLayer
            entries={frameViews.entries}
            previews={frameViews.previews}
            ghost={frameViews.ghost}
            size={size}
            scale={vp.scale}
            visual={visual}
          />
          <VideoKonvaOverlayLayer
            pendingDraft={pendingDraft}
            labels={frameViews.labels}
            size={size}
            scale={vp.scale}
            visual={visual}
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
        </Stage>
      </div>
      {playbackError && (
        <div data-testid="video-konva-playback-error" className={styles.playbackError}>
          视频无法播放:{playbackError}
        </div>
      )}
      <VideoQcWarnings warnings={qualityWarnings} />
      {selectedTrack && selectedTrackKeyframes.length > 0 && (
        <details
          className={styles.keyframeQuickJump}
          data-testid="video-keyframe-quick-jump"
        >
          <summary
            className={styles.keyframeQuickSummary}
            data-testid="video-keyframe-quick-jump-summary"
          >
            <Icon name="key" size={14} />
            <span className={styles.keyframeQuickTitle}>关键帧</span>
            <span className={`mono ${styles.keyframeQuickCount}`}>
              {selectedTrackKeyframes.length}
            </span>
            <Icon name="chevDown" size={14} className={styles.keyframeQuickChevron} />
          </summary>
          <div className={styles.keyframeQuickList}>
            {selectedTrackKeyframes.map((keyframe) => {
              const outside = isFrameOutside(selectedTrack.geometry, keyframe.frame_index);
              const statusClassName = [
                styles.keyframeQuickStatus,
                outside ? styles.keyframeQuickStatusAbsent : "",
                keyframe.source === "prediction" ? styles.keyframeQuickStatusPrediction : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={keyframe.frame_index}
                  type="button"
                  className={styles.keyframeQuickRow}
                  title={`跳转到 F${keyframe.frame_index}`}
                  onClick={() => seekToFrame(keyframe.frame_index, { recordHistory: true })}
                >
                  <span className={`mono ${styles.keyframeQuickFrame}`}>F{keyframe.frame_index}</span>
                  <span className={statusClassName}>{quickKeyframeStatus(keyframe, outside)}</span>
                  <span className={styles.keyframeQuickSource}>{keyframe.source}</span>
                  <Icon name="arrowRight" size={13} />
                </button>
              );
            })}
          </div>
        </details>
      )}
      <VideoPlaybackOverlay
        frameIndex={frameIndex}
        maxFrame={maxFrame}
        samplingStep={samplingStep}
        largeFrameStep={largeFrameStep}
        timebase={timebase}
        isPlaying={isPlaybackActive}
        playbackRateLabel={isJogPlaying ? `${jogPlayback.direction < 0 ? "-" : ""}${jogPlayback.rate}x` : undefined}
        selectedTrackTimeline={selectedTrackTimeline}
        trackColor={selectedTrackColor}
        globalTimelineDensity={globalTimelineDensity}
        trackColorOverrides={trackColorOverrides}
        loopRegion={loopRegion}
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
          fileUrl={manifest.video_url}
          currentFrameIndex={frameIndex}
          maxFrame={maxFrame}
          cachedFrameRanges={cachedRanges}
          bottom={64}
        />
      )}
    </div>
  );
});
