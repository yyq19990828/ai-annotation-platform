import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AnnotationResponse, TaskVideoFrameTimetableResponse, TaskVideoManifestResponse, VideoSamplingConfig } from "@/types";
import type { AnnotationFeedback } from "@/api/feedbacks";
import type { WorkbenchPerformanceTier } from "../state/performanceTier";
import { resolveWorkbenchPerformanceTier } from "../state/performanceTier";
import { buildFrameTimebase, frameToTime } from "./frameTimebase";
import type { FrameTimebase } from "./frameTimebase";
import { deriveSamplingStep, gridNext, gridPrev, microStep, snapToGrid } from "./videoSamplingGrid";
import { useFrameClock } from "./useFrameClock";
import { useVideoBitmapCache } from "./useVideoBitmapCache";
import type { CachedVideoBitmap } from "./useVideoBitmapCache";
import { imageBitmapToJpeg } from "@/utils/imageBitmapToJpeg";
import { useVideoFramePreview } from "./useVideoFramePreview";
import type { VideoFramePreview } from "./useVideoFramePreview";
import { useVideoTrackActions } from "./useVideoTrackActions";
import {
  emptyVideoJumpHistory,
  jumpVideoHistory,
  normalizeLoopRegion,
  parseStoredBookmarks,
  parseStoredJumpHistory,
  parseStoredLoopRegion,
  pushVideoJumpHistory,
  toggleVideoBookmark,
  videoNavigationStorageKey,
} from "./videoNavigationState";
import type { VideoBookmark, VideoJumpHistory, VideoLoopRegion } from "./videoNavigationState";
import {
  buildGlobalTimelineDensity,
  buildPredictionDensity,
  buildSelectedTrackTimeline,
  nextVisibleKeyframeFrame,
} from "./videoTrackTimeline";
import type { PredictionDensityBin, VideoTimelineDensityBin, VideoTrackTimeline } from "./videoTrackTimeline";
import { adjacentPredictedFrame } from "./aiBoxFrames";
import { getTrackColor } from "./colors";
import { modeFromDrag, getVideoStageModeGuard } from "./videoStageMode";
import { isVideoBbox, isVideoTrack, shapeIou, shortTrackId, sortedKeyframes } from "./videoStageGeometry";
import type { VideoStageGeom, VideoDragState, VideoTrackAnnotation } from "./videoStageTypes";
import type { VideoStageControls } from "./videoStageControls";

// TODO(v0.16.x): WebCodecs chunk-decoder 路径暂未迁到 Konva 栈(flag-gated 实验特性)。

const VIDEO_PLAYBACK_RATES = [0.25, 0.5, 1, 2, 4] as const;
const DEFAULT_VIDEO_PLAYBACK_RATE: VideoPlaybackRate = 1;

type VideoPlaybackRate = typeof VIDEO_PLAYBACK_RATES[number];
type VideoJogPlayback = { direction: -1 | 0 | 1; rate: VideoPlaybackRate };

const DEFAULT_PAUSED_JOG_PLAYBACK: VideoJogPlayback = {
  direction: 0,
  rate: DEFAULT_VIDEO_PLAYBACK_RATE,
};

function nextHigherPlaybackRate(rate: VideoPlaybackRate): VideoPlaybackRate {
  const idx = VIDEO_PLAYBACK_RATES.indexOf(rate);
  return VIDEO_PLAYBACK_RATES[Math.min(VIDEO_PLAYBACK_RATES.length - 1, idx + 1)];
}

function nextLowerPlaybackRate(rate: VideoPlaybackRate): VideoPlaybackRate | null {
  const idx = VIDEO_PLAYBACK_RATES.indexOf(rate);
  return idx <= 0 ? null : VIDEO_PLAYBACK_RATES[idx - 1];
}

export interface UseVideoPlaybackControllerOptions {
  manifest: TaskVideoManifestResponse | undefined;
  frameTimetable?: TaskVideoFrameTimetableResponse;
  videoRef: RefObject<HTMLVideoElement | null>;
  controlledFrameIndex?: number;
  onFrameIndexChange?: (frame: number) => void;
  onSelect?: (id: string | null) => void;
  performanceTier?: WorkbenchPerformanceTier;
  videoSampling?: VideoSamplingConfig | null;
  defaultPlaybackRate?: VideoPlaybackRate;
  annotations: AnnotationResponse[];
  /** v0.21.9 · AI 预测有内容的帧集合 (升序去重, collectPredictedFrames 产); 时间轴预测密度轨 + 跳预测帧。 */
  predictedFrames?: readonly number[];
  selectedId: string | null;
  selectedTrack: VideoTrackAnnotation | null;
  trackColorOverrides?: Record<string, string>;
  hiddenTrackIds: ReadonlySet<string>;
  lockedTrackIds: ReadonlySet<string>;
  readOnly: boolean;
  drag: VideoDragState;
  currentFrameEntries: Array<{ geom: VideoStageGeom; className: string }>;
  issuePixelFeedbacks?: AnnotationFeedback[];
  onUpdate: (annotation: AnnotationResponse, geometry: VideoTrackAnnotation["geometry"]) => void;
  onToggleHiddenTrack?: (id: string) => void;
  onToggleLockedTrack?: (id: string) => void;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
}

export interface UseVideoPlaybackControllerResult {
  frameIndex: number;
  isPlaybackActive: boolean;
  isJogPlaying: boolean;
  jogPlayback: VideoJogPlayback;
  playbackError: string | null;
  activeBitmap: CachedVideoBitmap | null;
  cachedRanges: { from: number; to: number }[];
  displayBitmap: CachedVideoBitmap | null;
  showCachedBitmap: boolean;
  framePreview: VideoFramePreview | null;
  previewFrame: (frameIndex: number | null) => void;
  samplingStep: number;
  maxFrame: number;
  timebase: FrameTimebase;
  fps: number;
  selectedTrackTimeline: VideoTrackTimeline | null;
  selectedTrackColor: string | null;
  selectedTrackKeyframes: ReturnType<typeof sortedKeyframes>;
  globalTimelineDensity: VideoTimelineDensityBin[];
  predictionDensity: PredictionDensityBin[];
  hasPredictedFrames: boolean;
  seekToAdjacentPredictedFrame: (dir: -1 | 1) => void;
  qualityWarnings: string[];
  issueFrames: number[];
  playbackOverlayVisible: boolean;
  highlightAction: "prev" | "next" | "play" | null;
  bookmarks: VideoBookmark[];
  loopRegion: VideoLoopRegion | null;
  trackActions: ReturnType<typeof useVideoTrackActions>;
  canDeleteSelectedTrackKeyframe: boolean;
  deleteSelectedTrackKeyframe: () => boolean;
  showPlaybackOverlay: () => void;
  schedulePlaybackOverlayHide: () => void;
  setNormalizedLoopRegion: (region: VideoLoopRegion) => void;
  clearLoopRegion: () => void;
  toggleBookmark: () => void;
  seekToFrame: (frameIndex: number, options?: { recordHistory?: boolean }) => void;
  seekOverlayByFrames: (delta: number, options?: { recordHistory?: boolean }) => void;
  pausePlayback: (options?: { snapToGrid?: boolean }) => void;
  /** cycleInCategory / stepCategory 由 VideoKonvaStage 补齐, 故此处 Omit(见 controls memo)。 */
  controls: Omit<VideoStageControls, "cycleInCategory" | "stepCategory">;
}

export function useVideoPlaybackController({
  manifest,
  frameTimetable,
  videoRef,
  controlledFrameIndex,
  onFrameIndexChange,
  onSelect,
  performanceTier = "standard",
  videoSampling = null,
  defaultPlaybackRate = DEFAULT_VIDEO_PLAYBACK_RATE,
  annotations,
  predictedFrames = [],
  selectedTrack,
  trackColorOverrides,
  hiddenTrackIds,
  lockedTrackIds,
  readOnly,
  drag,
  currentFrameEntries,
  issuePixelFeedbacks,
  onUpdate,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  onPropagateTrack,
}: UseVideoPlaybackControllerOptions): UseVideoPlaybackControllerResult {
  const pausedJogPlayback = useMemo<VideoJogPlayback>(
    () => ({ direction: 0, rate: defaultPlaybackRate }),
    [defaultPlaybackRate],
  );
  const pausedJogPlaybackRef = useRef<VideoJogPlayback>(pausedJogPlayback);
  pausedJogPlaybackRef.current = pausedJogPlayback;

  const [uncontrolledFrameIndex, setUncontrolledFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [jogPlayback, setJogPlayback] = useState<VideoJogPlayback>(
    () => pausedJogPlayback,
  );
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackOverlayVisible, setPlaybackOverlayVisible] = useState(true);
  const [highlightAction, setHighlightAction] = useState<"prev" | "next" | "play" | null>(null);
  const [loopRegion, setLoopRegion] = useState<VideoLoopRegion | null>(null);
  const [bookmarks, setBookmarks] = useState<VideoBookmark[]>([]);
  const [jumpHistory, setJumpHistory] = useState<VideoJumpHistory>(() => emptyVideoJumpHistory());

  const lastResetTaskIdRef = useRef<string | null>(null);
  const overlayHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameIndexRef = useRef(0);
  const jogPlaybackRef = useRef<VideoJogPlayback>(DEFAULT_PAUSED_JOG_PLAYBACK);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const frameIndex = controlledFrameIndex ?? uncontrolledFrameIndex;
  frameIndexRef.current = frameIndex;
  jogPlaybackRef.current = jogPlayback;
  const isJogPlaying = jogPlayback.direction !== 0;
  const isPlaybackActive = isPlaying || isJogPlaying;

  // defaultPlaybackRate 变化时重置停帧态的 jog 速率,不中断播放。
  useEffect(() => {
    if (jogPlaybackRef.current.direction === 0) {
      setJogPlayback(pausedJogPlayback);
    }
    if (!isPlaybackActive && videoRef.current) {
      videoRef.current.playbackRate = defaultPlaybackRate;
    }
  }, [defaultPlaybackRate, isPlaybackActive, pausedJogPlayback, videoRef]);

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
  const fps = timebase.fps;
  const frameCount = timebase.frameCount;
  const maxFrame = Math.max(0, frameCount - 1);

  const samplingStep = useMemo(() => deriveSamplingStep(videoSampling, fps), [videoSampling, fps]);
  const samplingStepRef = useRef(samplingStep);
  samplingStepRef.current = samplingStep;

  const stageMode = modeFromDrag(drag);
  const stageModeGuard = getVideoStageModeGuard(stageMode);

  const handleFrameClockChange = useCallback((nextFrame: number) => {
    if (!stageModeGuard.canSetupFrame) {
      videoRef.current?.pause();
      setJogPlayback(pausedJogPlaybackRef.current);
      return;
    }
    if (isPlaybackActive && loopRegion && nextFrame > loopRegion.endFrame) {
      setFrameIndex(loopRegion.startFrame);
      const video = videoRef.current;
      if (video) video.currentTime = frameToTime(loopRegion.startFrame, timebase);
      return;
    }
    setFrameIndex(nextFrame);
  }, [isPlaybackActive, loopRegion, setFrameIndex, stageModeGuard.canSetupFrame, timebase, videoRef]);

  const frameClock = useFrameClock({
    videoRef,
    frameIndex,
    timebase,
    isPlaying,
    onFrameChange: handleFrameClockChange,
  });

  const {
    preview: framePreview,
    previewFor: previewFrame,
    prefetch: prefetchFrames,
  } = useVideoFramePreview({
    taskId: manifest?.task_id,
    maxFrame,
    enabled: Boolean(manifest),
    width: 320,
    format: "webp",
    maxCacheItems: performanceConfig.previewCache,
    scrubPrefetchHalfWindow: performanceConfig.prefetchHalfWindow,
    anchorPrefetchCount: performanceConfig.anchorPrefetch,
  });

  const {
    activeBitmap,
    cachedRanges,
    capture: captureBitmapFrame,
    showFrame: showCachedBitmapFrame,
  } = useVideoBitmapCache({
    taskId: manifest?.task_id,
    maxItems: performanceConfig.videoBitmapCache,
  });

  // 精确帧: 无 WebCodecs 路径，直接用 <video> 位图缓存。
  const displayBitmap = activeBitmap;
  // v0.21.4 · 当前帧位图 ref(读最新值, 避免把 activeBitmap 塞进 controls memo deps → 逐帧重建句柄)。
  const activeBitmapRef = useRef(activeBitmap);
  activeBitmapRef.current = activeBitmap;
  const showCachedBitmap = Boolean(displayBitmap && !isPlaybackActive);

  const videoTracks = useMemo(() => annotations.filter(isVideoTrack), [annotations]);

  const selectedTrackTimeline = useMemo(
    () => selectedTrack ? buildSelectedTrackTimeline(selectedTrack.geometry) : null,
    [selectedTrack],
  );

  const selectedTrackColor = useMemo(
    () => selectedTrack
      ? getTrackColor(selectedTrack.geometry.track_id, selectedTrack.class_name, trackColorOverrides)
      : null,
    [selectedTrack, trackColorOverrides],
  );

  const selectedTrackKeyframes = useMemo(
    () => selectedTrack ? sortedKeyframes(selectedTrack.geometry) : [],
    [selectedTrack],
  );

  const manualBboxFrames = useMemo(
    () => annotations
      .flatMap((ann) => (isVideoBbox(ann) && ann.source !== "prediction_based" ? [ann.geometry.frame_index] : [])),
    [annotations],
  );

  const globalTimelineDensity = useMemo(
    () => selectedTrack
      ? []
      : buildGlobalTimelineDensity(videoTracks.map((ann) => ann.geometry), maxFrame, 80, manualBboxFrames),
    [manualBboxFrames, maxFrame, selectedTrack, videoTracks],
  );

  // v0.21.9 · 预测密度轨: 始终计算 (不像人工密度条在选中轨迹时清空), 让审阅时预测分布常驻可见。
  const predictionDensity = useMemo(
    () => buildPredictionDensity(predictedFrames, maxFrame, 80),
    [predictedFrames, maxFrame],
  );
  const hasPredictedFrames = predictedFrames.length > 0;

  const qualityWarnings = useMemo(() => {
    const warnings: string[] = [];
    const maxGap = Math.max(30, Math.round(fps * 2));
    for (const ann of videoTracks) {
      const kfs = sortedKeyframes(ann.geometry);
      for (let i = 1; i < kfs.length; i++) {
        const gap = kfs[i].frame_index - kfs[i - 1].frame_index;
        if (gap > maxGap) {
          warnings.push(`${ann.class_name} ${shortTrackId(ann.geometry.track_id)} 关键帧间隔 ${gap} 帧`);
          break;
        }
      }
    }
    for (const entry of currentFrameEntries) {
      if (entry.geom.w < 0.003 || entry.geom.h < 0.003) warnings.push(`${entry.className} 当前帧存在极小框`);
    }
    for (let i = 0; i < currentFrameEntries.length; i++) {
      for (let j = i + 1; j < currentFrameEntries.length; j++) {
        const a = currentFrameEntries[i];
        const b = currentFrameEntries[j];
        if (a.className === b.className && shapeIou(a.geom, b.geom) > 0.9) {
          warnings.push(`${a.className} 当前帧存在高度重叠框`);
        }
      }
    }
    return [...new Set(warnings)].slice(0, 3);
  }, [currentFrameEntries, fps, videoTracks]);

  const issueFrames = useMemo(() => {
    const frames = new Set<number>();
    for (const f of issuePixelFeedbacks ?? []) {
      if (f.kind !== "issue" || f.anchor_type !== "pixel") continue;
      const frame = f.anchor_position?.frame;
      if (typeof frame === "number") frames.add(frame);
    }
    return [...frames].sort((a, b) => a - b);
  }, [issuePixelFeedbacks]);

  const trackActions = useVideoTrackActions({
    selectedTrack,
    frameIndex,
    readOnly,
    hiddenTrackIds: hiddenTrackIds as Set<string>,
    lockedTrackIds: lockedTrackIds as Set<string>,
    onUpdate,
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
    onUpdate(selectedTrack, {
      ...selectedTrack.geometry,
      keyframes: sortedKeyframes(selectedTrack.geometry)
        .filter((kf) => kf.frame_index !== frameIndex),
    });
    return true;
  }, [canDeleteSelectedTrackKeyframe, frameIndex, onUpdate, selectedTrack, selectedTrackCurrentKeyframe]);

  // ---- 播放 overlay 计时器 ----
  const showPlaybackOverlay = useCallback(() => {
    if (overlayHideTimerRef.current) clearTimeout(overlayHideTimerRef.current);
    setPlaybackOverlayVisible(true);
  }, []);

  // 指针离开画布 2s 后隐藏播放浮层(对齐旧 SVG 栈);否则浮层默认 true 后永不收起、长期遮挡画布。
  const schedulePlaybackOverlayHide = useCallback(() => {
    if (overlayHideTimerRef.current) clearTimeout(overlayHideTimerRef.current);
    overlayHideTimerRef.current = setTimeout(() => setPlaybackOverlayVisible(false), 2000);
  }, []);

  const flashPlaybackAction = useCallback((action: "prev" | "next" | "play") => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightAction(action);
    highlightTimerRef.current = setTimeout(() => setHighlightAction(null), 180);
  }, []);

  // ---- seek 核心 ----
  const seekFrameAsync = useCallback(
    async (nextFrame: number, options?: { recordHistory?: boolean }) => {
      if (!stageModeGuard.canSetupFrame) return;
      const targetFrame = Math.max(0, Math.min(maxFrame, Math.round(nextFrame)));
      if (options?.recordHistory) {
        setJumpHistory((history) => pushVideoJumpHistory(history, targetFrame));
      }
      showCachedBitmapFrame(targetFrame);
      const result = await frameClock.seekToAsync(targetFrame);
      void captureBitmapFrame(videoRef.current, targetFrame);
      return result;
    },
    [captureBitmapFrame, frameClock, maxFrame, showCachedBitmapFrame, stageModeGuard.canSetupFrame, videoRef],
  );
  const seekFrameAsyncRef = useRef(seekFrameAsync);
  useEffect(() => {
    seekFrameAsyncRef.current = seekFrameAsync;
  }, [seekFrameAsync]);

  // ---- 播放控制 ----
  const pausePlayback = useCallback((options?: { snapToGrid?: boolean }) => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.playbackRate = defaultPlaybackRate;
    }
    setIsPlaying(false);
    setJogPlayback(pausedJogPlaybackRef.current);
    const step = samplingStepRef.current;
    if ((options?.snapToGrid ?? true) && step > 1) {
      const snapped = snapToGrid(frameIndexRef.current, step, maxFrame);
      if (snapped !== frameIndexRef.current) {
        void seekFrameAsyncRef.current(snapped, { recordHistory: false });
      }
    }
  }, [defaultPlaybackRate, maxFrame, videoRef]);

  const togglePlayback = useCallback(() => {
    showPlaybackOverlay();
    flashPlaybackAction("play");
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused || isPlaybackActive) {
      pausePlayback();
      return;
    }
    if (loopRegion && (frameIndex < loopRegion.startFrame || frameIndex > loopRegion.endFrame)) {
      void seekFrameAsync(loopRegion.startFrame, { recordHistory: true });
    }
    setPlaybackError(null);
    setJogPlayback(pausedJogPlaybackRef.current);
    video.playbackRate = defaultPlaybackRate;
    setIsPlaying(true);
    const playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      void playResult.catch((err: unknown) => {
        setIsPlaying(false);
        setPlaybackError(err instanceof Error ? err.message : "视频无法播放");
      });
    }
  }, [defaultPlaybackRate, flashPlaybackAction, frameIndex, isPlaybackActive, loopRegion, pausePlayback, seekFrameAsync, showPlaybackOverlay, videoRef]);

  const jogPlaybackBy = useCallback((dir: -1 | 1) => {
    showPlaybackOverlay();
    flashPlaybackAction(dir < 0 ? "prev" : "next");
    setPlaybackError(null);
    const current = jogPlaybackRef.current;
    const next = current.direction === 0
      ? { direction: dir, rate: pausedJogPlaybackRef.current.rate }
      : current.direction === dir
        ? { direction: dir, rate: nextHigherPlaybackRate(current.rate) }
        : (() => {
          const lower = nextLowerPlaybackRate(current.rate);
          return lower ? { ...current, rate: lower } : pausedJogPlaybackRef.current;
        })();
    if (next.direction === 0) {
      pausePlayback();
      return;
    }
    setJogPlayback(next);
  }, [flashPlaybackAction, pausePlayback, showPlaybackOverlay]);

  const seekByFrames = useCallback(
    (delta: number, options?: { recordHistory?: boolean }) => {
      showPlaybackOverlay();
      flashPlaybackAction(delta < 0 ? "prev" : "next");
      pausePlayback({ snapToGrid: false });
      void seekFrameAsync(frameIndexRef.current + delta, { recordHistory: options?.recordHistory ?? true });
    },
    [flashPlaybackAction, pausePlayback, seekFrameAsync, showPlaybackOverlay],
  );

  const seekGrid = useCallback(
    (dir: -1 | 1, options?: { recordHistory?: boolean }) => {
      const step = samplingStepRef.current;
      const cur = frameIndexRef.current;
      const target = dir < 0 ? gridPrev(cur, step, maxFrame) : gridNext(cur, step, maxFrame);
      showPlaybackOverlay();
      flashPlaybackAction(dir < 0 ? "prev" : "next");
      pausePlayback({ snapToGrid: false });
      void seekFrameAsync(target, { recordHistory: options?.recordHistory ?? true });
    },
    [flashPlaybackAction, maxFrame, pausePlayback, seekFrameAsync, showPlaybackOverlay],
  );

  const microStepBy = useCallback(
    (dir: -1 | 1, options?: { recordHistory?: boolean }) => {
      const target = microStep(frameIndexRef.current, dir, maxFrame);
      showPlaybackOverlay();
      flashPlaybackAction(dir < 0 ? "prev" : "next");
      pausePlayback({ snapToGrid: false });
      void seekFrameAsync(target, { recordHistory: options?.recordHistory ?? true });
    },
    [flashPlaybackAction, maxFrame, pausePlayback, seekFrameAsync, showPlaybackOverlay],
  );

  const seekToKeyframe = useCallback(
    (dir: -1 | 1, options?: { recordHistory?: boolean }) => {
      if (!selectedTrack) return;
      const nextFrame = nextVisibleKeyframeFrame(selectedTrack.geometry, frameIndexRef.current, dir);
      if (nextFrame === null) return;
      showPlaybackOverlay();
      flashPlaybackAction(dir < 0 ? "prev" : "next");
      pausePlayback({ snapToGrid: false });
      void seekFrameAsync(nextFrame, { recordHistory: options?.recordHistory ?? true });
    },
    [flashPlaybackAction, pausePlayback, seekFrameAsync, selectedTrack, showPlaybackOverlay],
  );

  const seekOverlayByFrames = useCallback(
    (delta: number, options?: { recordHistory?: boolean }) => {
      if (samplingStepRef.current > 1 && Math.abs(delta) === 1) {
        seekGrid(delta < 0 ? -1 : 1, options);
        return;
      }
      seekByFrames(delta, options);
    },
    [seekByFrames, seekGrid],
  );

  const seekToFrame = useCallback(
    (nextFrame: number, options?: { recordHistory?: boolean }) => {
      showPlaybackOverlay();
      pausePlayback({ snapToGrid: false });
      void seekFrameAsync(nextFrame, { recordHistory: options?.recordHistory ?? true });
    },
    [pausePlayback, seekFrameAsync, showPlaybackOverlay],
  );

  // v0.21.9 · 跳到下一个/上一个有预测的帧 (预测帧集合上的 next/prev)。
  const seekToAdjacentPredictedFrame = useCallback((dir: -1 | 1) => {
    const target = adjacentPredictedFrame(predictedFrames, frameIndex, dir);
    if (target !== null) seekToFrame(target, { recordHistory: true });
  }, [predictedFrames, frameIndex, seekToFrame]);

  const toggleBookmark = useCallback(() => {
    showPlaybackOverlay();
    setBookmarks((current) => toggleVideoBookmark(current, frameIndex));
  }, [frameIndex, showPlaybackOverlay]);

  const jumpHistoryBy = useCallback((dir: -1 | 1) => {
    const result = jumpVideoHistory(jumpHistory, dir);
    setJumpHistory(result.history);
    if (result.frameIndex === null) return;
    showPlaybackOverlay();
    pausePlayback({ snapToGrid: false });
    void seekFrameAsync(result.frameIndex, { recordHistory: false });
  }, [jumpHistory, pausePlayback, seekFrameAsync, showPlaybackOverlay]);

  const clearLoopRegion = useCallback(() => {
    showPlaybackOverlay();
    setLoopRegion(null);
  }, [showPlaybackOverlay]);

  const setNormalizedLoopRegion = useCallback((region: VideoLoopRegion) => {
    showPlaybackOverlay();
    setLoopRegion(normalizeLoopRegion(region.startFrame, region.endFrame, maxFrame));
  }, [maxFrame, showPlaybackOverlay]);

  // ---- 正向 jog 播放 effect ----
  useEffect(() => {
    if (jogPlayback.direction !== 1) return;
    const video = videoRef.current;
    if (!video) return;
    if (loopRegion && (frameIndexRef.current < loopRegion.startFrame || frameIndexRef.current > loopRegion.endFrame)) {
      void seekFrameAsyncRef.current(loopRegion.startFrame, { recordHistory: true });
    }
    video.playbackRate = jogPlayback.rate;
    setIsPlaying(true);
    const playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      void playResult.catch((err: unknown) => {
        setIsPlaying(false);
        setJogPlayback(pausedJogPlaybackRef.current);
        setPlaybackError(err instanceof Error ? err.message : "视频无法播放");
      });
    }
  }, [jogPlayback.direction, jogPlayback.rate, loopRegion, videoRef]);

  // ---- 反向 rAF 循环 effect ----
  useEffect(() => {
    if (jogPlayback.direction !== -1) return;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.playbackRate = defaultPlaybackRate;
    }
    setIsPlaying(false);
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let seeking = false;
    let cancelled = false;
    const schedule = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const cancel = typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsedMs = Math.min(250, Math.max(0, now - last));
      last = now;
      accumulator += (elapsedMs / 1000) * fps * jogPlayback.rate;
      const steps = Math.floor(accumulator);
      if (steps > 0 && !seeking) {
        accumulator -= steps;
        const current = frameIndexRef.current;
        let nextFrame = current - steps;
        if (loopRegion) {
          if (nextFrame < loopRegion.startFrame) nextFrame = loopRegion.endFrame;
        } else if (nextFrame < 0) {
          nextFrame = 0;
          setJogPlayback(pausedJogPlaybackRef.current);
        }
        seeking = true;
        void Promise.resolve(seekFrameAsyncRef.current(nextFrame, { recordHistory: false })).finally(() => {
          seeking = false;
        });
      }
      raf = schedule(tick);
    };

    raf = schedule(tick);
    return () => {
      cancelled = true;
      cancel(raf);
    };
  }, [defaultPlaybackRate, fps, jogPlayback.direction, jogPlayback.rate, loopRegion, videoRef]);

  // ---- 视频事件监听 ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setJogPlayback(pausedJogPlaybackRef.current);
    };
    const onError = () => {
      setIsPlaying(false);
      setJogPlayback(pausedJogPlaybackRef.current);
      setPlaybackError(video.error?.message || "当前浏览器无法播放该视频源");
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    const onFrameReady = () => {
      if (!isPlaybackActive) void captureBitmapFrame(video, frameIndexRef.current);
    };
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
  }, [captureBitmapFrame, isPlaybackActive, videoRef]);

  // ---- 首帧预热 ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifest?.video_url) return;
    let cancelled = false;
    const primeFirstFrame = () => {
      if (cancelled) return;
      cancelled = true;
      void seekFrameAsyncRef.current(frameIndexRef.current, { recordHistory: false });
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      primeFirstFrame();
    } else {
      video.addEventListener("loadedmetadata", primeFirstFrame, { once: true });
    }
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", primeFirstFrame);
    };
  }, [manifest?.video_url, videoRef]);

  // ---- 暂停时持续抓位图 ----
  useEffect(() => {
    if (isPlaybackActive || frameClock.isSeeking) return;
    const schedule = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const cancel = typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
    const raf = schedule(() => {
      void captureBitmapFrame(videoRef.current, frameIndex);
    });
    return () => {
      cancel(raf);
    };
  }, [captureBitmapFrame, frameClock.isSeeking, frameIndex, isPlaybackActive, videoRef]);

  // ---- 任务切换复位 ----
  useEffect(() => {
    const taskId = manifest?.task_id ?? null;
    if (!taskId || lastResetTaskIdRef.current === taskId) return;
    lastResetTaskIdRef.current = taskId;
    setFrameIndex(0);
    setIsPlaying(false);
    setJogPlayback(pausedJogPlaybackRef.current);
    setPlaybackError(null);
    setPlaybackOverlayVisible(true);
    try {
      setLoopRegion(parseStoredLoopRegion(sessionStorage.getItem(videoNavigationStorageKey(taskId, "loop")), maxFrame));
      setBookmarks(parseStoredBookmarks(sessionStorage.getItem(videoNavigationStorageKey(taskId, "bookmarks")), maxFrame));
      setJumpHistory(parseStoredJumpHistory(sessionStorage.getItem(videoNavigationStorageKey(taskId, "history")), maxFrame));
    } catch {
      setLoopRegion(null);
      setBookmarks([]);
      setJumpHistory(emptyVideoJumpHistory());
    }
    onSelectRef.current?.(null);
  }, [manifest?.task_id, maxFrame, setFrameIndex]);

  // ---- sessionStorage 持久化 ----
  useEffect(() => {
    const taskId = manifest?.task_id;
    if (!taskId) return;
    try {
      const key = videoNavigationStorageKey(taskId, "loop");
      if (loopRegion) sessionStorage.setItem(key, JSON.stringify(loopRegion));
      else sessionStorage.removeItem(key);
    } catch {
      // sessionStorage 不可用时静默忽略
    }
  }, [loopRegion, manifest?.task_id]);

  useEffect(() => {
    const taskId = manifest?.task_id;
    if (!taskId) return;
    try {
      sessionStorage.setItem(videoNavigationStorageKey(taskId, "bookmarks"), JSON.stringify(bookmarks));
    } catch {
      // noop
    }
  }, [bookmarks, manifest?.task_id]);

  useEffect(() => {
    const taskId = manifest?.task_id;
    if (!taskId) return;
    try {
      sessionStorage.setItem(videoNavigationStorageKey(taskId, "history"), JSON.stringify(jumpHistory));
    } catch {
      // noop
    }
  }, [jumpHistory, manifest?.task_id]);

  // ---- 预加载关键帧预览 ----
  useEffect(() => {
    if (!selectedTrack) return;
    prefetchFrames(selectedTrackKeyframes.map((kf) => kf.frame_index));
  }, [prefetchFrames, selectedTrack, selectedTrackKeyframes]);

  useEffect(() => {
    prefetchFrames(bookmarks.map((bookmark) => bookmark.frameIndex));
  }, [bookmarks, prefetchFrames]);

  useEffect(() => {
    if (!loopRegion) return;
    prefetchFrames([loopRegion.startFrame, loopRegion.endFrame]);
  }, [loopRegion, prefetchFrames]);

  // ---- 计时器清理 ----
  useEffect(() => {
    return () => {
      if (overlayHideTimerRef.current) clearTimeout(overlayHideTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // ---- controls 句柄(对齐 VideoStage useImperativeHandle) ----
  // cycleInCategory / stepCategory 依赖 stage 侧的当前帧分类 + selectedId + onSelect,
  // 由 VideoKonvaStage 在 useImperativeHandle 补齐, 故此处 Omit。
  const controls = useMemo<Omit<VideoStageControls, "cycleInCategory" | "stepCategory">>(() => ({
    togglePlayback,
    jogPlayback: jogPlaybackBy,
    pausePlayback,
    seekByFrames,
    seekGrid,
    microStep: microStepBy,
    seekToKeyframe,
    seekToFrame,
    toggleBookmark,
    jumpHistory: jumpHistoryBy,
    clearLoopRegion,
    toggleSelectedTrackOutside: trackActions.toggleSelectedTrackOutside,
    toggleSelectedTrackOccluded: trackActions.toggleSelectedTrackOccluded,
    toggleSelectedTrackHidden: trackActions.toggleSelectedTrackHidden,
    toggleSelectedTrackLocked: trackActions.toggleSelectedTrackLocked,
    propagateSelectedTrack: trackActions.propagateSelectedTrack,
    deleteSelectedTrackKeyframe,
    // v0.21.4 · 当前帧 → JPEG(视频单题 AI 供图), 经 ref 读最新位图故不入 deps。
    captureCurrentFrameJpeg: async (quality?: number) => {
      const bmp = activeBitmapRef.current?.bitmap;
      if (!bmp) return null;
      return imageBitmapToJpeg(bmp, quality);
    },
  }), [
    clearLoopRegion,
    deleteSelectedTrackKeyframe,
    jogPlaybackBy,
    jumpHistoryBy,
    microStepBy,
    pausePlayback,
    seekByFrames,
    seekGrid,
    seekToFrame,
    seekToKeyframe,
    toggleBookmark,
    togglePlayback,
    trackActions.propagateSelectedTrack,
    trackActions.toggleSelectedTrackHidden,
    trackActions.toggleSelectedTrackLocked,
    trackActions.toggleSelectedTrackOccluded,
    trackActions.toggleSelectedTrackOutside,
  ]);

  return {
    frameIndex,
    isPlaybackActive,
    isJogPlaying,
    jogPlayback,
    playbackError,
    activeBitmap,
    cachedRanges,
    displayBitmap,
    showCachedBitmap,
    framePreview,
    previewFrame,
    samplingStep,
    maxFrame,
    timebase,
    fps,
    selectedTrackTimeline,
    selectedTrackColor,
    selectedTrackKeyframes,
    globalTimelineDensity,
    predictionDensity,
    hasPredictedFrames,
    seekToAdjacentPredictedFrame,
    qualityWarnings,
    issueFrames,
    playbackOverlayVisible,
    highlightAction,
    bookmarks,
    loopRegion,
    trackActions,
    canDeleteSelectedTrackKeyframe,
    deleteSelectedTrackKeyframe,
    showPlaybackOverlay,
    schedulePlaybackOverlayHide,
    setNormalizedLoopRegion,
    clearLoopRegion,
    toggleBookmark,
    seekToFrame,
    seekOverlayByFrames,
    pausePlayback,
    controls,
  };
}
