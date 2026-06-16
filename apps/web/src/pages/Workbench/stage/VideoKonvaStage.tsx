import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Stage } from "react-konva";
import type Konva from "konva";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse, TaskVideoFrameTimetableResponse, TaskVideoManifestResponse } from "@/types";
import type { WorkbenchCommonPreferences } from "@/api/auth";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { useElementSize, useViewportTransform } from "../state/useViewportTransform";
import type { PendingDrawing } from "../state/useWorkbenchState";
import type { DiffMode } from "../modes/types";
import { FloatingDock } from "../shell/FloatingDock";
import { VideoKonvaMediaLayer } from "./VideoKonvaMediaLayer";
import { VideoKonvaTracksLayer } from "./VideoKonvaTracksLayer";
import { VideoKonvaOverlayLayer } from "./VideoKonvaOverlayLayer";
import { VideoKonvaIssueLayer } from "./VideoKonvaIssueLayer";
import { videoIntrinsicSize } from "./videoKonvaCoordinates";
import { deriveVideoFrameViews } from "./videoFrameViews";
import { DEFAULT_ANNOTATION_VISUAL, type AnnotationVisualConfig } from "./annotationVisual";
import { clampScale } from "./shared/viewport/zoom";
import { buildFrameTimebase } from "./frameTimebase";
import { useFrameClock } from "./useFrameClock";
import { useVideoBitmapCache } from "./useVideoBitmapCache";
import { resolveWorkbenchPerformanceTier } from "../state/performanceTier";
import type { VideoStageControls } from "./VideoStage";
import styles from "./VideoKonvaStage.module.css";

const EMPTY_ANNOTATIONS: AnnotationResponse[] = [];

interface VideoKonvaStageProps {
  manifest: TaskVideoManifestResponse | undefined;
  frameTimetable?: TaskVideoFrameTimetableResponse;
  isLoading?: boolean;
  error?: unknown;
  frameIndex?: number;
  autoFitOnResize?: boolean;
  performanceTier?: WorkbenchCommonPreferences["performanceTier"];
  onFrameIndexChange?: (frameIndex: number) => void;
  // v0.16.2 · 标注层数据(render-only):用 deriveVideoFrameViews 派生当前帧框/轨迹/标签/ghost。
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
}

const noop = () => {};

/**
 * v0.16.1 · 视频 Konva 渲染栈(实验,flag experiment.videoKonva 后)。
 *
 * 本版只迁「底图显示 + 视口」:视频帧进 Konva.Image(决策 A1,见 VideoKonvaMediaLayer),
 * pan/zoom 走 Konva Stage 原生 transform + v0.16.0 公共 viewport 原语,坐标改像素空间
 * (决策 B,videoKonvaCoordinates)。**标注/交互/轨迹尚未迁**(v0.16.2/.3),故仅供开发态
 * 与旧 SVG 栈做底图/播放/缩放的像素级视觉对照,不作生产默认。
 *
 * 播放/逐帧复用与旧栈同一套引擎(useFrameClock + useVideoBitmapCache),保证「暂停精确帧」
 * 与旧栈逐帧一致;经转发的 VideoStageControls 让工作台现有热键直接驱动本栈。轨迹类控制
 * (本版无轨迹)以 no-op 占位。
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

  const [uncontrolledFrameIndex, setUncontrolledFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  const frameIndex = controlledFrameIndex ?? uncontrolledFrameIndex;
  const frameIndexRef = useRef(frameIndex);
  frameIndexRef.current = frameIndex;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const setFrameIndex = useCallback((nextFrame: number) => {
    frameIndexRef.current = nextFrame;
    if (controlledFrameIndex === undefined) setUncontrolledFrameIndex(nextFrame);
    onFrameIndexChange?.(nextFrame);
  }, [controlledFrameIndex, onFrameIndexChange]);

  const performanceConfig = useMemo(
    () => resolveWorkbenchPerformanceTier(performanceTier),
    [performanceTier],
  );
  const timebase = useMemo(
    () => buildFrameTimebase(manifest?.metadata, frameTimetable),
    [frameTimetable, manifest?.metadata],
  );
  const maxFrame = Math.max(0, timebase.frameCount - 1);
  const size = useMemo(
    () => videoIntrinsicSize(manifest?.metadata.width, manifest?.metadata.height),
    [manifest?.metadata.height, manifest?.metadata.width],
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

  // v0.16.2 · 标注渲染派生(纯函数,与 VideoStage 现状对齐)。
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

  const {
    activeBitmap,
    capture: captureBitmapFrame,
    showFrame: showCachedBitmapFrame,
  } = useVideoBitmapCache({
    taskId: manifest?.task_id,
    maxItems: performanceConfig.videoBitmapCache,
  });

  const frameClock = useFrameClock({
    videoRef,
    frameIndex,
    timebase,
    isPlaying,
    onFrameChange: setFrameIndex,
  });

  const isPlaybackActive = isPlaying;

  const seekFrameAsync = useCallback(
    async (nextFrame: number, options?: { recordHistory?: boolean }) => {
      void options;
      const targetFrame = Math.max(0, Math.min(maxFrame, Math.round(nextFrame)));
      showCachedBitmapFrame(targetFrame);
      const result = await frameClock.seekToAsync(targetFrame);
      void captureBitmapFrame(videoRef.current, targetFrame);
      return result;
    },
    [captureBitmapFrame, frameClock, maxFrame, showCachedBitmapFrame],
  );
  const seekFrameAsyncRef = useRef(seekFrameAsync);
  useEffect(() => {
    seekFrameAsyncRef.current = seekFrameAsync;
  }, [seekFrameAsync]);

  const pausePlayback = useCallback(() => {
    videoRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused || isPlayingRef.current) {
      pausePlayback();
      return;
    }
    setPlaybackError(null);
    setIsPlaying(true);
    const result = video.play();
    if (result && typeof result.catch === "function") {
      void result.catch((err: unknown) => {
        setIsPlaying(false);
        setPlaybackError(err instanceof Error ? err.message : "视频无法播放");
      });
    }
  }, [pausePlayback]);

  const seekByFrames = useCallback((delta: number) => {
    pausePlayback();
    void seekFrameAsync(frameIndexRef.current + delta);
  }, [pausePlayback, seekFrameAsync]);

  const seekToFrame = useCallback((nextFrame: number) => {
    pausePlayback();
    void seekFrameAsync(nextFrame);
  }, [pausePlayback, seekFrameAsync]);

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

  // 切任务复位帧/播放态。
  const lastResetTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const taskId = manifest?.task_id ?? null;
    if (!taskId || lastResetTaskIdRef.current === taskId) return;
    lastResetTaskIdRef.current = taskId;
    setFrameIndex(0);
    setIsPlaying(false);
    setPlaybackError(null);
  }, [manifest?.task_id, setFrameIndex]);

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

  // 首帧预热 + 播放/暂停/seek 时抓位图(对齐旧栈)。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      setIsPlaying(false);
      setPlaybackError(video.error?.message || "当前浏览器无法播放该视频源");
    };
    const onFrameReady = () => {
      if (!isPlayingRef.current) void captureBitmapFrame(video, frameIndexRef.current);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    video.addEventListener("seeked", onFrameReady);
    video.addEventListener("loadeddata", onFrameReady);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.removeEventListener("seeked", onFrameReady);
      video.removeEventListener("loadeddata", onFrameReady);
    };
  }, [captureBitmapFrame, videoEl]);

  // 首次加载视频源主动 seek 当前帧,强制解码清晰首帧并抓成位图(对齐旧栈)。
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifest?.video_url) return;
    let cancelled = false;
    const prime = () => {
      if (cancelled) return;
      cancelled = true;
      void seekFrameAsyncRef.current(frameIndexRef.current);
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) prime();
    else video.addEventListener("loadedmetadata", prime, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", prime);
    };
  }, [manifest?.video_url, videoEl]);

  useImperativeHandle(ref, () => ({
    togglePlayback,
    jogPlayback: (dir: -1 | 1) => seekByFrames(dir),
    pausePlayback,
    seekByFrames: (delta: number) => seekByFrames(delta),
    seekGrid: (dir: -1 | 1) => seekByFrames(dir),
    microStep: (dir: -1 | 1) => seekByFrames(dir),
    seekToKeyframe: noop,
    seekToFrame: (f: number) => seekToFrame(f),
    toggleBookmark: noop,
    jumpHistory: noop,
    clearLoopRegion: noop,
    toggleSelectedTrackOutside: noop,
    toggleSelectedTrackOccluded: noop,
    toggleSelectedTrackHidden: noop,
    toggleSelectedTrackLocked: noop,
    propagateSelectedTrack: noop,
    deleteSelectedTrackKeyframe: () => false,
  }), [pausePlayback, seekByFrames, seekToFrame, togglePlayback]);

  const beginPan = useCallback((evt: ReactPointerEvent<HTMLDivElement>) => {
    if (evt.button !== 2) return;
    evt.preventDefault();
    panRef.current = { x: evt.clientX, y: evt.clientY };
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    pausePlayback();
    setPanning(true);
  }, [pausePlayback]);

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
      onContextMenu={(e) => e.preventDefault()}
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
          onClick={togglePlayback}
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
        </Stage>
      </div>
      {playbackError && (
        <div data-testid="video-konva-playback-error" className={styles.playbackError}>
          视频无法播放:{playbackError}
        </div>
      )}
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
    </div>
  );
});
