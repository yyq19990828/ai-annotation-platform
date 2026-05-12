import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { FloatingDock } from "../shell/FloatingDock";
import type { AnnotationResponse, TaskVideoFrameTimetableResponse, TaskVideoManifestResponse } from "@/types";
import type { PendingDrawing, VideoTool } from "../state/useWorkbenchState";
import { useElementSize, useViewportTransform } from "../state/useViewportTransform";
import type { DiffMode } from "../modes/types";
import { Minimap } from "./Minimap";
import { VideoFrameOverlay } from "./VideoFrameOverlay";
import { VideoMediaLayer } from "./VideoMediaLayer";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";
import { VideoQcWarnings } from "./VideoQcWarnings";
import { VideoSelectionActions } from "./VideoSelectionActions";
import { VideoStageSurface } from "./VideoStageSurface";
import { applyResize } from "./ResizeHandles";
import { buildFrameTimebase, frameToTime } from "./frameTimebase";
import { useFrameClock } from "./useFrameClock";
import { useVideoBitmapCache } from "./useVideoBitmapCache";
import { useVideoFramePreview } from "./useVideoFramePreview";
import { videoTimelineMarkers } from "./videoFrameBuckets";
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
  buildSelectedTrackTimeline,
  nextVisibleKeyframeFrame,
} from "./videoTrackTimeline";
import { clientPointToVideoPoint } from "./videoStageCoordinates";
import { modeFromDrag, getVideoStageModeGuard } from "./videoStageMode";
import {
  clampGeom,
  isVideoBbox,
  isVideoTrack,
  nearestTrackKeyframe,
  normalizeGeom,
  resolveTrackAtFrame,
  shapeIou,
  shortTrackId,
  sortedKeyframes,
  upsertKeyframe,
} from "./videoStageGeometry";
import type {
  VideoDragState,
  VideoFrameEntry,
  VideoResizeDirection,
  VideoStageGeom,
  VideoStageGeometry,
  VideoTrackConversionOptions,
  VideoTrackGhost,
  VideoTrackPreview,
} from "./videoStageTypes";

const EMPTY_TRACK_ID_SET = new Set<string>();
const VIDEO_PLAYBACK_RATES = [0.25, 0.5, 1, 2, 4] as const;

type VideoPlaybackRate = typeof VIDEO_PLAYBACK_RATES[number];
type VideoJogPlayback = { direction: -1 | 0 | 1; rate: VideoPlaybackRate };

const PAUSED_JOG_PLAYBACK: VideoJogPlayback = { direction: 0, rate: 1 };

function nextHigherPlaybackRate(rate: VideoPlaybackRate): VideoPlaybackRate {
  const idx = VIDEO_PLAYBACK_RATES.indexOf(rate);
  return VIDEO_PLAYBACK_RATES[Math.min(VIDEO_PLAYBACK_RATES.length - 1, idx + 1)];
}

function nextLowerPlaybackRate(rate: VideoPlaybackRate): VideoPlaybackRate | null {
  const idx = VIDEO_PLAYBACK_RATES.indexOf(rate);
  return idx <= 0 ? null : VIDEO_PLAYBACK_RATES[idx - 1];
}

function visibleInReviewMode(source: VideoFrameEntry["source"], mode?: DiffMode): boolean {
  if (!mode || mode === "diff") return true;
  if (mode === "raw") return source === "prediction" || source === "interpolated";
  return source === "manual" || source === "legacy";
}

interface VideoStageProps {
  manifest: TaskVideoManifestResponse | undefined;
  frameTimetable?: TaskVideoFrameTimetableResponse;
  isLoading?: boolean;
  error?: unknown;
  annotations: AnnotationResponse[];
  selectedId: string | null;
  activeClass: string;
  frameIndex?: number;
  reviewDisplayMode?: DiffMode;
  hiddenTrackIds?: Set<string>;
  lockedTrackIds?: Set<string>;
  readOnly?: boolean;
  videoTool?: VideoTool;
  pendingDrawing?: PendingDrawing;
  onSelect: (id: string | null, opts?: { shift?: boolean }) => void;
  onFrameIndexChange?: (frameIndex: number) => void;
  onCreate: (frameIndex: number, geom: VideoStageGeom) => void;
  onPendingDraw?: (
    kind: "video_bbox" | "video_track",
    frameIndex: number,
    geom: VideoStageGeom,
    anchor: { left: number; top: number },
  ) => void;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoStageGeometry) => void;
  onRename: (annotation: AnnotationResponse, className: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  onDelete?: (annotation: AnnotationResponse) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  onCursorMove?: (pt: { x: number; y: number } | null) => void;
}

export interface VideoStageControls {
  togglePlayback: () => void;
  jogPlayback: (dir: -1 | 1) => void;
  pausePlayback: () => void;
  seekByFrames: (delta: number, options?: { recordHistory?: boolean }) => void;
  seekToKeyframe: (dir: -1 | 1, options?: { recordHistory?: boolean }) => void;
  seekToFrame: (frameIndex: number, options?: { recordHistory?: boolean }) => void;
  toggleBookmark: () => void;
  jumpHistory: (dir: -1 | 1) => void;
  clearLoopRegion: () => void;
}

export const VideoStage = forwardRef<VideoStageControls, VideoStageProps>(function VideoStage({
  manifest,
  frameTimetable,
  isLoading = false,
  error,
  annotations,
  selectedId,
  activeClass,
  frameIndex: controlledFrameIndex,
  reviewDisplayMode,
  hiddenTrackIds = EMPTY_TRACK_ID_SET,
  lockedTrackIds = EMPTY_TRACK_ID_SET,
  readOnly = false,
  videoTool = "box",
  pendingDrawing = null,
  onSelect,
  onFrameIndexChange,
  onCreate,
  onPendingDraw,
  onUpdate,
  onChangeUserBoxClass,
  onDelete,
  onConvertToBboxes,
  onCursorMove,
}: VideoStageProps, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const viewportSize = useElementSize(containerRef);
  const { vp, vpRef, setVp, fit, zoomAt } = useViewportTransform();
  const [uncontrolledFrameIndex, setUncontrolledFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [jogPlayback, setJogPlayback] = useState<VideoJogPlayback>(PAUSED_JOG_PLAYBACK);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [drag, setDrag] = useState<VideoDragState>(null);
  const [playbackOverlayVisible, setPlaybackOverlayVisible] = useState(true);
  const [highlightAction, setHighlightAction] = useState<"prev" | "next" | "play" | null>(null);
  const [loopRegion, setLoopRegion] = useState<VideoLoopRegion | null>(null);
  const [bookmarks, setBookmarks] = useState<VideoBookmark[]>([]);
  const [jumpHistory, setJumpHistory] = useState<VideoJumpHistory>(() => emptyVideoJumpHistory());
  const onSelectRef = useRef(onSelect);
  const lastResetTaskIdRef = useRef<string | null>(null);
  const fittedTaskIdRef = useRef<string | null>(null);
  const minimapVisibleRef = useRef(false);
  const overlayHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameIndexRef = useRef(0);
  const jogPlaybackRef = useRef<VideoJogPlayback>(PAUSED_JOG_PLAYBACK);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const frameIndex = controlledFrameIndex ?? uncontrolledFrameIndex;
  frameIndexRef.current = frameIndex;
  jogPlaybackRef.current = jogPlayback;
  const isJogPlaying = jogPlayback.direction !== 0;
  const isPlaybackActive = isPlaying || isJogPlaying;
  const setFrameIndex = useCallback((nextFrame: number) => {
    if (controlledFrameIndex === undefined) setUncontrolledFrameIndex(nextFrame);
    onFrameIndexChange?.(nextFrame);
  }, [controlledFrameIndex, onFrameIndexChange]);

  const timebase = useMemo(
    () => buildFrameTimebase(manifest?.metadata, frameTimetable),
    [frameTimetable, manifest?.metadata],
  );
  const fps = timebase.fps;
  const frameCount = timebase.frameCount;
  const maxFrame = Math.max(0, frameCount - 1);
  const videoAspectRatio = manifest?.metadata.width && manifest.metadata.height
    ? manifest.metadata.width / manifest.metadata.height
    : 16 / 9;
  const videoPixelWidth = manifest?.metadata.width || 1280;
  const videoPixelHeight = manifest?.metadata.height || Math.round(videoPixelWidth / videoAspectRatio);

  const videoTracks = useMemo(() => annotations.filter(isVideoTrack), [annotations]);
  const selectedTrack = useMemo(
    () => videoTracks.find((ann) => ann.id === selectedId) ?? null,
    [selectedId, videoTracks],
  );
  const selectedAnnotation = useMemo(
    () => annotations.find((ann) => ann.id === selectedId) ?? null,
    [annotations, selectedId],
  );

  const currentFrameEntries = useMemo(() => {
    const out: VideoFrameEntry[] = [];
    for (const ann of annotations) {
      if (isVideoBbox(ann) && ann.geometry.frame_index === frameIndex) {
        if (visibleInReviewMode("legacy", reviewDisplayMode)) {
          out.push({ id: ann.id, ann, geom: ann.geometry, className: ann.class_name, source: "legacy" });
        }
      } else if (isVideoTrack(ann) && !hiddenTrackIds.has(ann.geometry.track_id)) {
        const resolved = resolveTrackAtFrame(ann.geometry, frameIndex);
        if (resolved && visibleInReviewMode(resolved.source, reviewDisplayMode)) {
          out.push({
            id: ann.id,
            ann,
            geom: resolved.geom,
            className: ann.class_name,
            source: resolved.source,
            occluded: resolved.occluded,
            trackId: ann.geometry.track_id,
          });
        }
      }
    }
    return out;
  }, [annotations, frameIndex, hiddenTrackIds, reviewDisplayMode]);

  const selectedTrackGhost = useMemo<VideoTrackGhost | null>(() => {
    if (!selectedTrack || hiddenTrackIds.has(selectedTrack.geometry.track_id)) return null;
    if (!visibleInReviewMode("manual", reviewDisplayMode)) return null;
    if (currentFrameEntries.some((entry) => entry.ann.id === selectedTrack.id)) return null;
    const nearest = nearestTrackKeyframe(selectedTrack.geometry, frameIndex);
    if (!nearest) return null;
    return {
      id: `ghost-${selectedTrack.id}`,
      ann: selectedTrack,
      geom: nearest.bbox,
      className: selectedTrack.class_name,
      source: "manual",
      trackId: selectedTrack.geometry.track_id,
      originFrame: nearest.frame_index,
    };
  }, [currentFrameEntries, frameIndex, hiddenTrackIds, reviewDisplayMode, selectedTrack]);

  const trackPreviews = useMemo<VideoTrackPreview[]>(
    () => videoTracks
      .filter((ann) => !hiddenTrackIds.has(ann.geometry.track_id))
      .map((ann) => ({
        id: ann.id,
        trackId: ann.geometry.track_id,
        className: ann.class_name,
        keyframes: ann.geometry.keyframes,
        outside: ann.geometry.outside,
        selected: ann.id === selectedId,
      })),
    [hiddenTrackIds, selectedId, videoTracks],
  );

  const annotatedFrames = useMemo(() => {
    const out = new Set<number>();
    for (const ann of annotations) {
      if (isVideoBbox(ann)) out.add(ann.geometry.frame_index);
      if (isVideoTrack(ann)) {
        for (const kf of ann.geometry.keyframes) out.add(kf.frame_index);
      }
    }
    return out;
  }, [annotations]);
  const timelineMarkers = useMemo(() => videoTimelineMarkers(videoTracks.map((ann) => ann.geometry)), [videoTracks]);
  const selectedTrackTimeline = useMemo(
    () => selectedTrack ? buildSelectedTrackTimeline(selectedTrack.geometry) : null,
    [selectedTrack],
  );
  const globalTimelineDensity = useMemo(
    () => selectedTrack ? [] : buildGlobalTimelineDensity(videoTracks.map((ann) => ann.geometry), maxFrame),
    [maxFrame, selectedTrack, videoTracks],
  );
  const {
    preview: framePreview,
    previewFor: previewFrame,
    prefetch: prefetchFrames,
    diagnostics: framePreviewDiagnostics,
  } = useVideoFramePreview({
    taskId: manifest?.task_id,
    maxFrame,
    enabled: Boolean(manifest),
    width: 320,
    format: "webp",
  });
  const {
    activeBitmap,
    cachedRanges,
    capture: captureBitmapFrame,
    showFrame: showCachedBitmapFrame,
    diagnostics: bitmapCacheDiagnostics,
  } = useVideoBitmapCache({
    taskId: manifest?.task_id,
  });
  const showCachedBitmap = Boolean(activeBitmap && !isPlaybackActive);

  const pendingDraft = useMemo(() => {
    if (
      !pendingDrawing ||
      (pendingDrawing.kind !== "video_bbox" && pendingDrawing.kind !== "video_track") ||
      pendingDrawing.frameIndex !== frameIndex
    ) {
      return null;
    }
    return { geom: pendingDrawing.geom, className: activeClass || "未分类" };
  }, [activeClass, frameIndex, pendingDrawing]);

  const qualityWarnings = useMemo(() => {
    const warnings: string[] = [];
    const maxGap = Math.max(30, Math.round(fps * 2));
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

  const stageMode = modeFromDrag(drag);
  const stageModeGuard = getVideoStageModeGuard(stageMode);
  const handleFrameClockChange = useCallback((nextFrame: number) => {
    if (!stageModeGuard.canSetupFrame) {
      videoRef.current?.pause();
      setJogPlayback(PAUSED_JOG_PLAYBACK);
      return;
    }
    if (isPlaybackActive && loopRegion && nextFrame > loopRegion.endFrame) {
      setFrameIndex(loopRegion.startFrame);
      const video = videoRef.current;
      if (video) video.currentTime = frameToTime(loopRegion.startFrame, timebase);
      return;
    }
    setFrameIndex(nextFrame);
  }, [isPlaybackActive, loopRegion, setFrameIndex, stageModeGuard.canSetupFrame, timebase]);

  const frameClock = useFrameClock({
    videoRef,
    frameIndex,
    timebase,
    isPlaying,
    onFrameChange: handleFrameClockChange,
  });

  const fitViewport = useCallback(() => {
    fit(viewportSize.w, viewportSize.h, videoPixelWidth, videoPixelHeight);
  }, [fit, videoPixelHeight, videoPixelWidth, viewportSize.h, viewportSize.w]);

  const setActualSize = useCallback(() => {
    if (!viewportSize.w || !viewportSize.h) {
      setVp({ scale: 1, tx: 0, ty: 0 });
      return;
    }
    setVp({
      scale: 1,
      tx: (viewportSize.w - videoPixelWidth) / 2,
      ty: (viewportSize.h - videoPixelHeight) / 2,
    });
  }, [setVp, videoPixelHeight, videoPixelWidth, viewportSize.h, viewportSize.w]);

  const pausePlayback = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.playbackRate = 1;
    }
    setIsPlaying(false);
    setJogPlayback(PAUSED_JOG_PLAYBACK);
  }, []);

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
    [captureBitmapFrame, frameClock, maxFrame, showCachedBitmapFrame, stageModeGuard.canSetupFrame],
  );
  const seekFrameAsyncRef = useRef(seekFrameAsync);

  useEffect(() => {
    seekFrameAsyncRef.current = seekFrameAsync;
  }, [seekFrameAsync]);

  const showPlaybackOverlay = useCallback(() => {
    if (overlayHideTimerRef.current) clearTimeout(overlayHideTimerRef.current);
    setPlaybackOverlayVisible(true);
  }, []);

  const schedulePlaybackOverlayHide = useCallback(() => {
    if (overlayHideTimerRef.current) clearTimeout(overlayHideTimerRef.current);
    overlayHideTimerRef.current = setTimeout(() => setPlaybackOverlayVisible(false), 2000);
  }, []);

  const flashPlaybackAction = useCallback((action: "prev" | "next" | "play") => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightAction(action);
    highlightTimerRef.current = setTimeout(() => setHighlightAction(null), 180);
  }, []);

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
    setJogPlayback(PAUSED_JOG_PLAYBACK);
    video.playbackRate = 1;
    setIsPlaying(true);
    const playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      void playResult.catch((err: unknown) => {
        setIsPlaying(false);
        setPlaybackError(err instanceof Error ? err.message : "视频无法播放");
      });
    }
  }, [flashPlaybackAction, frameIndex, isPlaybackActive, loopRegion, pausePlayback, seekFrameAsync, showPlaybackOverlay]);

  const jogPlaybackBy = useCallback((dir: -1 | 1) => {
    showPlaybackOverlay();
    flashPlaybackAction(dir < 0 ? "prev" : "next");
    setPlaybackError(null);
    const current = jogPlaybackRef.current;
    const next = current.direction === 0
      ? { direction: dir, rate: 1 as VideoPlaybackRate }
      : current.direction === dir
        ? { direction: dir, rate: nextHigherPlaybackRate(current.rate) }
        : (() => {
          const lower = nextLowerPlaybackRate(current.rate);
          return lower ? { ...current, rate: lower } : PAUSED_JOG_PLAYBACK;
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
      pausePlayback();
      void seekFrameAsync(frameIndex + delta, { recordHistory: options?.recordHistory ?? true });
    },
    [flashPlaybackAction, frameIndex, pausePlayback, seekFrameAsync, showPlaybackOverlay],
  );

  const seekToKeyframe = useCallback(
    (dir: -1 | 1, options?: { recordHistory?: boolean }) => {
      if (!selectedTrack) return;
      const nextFrame = nextVisibleKeyframeFrame(selectedTrack.geometry, frameIndex, dir);
      if (nextFrame === null) return;
      showPlaybackOverlay();
      flashPlaybackAction(dir < 0 ? "prev" : "next");
      pausePlayback();
      void seekFrameAsync(nextFrame, { recordHistory: options?.recordHistory ?? true });
    },
    [flashPlaybackAction, frameIndex, pausePlayback, seekFrameAsync, selectedTrack, showPlaybackOverlay],
  );

  const seekToFrame = useCallback(
    (nextFrame: number, options?: { recordHistory?: boolean }) => {
      showPlaybackOverlay();
      pausePlayback();
      void seekFrameAsync(nextFrame, { recordHistory: options?.recordHistory ?? true });
    },
    [pausePlayback, seekFrameAsync, showPlaybackOverlay],
  );

  const toggleBookmark = useCallback(() => {
    showPlaybackOverlay();
    setBookmarks((current) => toggleVideoBookmark(current, frameIndex));
  }, [frameIndex, showPlaybackOverlay]);

  const jumpHistoryBy = useCallback((dir: -1 | 1) => {
    const result = jumpVideoHistory(jumpHistory, dir);
    setJumpHistory(result.history);
    if (result.frameIndex === null) return;
    showPlaybackOverlay();
    pausePlayback();
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
        setJogPlayback(PAUSED_JOG_PLAYBACK);
        setPlaybackError(err instanceof Error ? err.message : "视频无法播放");
      });
    }
  }, [jogPlayback.direction, jogPlayback.rate, loopRegion]);

  useEffect(() => {
    if (jogPlayback.direction !== -1) return;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.playbackRate = 1;
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
          setJogPlayback(PAUSED_JOG_PLAYBACK);
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
  }, [fps, jogPlayback.direction, jogPlayback.rate, loopRegion]);

  useImperativeHandle(
    ref,
    () => ({
      togglePlayback,
      jogPlayback: jogPlaybackBy,
      pausePlayback,
      seekByFrames,
      seekToKeyframe,
      seekToFrame,
      toggleBookmark,
      jumpHistory: jumpHistoryBy,
      clearLoopRegion,
    }),
    [clearLoopRegion, jogPlaybackBy, jumpHistoryBy, pausePlayback, seekByFrames, seekToFrame, seekToKeyframe, toggleBookmark, togglePlayback],
  );

  useEffect(() => {
    const taskId = manifest?.task_id ?? null;
    if (!taskId || lastResetTaskIdRef.current === taskId) return;
    lastResetTaskIdRef.current = taskId;
    setFrameIndex(0);
    setIsPlaying(false);
    setJogPlayback(PAUSED_JOG_PLAYBACK);
    setPlaybackError(null);
    setDrag(null);
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
    onSelectRef.current(null);
  }, [manifest?.task_id, maxFrame, setFrameIndex]);

  useEffect(() => {
    const taskId = manifest?.task_id ?? null;
    if (!taskId || fittedTaskIdRef.current === taskId) return;
    if (!viewportSize.w || !viewportSize.h || !videoPixelWidth || !videoPixelHeight) return;
    fittedTaskIdRef.current = taskId;
    fitViewport();
  }, [fitViewport, manifest?.task_id, videoPixelHeight, videoPixelWidth, viewportSize.h, viewportSize.w]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, vpRef.current.scale * factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [vpRef, zoomAt]);

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
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [fitViewport, setActualSize]);

  useEffect(() => {
    if (!selectedTrack) return;
    prefetchFrames(sortedKeyframes(selectedTrack.geometry).map((keyframe) => keyframe.frame_index));
  }, [prefetchFrames, selectedTrack]);

  useEffect(() => {
    prefetchFrames(bookmarks.map((bookmark) => bookmark.frameIndex));
  }, [bookmarks, prefetchFrames]);

  useEffect(() => {
    if (!loopRegion) return;
    prefetchFrames([loopRegion.startFrame, loopRegion.endFrame]);
  }, [loopRegion, prefetchFrames]);

  useEffect(() => {
    const taskId = manifest?.task_id;
    if (!taskId) return;
    try {
      const key = videoNavigationStorageKey(taskId, "loop");
      if (loopRegion) sessionStorage.setItem(key, JSON.stringify(loopRegion));
      else sessionStorage.removeItem(key);
    } catch {
      // sessionStorage may be unavailable in private contexts.
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

  useEffect(() => {
    return () => {
      if (overlayHideTimerRef.current) clearTimeout(overlayHideTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setJogPlayback(PAUSED_JOG_PLAYBACK);
    };
    const onError = () => {
      setIsPlaying(false);
      setJogPlayback(PAUSED_JOG_PLAYBACK);
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
  }, [captureBitmapFrame, isPlaybackActive]);

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
  }, [captureBitmapFrame, frameClock.isSeeking, frameIndex, isPlaybackActive]);

  useEffect(() => {
    const diagnosticsTarget = window as unknown as {
      __videoFrameClockDiagnostics?: Record<string, unknown>;
      __videoWorkbenchDiagnostics?: {
        activeTaskId?: string;
        byTask?: Record<string, Record<string, unknown>>;
      };
    };
    const taskId = manifest?.task_id ?? "unknown";
    const timelineMode = selectedTrack ? "selected-track" : "global-density";
    const playbackRateLabel = isJogPlaying ? `${jogPlayback.direction < 0 ? "-" : ""}${jogPlayback.rate}x` : "paused";
    const snapshot = {
      taskId,
      updatedAt: new Date().toISOString(),
      route: `${window.location.pathname}${window.location.search}`,
      frameIndex,
      maxFrame,
      fps,
      isPlaying,
      isSeeking: frameClock.isSeeking,
      playbackRate: playbackRateLabel,
      timelineMode,
      selectedTrackId: selectedTrack?.geometry.track_id ?? null,
      visibleObjects: currentFrameEntries.length,
      totalTracks: videoTracks.length,
      bookmarks: bookmarks.length,
      loopRegion,
      frameClock: frameClock.diagnostics,
      framePreview: framePreviewDiagnostics,
      bitmapCache: bitmapCacheDiagnostics,
      viewport: {
        scale: vp.scale,
        tx: vp.tx,
        ty: vp.ty,
        size: viewportSize,
        minimapVisible: minimapVisibleRef.current,
      },
    };
    diagnosticsTarget.__videoFrameClockDiagnostics = {
      ...(diagnosticsTarget.__videoFrameClockDiagnostics ?? {}),
      [taskId]: frameClock.diagnostics,
    };
    diagnosticsTarget.__videoWorkbenchDiagnostics = {
      activeTaskId: taskId,
      byTask: {
        ...(diagnosticsTarget.__videoWorkbenchDiagnostics?.byTask ?? {}),
        [taskId]: snapshot,
      },
    };
  }, [
    bookmarks.length,
    currentFrameEntries.length,
    fps,
    frameClock.diagnostics,
    frameClock.isSeeking,
    frameIndex,
    framePreviewDiagnostics,
    bitmapCacheDiagnostics,
    isJogPlaying,
    isPlaying,
    jogPlayback.direction,
    jogPlayback.rate,
    loopRegion,
    manifest?.task_id,
    maxFrame,
    selectedTrack,
    videoTracks.length,
    viewportSize,
    vp.scale,
    vp.tx,
    vp.ty,
  ]);

  const pointFromEvent = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    const svg = overlayRef.current;
    if (!svg) return null;
    const viewBoxHeight = Number.isFinite(videoAspectRatio) && videoAspectRatio > 0 ? 1 / videoAspectRatio : 9 / 16;
    return clientPointToVideoPoint(svg, { x: evt.clientX, y: evt.clientY }, viewBoxHeight);
  }, [videoAspectRatio]);

  const updateCursor = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    const pt = pointFromEvent(evt);
    onCursorMove?.(pt);
  }, [onCursorMove, pointFromEvent]);

  const selectedTrackLocked = selectedTrack ? lockedTrackIds.has(selectedTrack.geometry.track_id) : false;

  const beginPan = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    pausePlayback();
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "pan", sx: evt.clientX, sy: evt.clientY });
  }, [pausePlayback]);

  const beginDraw = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    if (!stageModeGuard.canBeginDraw || readOnly || isPlaybackActive || (videoTool === "track" && selectedTrackLocked)) return;
    const pt = pointFromEvent(evt);
    if (!pt) return;
    if (videoTool !== "track" || !selectedTrack) onSelect(null);
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "draw", start: pt, current: pt });
  }, [isPlaybackActive, onSelect, pointFromEvent, readOnly, selectedTrack, selectedTrackLocked, stageModeGuard.canBeginDraw, videoTool]);

  const beginMove = useCallback((evt: ReactPointerEvent<SVGElement>, entry: VideoFrameEntry | VideoTrackGhost) => {
    const trackId = isVideoTrack(entry.ann) ? entry.ann.geometry.track_id : null;
    evt.stopPropagation();
    const toggle = evt.shiftKey || evt.metaKey || evt.ctrlKey;
    if (toggle) onSelect(entry.ann.id, { shift: true });
    else onSelect(entry.ann.id);
    if (toggle) return;
    if (!stageModeGuard.canBeginDrag || readOnly || isPlaybackActive || (trackId && lockedTrackIds.has(trackId))) return;
    const pt = pointFromEvent(evt as unknown as ReactPointerEvent<SVGSVGElement>);
    if (!pt) return;
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "move", id: entry.ann.id, start: pt, origin: entry.geom, current: entry.geom });
  }, [isPlaybackActive, lockedTrackIds, onSelect, pointFromEvent, readOnly, stageModeGuard.canBeginDrag]);

  const beginResize = useCallback((
    dir: VideoResizeDirection,
    evt: ReactPointerEvent<SVGElement>,
    entry: VideoFrameEntry | VideoTrackGhost,
  ) => {
    const trackId = isVideoTrack(entry.ann) ? entry.ann.geometry.track_id : null;
    evt.stopPropagation();
    onSelect(entry.ann.id);
    if (!stageModeGuard.canBeginResize || readOnly || isPlaybackActive || (trackId && lockedTrackIds.has(trackId))) return;
    const pt = pointFromEvent(evt as unknown as ReactPointerEvent<SVGSVGElement>);
    if (!pt) return;
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "resize", id: entry.ann.id, dir, start: pt, origin: entry.geom, current: entry.geom });
  }, [isPlaybackActive, lockedTrackIds, onSelect, pointFromEvent, readOnly, stageModeGuard.canBeginResize]);

  const onPointerMove = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    updateCursor(evt);
    if (!drag) return;
    if (drag.kind === "pan") {
      const dx = evt.clientX - drag.sx;
      const dy = evt.clientY - drag.sy;
      setVp((cur) => ({ ...cur, tx: cur.tx + dx, ty: cur.ty + dy }));
      setDrag({ kind: "pan", sx: evt.clientX, sy: evt.clientY });
      return;
    }
    const pt = pointFromEvent(evt);
    if (!pt) return;
    if (drag.kind === "draw") {
      setDrag({ ...drag, current: pt });
      return;
    }
    const next = drag.kind === "resize"
      ? applyResize(drag.origin, drag.start, pt, drag.dir, {
        shiftKey: evt.shiftKey,
        altKey: evt.altKey,
      })
      : clampGeom({
        ...drag.origin,
        x: drag.origin.x + (pt.x - drag.start.x),
        y: drag.origin.y + (pt.y - drag.start.y),
      });
    setDrag({ ...drag, current: next });
  }, [drag, pointFromEvent, setVp, updateCursor]);

  const finishDrag = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    const cur = drag;
    setDrag(null);
    showPlaybackOverlay();
    schedulePlaybackOverlayHide();
    if (cur?.kind === "pan") return;
    const pt = pointFromEvent(evt);
    if (!pt || !cur) return;
    if (cur.kind === "draw") {
      const geom = normalizeGeom(cur.start, pt);
      if (geom.w < 0.003 || geom.h < 0.003) {
        return;
      }
      if (videoTool === "track" && selectedTrack && !lockedTrackIds.has(selectedTrack.geometry.track_id)) {
        onUpdate(selectedTrack, upsertKeyframe(selectedTrack.geometry, frameIndex, geom));
      } else {
        const rect = overlayRef.current?.getBoundingClientRect();
        const anchor = rect
          ? { left: rect.left + geom.x * rect.width, top: rect.top + (geom.y + geom.h) * rect.height + 6 }
          : { left: 0, top: 0 };
        const kind = videoTool === "track" ? "video_track" : "video_bbox";
        if (onPendingDraw) onPendingDraw(kind, frameIndex, geom, anchor);
        else onCreate(frameIndex, geom);
      }
      return;
    }
    const ann = annotations.find((a) => a.id === cur.id);
    if (!ann) return;
    if (cur.kind === "resize" && (cur.current.w < 0.003 || cur.current.h < 0.003)) return;
    if (isVideoTrack(ann)) {
      onUpdate(ann, upsertKeyframe(ann.geometry, frameIndex, cur.current));
    } else if (isVideoBbox(ann)) {
      onUpdate(ann, { type: "video_bbox", frame_index: ann.geometry.frame_index, ...cur.current });
    }
  }, [
    annotations,
    drag,
    frameIndex,
    lockedTrackIds,
    onCreate,
    onPendingDraw,
    onUpdate,
    pointFromEvent,
    schedulePlaybackOverlayHide,
    selectedTrack,
    showPlaybackOverlay,
    videoTool,
  ]);

  const onOverlayPointerLeave = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    onCursorMove?.(null);
    if (drag) finishDrag(evt);
  }, [drag, finishDrag, onCursorMove]);

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--color-fg-muted)" }}>
        <Icon name="loader2" className="spin" /> 加载视频信息...
      </div>
    );
  }
  if (error || !manifest) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--color-danger)", gap: 8 }}>
        <Icon name="warning" size={28} />
        视频 manifest 不可用
      </div>
    );
  }

  const draft = drag?.kind === "draw" ? normalizeGeom(drag.start, drag.current) : null;
  const videoMinimapVisible = viewportSize.w > 0 && viewportSize.h > 0
    ? viewportSize.w / (videoPixelWidth * vp.scale) < 0.85 || viewportSize.h / (videoPixelHeight * vp.scale) < 0.85
    : false;
  minimapVisibleRef.current = videoMinimapVisible;

  return (
    <div
      ref={containerRef}
      data-testid="video-stage"
      onContextMenu={(evt) => evt.preventDefault()}
      onMouseEnter={showPlaybackOverlay}
      onMouseMove={() => {
        if (!drag) showPlaybackOverlay();
      }}
      onMouseLeave={schedulePlaybackOverlayHide}
      style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: "#050507" }}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <VideoStageSurface width={videoPixelWidth} height={videoPixelHeight} viewport={vp}>
            <VideoMediaLayer
              ref={videoRef}
              src={manifest.video_url}
              poster={manifest.poster_url ?? undefined}
              onClick={togglePlayback}
            />
            <VideoFrameOverlay
              overlayRef={overlayRef}
              cachedBitmap={activeBitmap}
              showCachedBitmap={showCachedBitmap}
              entries={currentFrameEntries}
              trackPreviews={trackPreviews}
              pendingDraft={pendingDraft}
              aspectRatio={videoAspectRatio}
              selectedId={selectedId}
              selectedTrackGhost={selectedTrackGhost}
              draft={draft}
              drag={drag}
              activeClass={activeClass}
              selectedTrackClassName={selectedTrack?.class_name}
              readOnly={readOnly}
              isPlaying={isPlaybackActive}
              videoTool={videoTool}
              selectedTrackLocked={selectedTrackLocked}
              onBeginPan={beginPan}
              onBeginDraw={beginDraw}
              onBeginMove={beginMove}
              onBeginResize={beginResize}
              onPointerMove={onPointerMove}
              onFinishDrag={finishDrag}
              onCancelDrag={() => setDrag(null)}
              onPointerLeave={onOverlayPointerLeave}
            />
          </VideoStageSurface>
          {isPlaybackActive && (
            <div
              style={{
                position: "absolute",
                top: 14,
                left: "50%",
                transform: "translateX(-50%)",
                padding: "5px 10px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.62)",
                color: "white",
                fontSize: 12,
              }}
            >
              {jogPlayback.direction < 0 ? `反向 ${jogPlayback.rate}x · 暂停后编辑` : "播放中 · 暂停后编辑"}
            </div>
          )}
          {playbackError && (
            <div
              data-testid="video-playback-error"
              style={{
                position: "absolute",
                top: 14,
                left: "50%",
                transform: "translateX(-50%)",
                maxWidth: "min(520px, calc(100% - 28px))",
                padding: "6px 10px",
                borderRadius: 6,
                background: "rgba(127,29,29,0.88)",
                color: "white",
                fontSize: 12,
                lineHeight: 1.4,
                textAlign: "center",
              }}
            >
              视频无法播放：{playbackError}
            </div>
          )}
          <VideoSelectionActions
            selectedAnnotation={selectedAnnotation}
            frameIndex={frameIndex}
            readOnly={readOnly}
            onChangeUserBoxClass={onChangeUserBoxClass}
            onDelete={onDelete}
            onConvertToBboxes={onConvertToBboxes}
          />
          <VideoQcWarnings warnings={qualityWarnings} />
          <VideoPlaybackOverlay
            frameIndex={frameIndex}
            maxFrame={maxFrame}
            timebase={timebase}
            isPlaying={isPlaybackActive}
            playbackRateLabel={isJogPlaying ? `${jogPlayback.direction < 0 ? "-" : ""}${jogPlayback.rate}x` : undefined}
            annotatedFrames={[...annotatedFrames].sort((a, b) => a - b)}
            timelineMarkers={timelineMarkers}
            selectedTrackTimeline={selectedTrackTimeline}
            globalTimelineDensity={globalTimelineDensity}
            loopRegion={loopRegion}
            bookmarks={bookmarks}
            hoverPreview={framePreview}
            currentFrameEntryCount={currentFrameEntries.length}
            visible={playbackOverlayVisible && !drag}
            interactive
            highlightAction={highlightAction}
            onSeek={(frame) => {
              showPlaybackOverlay();
              pausePlayback();
              void seekFrameAsync(frame, { recordHistory: true });
            }}
            onSeekByFrames={seekByFrames}
            onTogglePlay={togglePlayback}
            onLoopRegionChange={setNormalizedLoopRegion}
            onClearLoopRegion={clearLoopRegion}
            onSeekBookmark={(targetFrame) => seekToFrame(targetFrame, { recordHistory: true })}
            onHoverFrameChange={previewFrame}
          />
      </div>
      <FloatingDock
        scale={vp.scale}
        canUndo={false}
        canRedo={false}
        onUndo={() => {}}
        onRedo={() => {}}
        onZoomIn={() => setVp((cur) => ({ ...cur, scale: Math.min(8, cur.scale * 1.2) }))}
        onZoomOut={() => setVp((cur) => ({ ...cur, scale: Math.max(0.2, cur.scale / 1.2) }))}
        onFit={fitViewport}
        showHistory={false}
      />
      {viewportSize.w > 0 && viewportSize.h > 0 && (
        <Minimap
          imgW={videoPixelWidth}
          imgH={videoPixelHeight}
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
