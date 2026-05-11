import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type {
  AnnotationResponse,
  TaskVideoManifestResponse,
  VideoBboxGeometry,
  VideoTrackGeometry,
  VideoTrackKeyframe,
} from "@/types";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor } from "./colors";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";

type Geom = { x: number; y: number; w: number; h: number };
type VideoGeometry = VideoBboxGeometry | VideoTrackGeometry;
type FrameEntry = {
  id: string;
  ann: AnnotationResponse;
  geom: Geom;
  className: string;
  source: "manual" | "prediction" | "interpolated" | "legacy";
  occluded?: boolean;
  trackId?: string;
};
type DragState =
  | { kind: "draw"; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: "move"; id: string; start: { x: number; y: number }; origin: Geom; current: Geom }
  | null;

interface VideoStageProps {
  manifest: TaskVideoManifestResponse | undefined;
  isLoading?: boolean;
  error?: unknown;
  annotations: AnnotationResponse[];
  selectedId: string | null;
  activeClass: string;
  readOnly?: boolean;
  videoTool?: VideoTool;
  onSelect: (id: string | null) => void;
  onCreate: (frameIndex: number, geom: Geom) => void;
  onPendingDraw?: (
    kind: "video_bbox" | "video_track",
    frameIndex: number,
    geom: Geom,
    anchor: { left: number; top: number },
  ) => void;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoGeometry) => void;
  onRename: (annotation: AnnotationResponse, className: string) => void;
  onDelete?: (annotation: AnnotationResponse) => void;
  onConvertToBboxes?: (
    annotation: AnnotationResponse,
    options: {
      operation: "copy" | "split";
      scope: "frame" | "track";
      frameIndex?: number;
      frameMode?: "keyframes" | "all_frames";
    },
  ) => void;
  onCursorMove?: (pt: { x: number; y: number } | null) => void;
}

export interface VideoStageControls {
  togglePlayback: () => void;
  seekByFrames: (delta: number) => void;
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampGeom(g: Geom): Geom {
  const w = clamp01(g.w);
  const h = clamp01(g.h);
  return {
    x: Math.max(0, Math.min(1 - w, clamp01(g.x))),
    y: Math.max(0, Math.min(1 - h, clamp01(g.y))),
    w,
    h,
  };
}

function normalizeGeom(a: { x: number; y: number }, b: { x: number; y: number }): Geom {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

function isVideoBbox(ann: AnnotationResponse): ann is AnnotationResponse & { geometry: VideoBboxGeometry } {
  return ann.geometry.type === "video_bbox";
}

function isVideoTrack(ann: AnnotationResponse): ann is AnnotationResponse & { geometry: VideoTrackGeometry } {
  return ann.geometry.type === "video_track";
}

function sortedKeyframes(track: VideoTrackGeometry) {
  return [...track.keyframes].sort((a, b) => a.frame_index - b.frame_index);
}

function upsertKeyframe(track: VideoTrackGeometry, frameIndex: number, bbox: Geom, patch?: Partial<VideoTrackKeyframe>): VideoTrackGeometry {
  const next = sortedKeyframes(track).filter((kf) => kf.frame_index !== frameIndex);
  next.push({
    frame_index: frameIndex,
    bbox: clampGeom(bbox),
    source: "manual",
    absent: false,
    occluded: false,
    ...patch,
  });
  return { ...track, keyframes: next.sort((a, b) => a.frame_index - b.frame_index) };
}

function frameHasAbsentBetween(keyframes: VideoTrackKeyframe[], from: number, to: number) {
  return keyframes.some((kf) => kf.absent && kf.frame_index > from && kf.frame_index < to);
}

function interpolate(a: VideoTrackKeyframe, b: VideoTrackKeyframe, frameIndex: number): Geom {
  const span = Math.max(1, b.frame_index - a.frame_index);
  const t = (frameIndex - a.frame_index) / span;
  return {
    x: a.bbox.x + (b.bbox.x - a.bbox.x) * t,
    y: a.bbox.y + (b.bbox.y - a.bbox.y) * t,
    w: a.bbox.w + (b.bbox.w - a.bbox.w) * t,
    h: a.bbox.h + (b.bbox.h - a.bbox.h) * t,
  };
}

function resolveTrackAtFrame(track: VideoTrackGeometry, frameIndex: number): { geom: Geom; source: FrameEntry["source"]; occluded?: boolean } | null {
  const keyframes = sortedKeyframes(track);
  const exact = keyframes.find((kf) => kf.frame_index === frameIndex);
  if (exact) {
    if (exact.absent) return null;
    return { geom: exact.bbox, source: exact.source === "prediction" ? "prediction" : "manual", occluded: exact.occluded };
  }

  const before = [...keyframes].reverse().find((kf) => kf.frame_index < frameIndex && !kf.absent);
  const after = keyframes.find((kf) => kf.frame_index > frameIndex && !kf.absent);
  if (!before || !after) return null;
  if (frameHasAbsentBetween(keyframes, before.frame_index, after.frame_index)) return null;
  return { geom: interpolate(before, after, frameIndex), source: "interpolated" };
}

function nearestTrackBbox(track: VideoTrackGeometry, frameIndex: number): Geom {
  const current = resolveTrackAtFrame(track, frameIndex);
  if (current) return current.geom;
  return nearestTrackKeyframe(track, frameIndex)?.bbox ?? { x: 0, y: 0, w: 0.1, h: 0.1 };
}

function nearestTrackKeyframe(track: VideoTrackGeometry, frameIndex: number): VideoTrackKeyframe | null {
  const keyframes = sortedKeyframes(track).filter((kf) => !kf.absent);
  const nearest = keyframes.reduce<VideoTrackKeyframe | null>((best, kf) => {
    if (!best) return kf;
    return Math.abs(kf.frame_index - frameIndex) < Math.abs(best.frame_index - frameIndex) ? kf : best;
  }, null);
  return nearest;
}

function shapeIou(a: Geom, b: Geom) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function shortTrackId(trackId: string) {
  return trackId.length > 8 ? trackId.slice(0, 8) : trackId;
}

export const VideoStage = forwardRef<VideoStageControls, VideoStageProps>(function VideoStage({
  manifest,
  isLoading = false,
  error,
  annotations,
  selectedId,
  activeClass,
  readOnly = false,
  videoTool = "box",
  onSelect,
  onCreate,
  onPendingDraw,
  onUpdate,
  onRename,
  onDelete,
  onConvertToBboxes,
  onCursorMove,
}: VideoStageProps, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<string>>(() => new Set());
  const [lockedTrackIds, setLockedTrackIds] = useState<Set<string>>(() => new Set());
  const [playbackOverlayVisible, setPlaybackOverlayVisible] = useState(true);
  const [highlightAction, setHighlightAction] = useState<"prev" | "next" | "play" | null>(null);
  const onSelectRef = useRef(onSelect);
  const lastResetTaskIdRef = useRef<string | null>(null);
  const overlayHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const fps = manifest?.metadata.fps && manifest.metadata.fps > 0 ? manifest.metadata.fps : 30;
  const frameCount = Math.max(
    1,
    manifest?.metadata.frame_count ??
      Math.ceil(((manifest?.metadata.duration_ms ?? 0) / 1000) * fps) ??
      1,
  );
  const maxFrame = Math.max(0, frameCount - 1);
  const stageAspect = manifest?.metadata.width && manifest.metadata.height
    ? `${manifest.metadata.width} / ${manifest.metadata.height}`
    : "16 / 9";

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
    const out: FrameEntry[] = [];
    for (const ann of annotations) {
      if (isVideoBbox(ann) && ann.geometry.frame_index === frameIndex) {
        out.push({ id: ann.id, ann, geom: ann.geometry, className: ann.class_name, source: "legacy" });
      } else if (isVideoTrack(ann) && !hiddenTrackIds.has(ann.geometry.track_id)) {
        const resolved = resolveTrackAtFrame(ann.geometry, frameIndex);
        if (resolved) {
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
  }, [annotations, frameIndex, hiddenTrackIds]);

  const selectedTrackGhost = useMemo(() => {
    if (!selectedTrack || hiddenTrackIds.has(selectedTrack.geometry.track_id)) return null;
    if (currentFrameEntries.some((entry) => entry.ann.id === selectedTrack.id)) return null;
    const exact = selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex);
    if (exact?.absent) return null;
    const nearest = nearestTrackKeyframe(selectedTrack.geometry, frameIndex);
    if (!nearest) return null;
    return {
      id: `ghost-${selectedTrack.id}`,
      ann: selectedTrack,
      geom: nearest.bbox,
      className: selectedTrack.class_name,
      source: "manual" as const,
      trackId: selectedTrack.geometry.track_id,
      originFrame: nearest.frame_index,
    };
  }, [currentFrameEntries, frameIndex, hiddenTrackIds, selectedTrack]);

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

  const seekFrame = useCallback(
    (nextFrame: number) => {
      const frame = Math.max(0, Math.min(maxFrame, Math.round(nextFrame)));
      setFrameIndex(frame);
      const video = videoRef.current;
      if (video) video.currentTime = frame / fps;
    },
    [fps, maxFrame],
  );

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
    if (!video.paused || isPlaying) {
      video.pause();
      setIsPlaying(false);
      return;
    }
    setPlaybackError(null);
    setIsPlaying(true);
    const playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      void playResult.catch((err: unknown) => {
        setIsPlaying(false);
        setPlaybackError(err instanceof Error ? err.message : "视频无法播放");
      });
    }
  }, [flashPlaybackAction, isPlaying, showPlaybackOverlay]);

  const seekByFrames = useCallback(
    (delta: number) => {
      showPlaybackOverlay();
      flashPlaybackAction(delta < 0 ? "prev" : "next");
      videoRef.current?.pause();
      seekFrame(frameIndex + delta);
    },
    [flashPlaybackAction, frameIndex, seekFrame, showPlaybackOverlay],
  );

  useImperativeHandle(
    ref,
    () => ({
      togglePlayback,
      seekByFrames,
    }),
    [seekByFrames, togglePlayback],
  );

  useEffect(() => {
    const taskId = manifest?.task_id ?? null;
    if (!taskId || lastResetTaskIdRef.current === taskId) return;
    lastResetTaskIdRef.current = taskId;
    setFrameIndex(0);
    setIsPlaying(false);
    setPlaybackError(null);
    setDrag(null);
    setHiddenTrackIds(new Set());
    setLockedTrackIds(new Set());
    setPlaybackOverlayVisible(true);
    onSelectRef.current(null);
  }, [manifest?.task_id]);

  useEffect(() => {
    return () => {
      if (overlayHideTimerRef.current) clearTimeout(overlayHideTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setFrameIndex(Math.max(0, Math.min(maxFrame, Math.round(video.currentTime * fps))));
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      setIsPlaying(false);
      setPlaybackError(video.error?.message || "当前浏览器无法播放该视频源");
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
    };
  }, [fps, maxFrame]);

  useEffect(() => {
    if (!isPlaying) return;
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : window.clearTimeout;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) setFrameIndex(Math.max(0, Math.min(maxFrame, Math.round(video.currentTime * fps))));
      raf = schedule(tick);
    };
    raf = schedule(tick);
    return () => cancel(raf);
  }, [fps, isPlaying, maxFrame]);

  const pointFromEvent = useCallback((evt: React.PointerEvent<SVGSVGElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp01((evt.clientX - rect.left) / rect.width),
      y: clamp01((evt.clientY - rect.top) / rect.height),
    };
  }, []);

  const updateCursor = useCallback((evt: React.PointerEvent<SVGSVGElement>) => {
    const pt = pointFromEvent(evt);
    onCursorMove?.(pt);
  }, [onCursorMove, pointFromEvent]);

  const selectedTrackLocked = selectedTrack ? lockedTrackIds.has(selectedTrack.geometry.track_id) : false;

  const beginDraw = useCallback((evt: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly || isPlaying || (videoTool === "track" && selectedTrackLocked)) return;
    const pt = pointFromEvent(evt);
    if (!pt) return;
    if (videoTool !== "track" || !selectedTrack) onSelect(null);
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "draw", start: pt, current: pt });
  }, [isPlaying, onSelect, pointFromEvent, readOnly, selectedTrack, selectedTrackLocked, videoTool]);

  const beginMove = useCallback((evt: React.PointerEvent<SVGRectElement>, entry: FrameEntry) => {
    const trackId = isVideoTrack(entry.ann) ? entry.ann.geometry.track_id : null;
    evt.stopPropagation();
    onSelect(entry.ann.id);
    if (readOnly || isPlaying || (trackId && lockedTrackIds.has(trackId))) return;
    const pt = pointFromEvent(evt as unknown as React.PointerEvent<SVGSVGElement>);
    if (!pt) return;
    (evt.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "move", id: entry.ann.id, start: pt, origin: entry.geom, current: entry.geom });
  }, [isPlaying, lockedTrackIds, onSelect, pointFromEvent, readOnly]);

  const onPointerMove = useCallback((evt: React.PointerEvent<SVGSVGElement>) => {
    updateCursor(evt);
    const pt = pointFromEvent(evt);
    if (!pt || !drag) return;
    if (drag.kind === "draw") {
      setDrag({ ...drag, current: pt });
      return;
    }
    const dx = pt.x - drag.start.x;
    const dy = pt.y - drag.start.y;
    const next = clampGeom({
      ...drag.origin,
      x: drag.origin.x + dx,
      y: drag.origin.y + dy,
    });
    setDrag({ ...drag, current: next });
  }, [drag, pointFromEvent, updateCursor]);

  const finishDrag = useCallback((evt: React.PointerEvent<SVGSVGElement>) => {
    const pt = pointFromEvent(evt);
    const cur = drag;
    setDrag(null);
    showPlaybackOverlay();
    schedulePlaybackOverlayHide();
    if (!pt || !cur) return;
    if (cur.kind === "draw") {
      const geom = normalizeGeom(cur.start, pt);
      if (geom.w < 0.003 || geom.h < 0.003) {
        togglePlayback();
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
    if (isVideoTrack(ann)) {
      onUpdate(ann, upsertKeyframe(ann.geometry, frameIndex, cur.current));
    } else if (isVideoBbox(ann)) {
      onUpdate(ann, { type: "video_bbox", frame_index: ann.geometry.frame_index, ...cur.current });
    }
  }, [annotations, drag, frameIndex, lockedTrackIds, onCreate, onPendingDraw, onUpdate, pointFromEvent, schedulePlaybackOverlayHide, selectedTrack, showPlaybackOverlay, togglePlayback, videoTool]);

  const toggleTrackSet = useCallback((setter: React.Dispatch<React.SetStateAction<Set<string>>>, trackId: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const markSelectedTrack = useCallback((patch: Partial<VideoTrackKeyframe>) => {
    if (!selectedTrack || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    const bbox = nearestTrackBbox(selectedTrack.geometry, frameIndex);
    onUpdate(selectedTrack, upsertKeyframe(selectedTrack.geometry, frameIndex, bbox, patch));
  }, [frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack]);

  const copySelectedTrackToCurrentFrame = useCallback(() => {
    if (!selectedTrack || !selectedTrackGhost || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    onUpdate(selectedTrack, upsertKeyframe(selectedTrack.geometry, frameIndex, selectedTrackGhost.geom));
  }, [frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack, selectedTrackGhost]);

  const deleteTrackKeyframe = useCallback((ann: AnnotationResponse & { geometry: VideoTrackGeometry }, targetFrame: number) => {
    if (readOnly || lockedTrackIds.has(ann.geometry.track_id) || ann.geometry.keyframes.length <= 1) return;
    onUpdate(ann, {
      ...ann.geometry,
      keyframes: sortedKeyframes(ann.geometry).filter((kf) => kf.frame_index !== targetFrame),
    });
  }, [lockedTrackIds, onUpdate, readOnly]);

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

  return (
    <div
      data-testid="video-stage"
      onMouseEnter={showPlaybackOverlay}
      onMouseMove={() => {
        if (!drag) showPlaybackOverlay();
      }}
      onMouseLeave={schedulePlaybackOverlayHide}
      style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "1fr", background: "#050507" }}
    >
      <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px" }}>
        <div style={{ position: "relative", minHeight: 0, display: "grid", placeItems: "center", overflow: "hidden" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: "100%", maxHeight: "100%", aspectRatio: stageAspect }}>
            <video
              ref={videoRef}
              src={manifest.video_url}
              poster={manifest.poster_url ?? undefined}
              playsInline
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
              onClick={togglePlayback}
            />
            <svg
              ref={overlayRef}
              data-testid="video-overlay"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              onPointerDown={beginDraw}
              onPointerMove={onPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={() => setDrag(null)}
              onPointerLeave={(evt) => {
                onCursorMove?.(null);
                if (drag) finishDrag(evt);
              }}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                cursor: readOnly || isPlaying || (videoTool === "track" && selectedTrackLocked) ? "default" : videoTool === "track" ? "copy" : "crosshair",
                pointerEvents: "auto",
              }}
            >
              {currentFrameEntries.map((entry) => {
                const g: Geom = drag?.kind === "move" && drag.id === entry.ann.id ? drag.current : entry.geom;
                const color = classColor(entry.className);
                const selected = entry.ann.id === selectedId;
                const labelSuffix = entry.source === "interpolated" ? " · 插值" : entry.source === "legacy" ? " · 旧框" : entry.occluded ? " · 遮挡" : "";
                return (
                  <g key={`${entry.id}-${entry.trackId ?? "legacy"}`}>
                    <rect
                      x={g.x}
                      y={g.y}
                      width={g.w}
                      height={g.h}
                      fill={selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)"}
                      stroke={color}
                      strokeWidth={selected ? 3 : 2}
                      strokeDasharray={entry.source === "interpolated" || entry.occluded ? "6 4" : undefined}
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={(evt) => beginMove(evt, entry)}
                    />
                    <text
                      x={g.x}
                      y={Math.max(0.02, g.y - 0.008)}
                      fontSize="0.025"
                      fill={color}
                      stroke="rgba(0,0,0,0.75)"
                      strokeWidth="0.004"
                      paintOrder="stroke"
                    >
                      {entry.className}{labelSuffix}
                    </text>
                  </g>
                );
              })}
              {selectedTrackGhost && !drag && (
                <g data-testid="video-track-ghost">
                  <rect
                    x={selectedTrackGhost.geom.x}
                    y={selectedTrackGhost.geom.y}
                    width={selectedTrackGhost.geom.w}
                    height={selectedTrackGhost.geom.h}
                    fill="rgba(255,255,255,0.035)"
                    stroke={classColor(selectedTrackGhost.className)}
                    strokeWidth={2}
                    strokeDasharray="3 5"
                    opacity={0.72}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(evt) => beginMove(evt, selectedTrackGhost)}
                  />
                  <text
                    x={selectedTrackGhost.geom.x}
                    y={Math.max(0.02, selectedTrackGhost.geom.y - 0.008)}
                    fontSize="0.025"
                    fill={classColor(selectedTrackGhost.className)}
                    stroke="rgba(0,0,0,0.75)"
                    strokeWidth="0.004"
                    opacity={0.86}
                    paintOrder="stroke"
                  >
                    {selectedTrackGhost.className} · 参考 F{selectedTrackGhost.originFrame}
                  </text>
                </g>
              )}
              {draft && (
                <rect
                  x={draft.x}
                  y={draft.y}
                  width={draft.w}
                  height={draft.h}
                  fill="rgba(255,255,255,0.08)"
                  stroke={classColor(selectedTrack?.class_name ?? activeClass)}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="6 4"
                />
              )}
            </svg>
          </div>
          {isPlaying && (
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
              播放中 · 暂停后编辑
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
          {selectedAnnotation && !readOnly && (
            <div
              data-testid="video-selection-actions"
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                display: "flex",
                gap: 6,
                padding: 6,
                borderRadius: 8,
                background: "rgba(0,0,0,0.68)",
                boxShadow: "0 6px 18px rgba(0,0,0,0.24)",
              }}
            >
              <Button
                size="sm"
                title="修改类别"
                onClick={() => {
                  const next = window.prompt("类别", selectedAnnotation.class_name);
                  if (next && next.trim() && next.trim() !== selectedAnnotation.class_name) {
                    onRename(selectedAnnotation, next.trim());
                  }
                }}
              >
                <Icon name="tag" size={12} />
              </Button>
              {isVideoTrack(selectedAnnotation) && (
                <>
                  <Button
                    size="sm"
                    title="复制当前帧为独立框"
                    onClick={() => onConvertToBboxes?.(selectedAnnotation, {
                      operation: "copy",
                      scope: "frame",
                      frameIndex,
                    })}
                  >
                    复制框
                  </Button>
                  <Button
                    size="sm"
                    title="拆当前关键帧为独立框"
                    onClick={() => onConvertToBboxes?.(selectedAnnotation, {
                      operation: "split",
                      scope: "frame",
                      frameIndex,
                    })}
                  >
                    拆框
                  </Button>
                </>
              )}
              <Button size="sm" title="删除" onClick={() => onDelete?.(selectedAnnotation)}>
                <Icon name="trash" size={12} />
              </Button>
            </div>
          )}
          {qualityWarnings.length > 0 && (
            <div
              data-testid="video-qc-warnings"
              style={{
                position: "absolute",
                left: 14,
                bottom: 14,
                display: "grid",
                gap: 4,
                color: "var(--color-warning)",
                fontSize: 12,
              }}
            >
              {qualityWarnings.map((w) => (
                <div key={w} style={{ padding: "4px 8px", background: "rgba(0,0,0,0.68)", borderRadius: 6 }}>
                  {w}
                </div>
              ))}
            </div>
          )}
          <VideoPlaybackOverlay
            frameIndex={frameIndex}
            maxFrame={maxFrame}
            fps={fps}
            isPlaying={isPlaying}
            annotatedFrames={[...annotatedFrames].sort((a, b) => a - b)}
            currentFrameEntryCount={currentFrameEntries.length}
            visible={playbackOverlayVisible && !drag}
            highlightAction={highlightAction}
            onSeek={(frame) => {
              showPlaybackOverlay();
              videoRef.current?.pause();
              seekFrame(frame);
            }}
            onSeekByFrames={seekByFrames}
            onTogglePlay={togglePlayback}
          />
        </div>

        <aside style={{ minHeight: 0, overflow: "auto", borderLeft: "1px solid var(--color-border)", background: "var(--color-bg-elev)", padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>轨迹</b>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{videoTracks.length}</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {videoTracks.map((ann) => {
              const track = ann.geometry;
              const selected = ann.id === selectedId;
              const hidden = hiddenTrackIds.has(track.track_id);
              const locked = lockedTrackIds.has(track.track_id);
              const exact = track.keyframes.find((kf) => kf.frame_index === frameIndex);
              return (
                <div
                  key={ann.id}
                  data-testid="video-track-row"
                  onClick={() => onSelect(ann.id)}
                  style={{
                    display: "grid",
                    gap: 7,
                    padding: 8,
                    border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                    borderRadius: 8,
                    background: selected ? "color-mix(in oklab, var(--color-accent) 12%, var(--color-bg-elev))" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: classColor(ann.class_name) }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ann.class_name}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--color-fg-muted)" }}>{shortTrackId(track.track_id)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Button size="sm" title={hidden ? "显示轨迹" : "隐藏轨迹"} onClick={(e) => { e.stopPropagation(); toggleTrackSet(setHiddenTrackIds, track.track_id); }}>
                      <Icon name={hidden ? "eyeOff" : "eye"} size={12} />
                    </Button>
                    <Button size="sm" title={locked ? "解锁轨迹" : "锁定轨迹"} onClick={(e) => { e.stopPropagation(); toggleTrackSet(setLockedTrackIds, track.track_id); }}>
                      <Icon name={locked ? "lock" : "unlock"} size={12} />
                    </Button>
                    <Button
                      size="sm"
                      title="重命名轨迹类别"
                      disabled={readOnly}
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = window.prompt("轨迹类别", ann.class_name);
                        if (next && next.trim() && next.trim() !== ann.class_name) onRename(ann, next.trim());
                      }}
                    >
                      <Icon name="edit" size={12} />
                    </Button>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-fg-muted)" }}>
                      {exact?.absent ? "当前消失" : exact ? "关键帧" : "非关键帧"}
                    </span>
                  </div>
                </div>
              );
            })}
            {videoTracks.length === 0 && (
              <div style={{ color: "var(--color-fg-muted)", fontSize: 12, lineHeight: 1.6 }}>
                暂无轨迹。暂停后画框会创建第一条轨迹。
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            <b style={{ fontSize: 13 }}>当前轨迹</b>
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                size="sm"
                disabled={!selectedTrack || readOnly || selectedTrackLocked}
                onClick={() => markSelectedTrack({ absent: true, occluded: false })}
              >
                消失
              </Button>
              <Button
                size="sm"
                disabled={!selectedTrack || readOnly || selectedTrackLocked}
                onClick={() => markSelectedTrack({ absent: false, occluded: true })}
              >
                遮挡
              </Button>
              <Button
                size="sm"
                disabled={!selectedTrackGhost || readOnly || selectedTrackLocked}
                title="使用最近关键帧的框在当前帧创建关键帧"
                onClick={copySelectedTrackToCurrentFrame}
              >
                复制到当前帧
              </Button>
            </div>
            {selectedTrack && (
              <>
                <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)", lineHeight: 1.5 }}>
                  track_id: {selectedTrack.geometry.track_id}<br />
                  frame_index: {frameIndex}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <b style={{ fontSize: 12 }}>关键帧</b>
                    <div style={{ display: "flex", gap: 4 }}>
                      <Button
                        size="sm"
                        disabled={readOnly}
                        title="复制整条轨迹的关键帧为独立框"
                        onClick={() => onConvertToBboxes?.(selectedTrack, {
                          operation: "copy",
                          scope: "track",
                          frameMode: "keyframes",
                        })}
                      >
                        复制关键帧
                      </Button>
                      <Button
                        size="sm"
                        disabled={readOnly}
                        title="复制整条轨迹插值后的所有帧为独立框"
                        onClick={() => onConvertToBboxes?.(selectedTrack, {
                          operation: "copy",
                          scope: "track",
                          frameMode: "all_frames",
                        })}
                      >
                        复制全帧
                      </Button>
                    </div>
                  </div>
                  {sortedKeyframes(selectedTrack.geometry).map((kf) => (
                    <div
                      key={kf.frame_index}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 6,
                        alignItems: "center",
                        padding: "5px 6px",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                    >
                      <span>
                        F{kf.frame_index}
                        {kf.absent ? " · 消失" : kf.occluded ? " · 遮挡" : ""}
                      </span>
                      <span style={{ display: "flex", gap: 4 }}>
                        <Button
                          size="sm"
                          disabled={readOnly || Boolean(kf.absent)}
                          title="复制此关键帧为独立框"
                          onClick={() => onConvertToBboxes?.(selectedTrack, {
                            operation: "copy",
                            scope: "frame",
                            frameIndex: kf.frame_index,
                          })}
                        >
                          复制
                        </Button>
                        <Button
                          size="sm"
                          disabled={readOnly || Boolean(kf.absent)}
                          title="拆此关键帧为独立框"
                          onClick={() => onConvertToBboxes?.(selectedTrack, {
                            operation: "split",
                            scope: "frame",
                            frameIndex: kf.frame_index,
                          })}
                        >
                          拆
                        </Button>
                        <Button
                          size="sm"
                          disabled={readOnly || selectedTrack.geometry.keyframes.length <= 1}
                          title="删除关键帧"
                          onClick={() => deleteTrackKeyframe(selectedTrack, kf.frame_index)}
                        >
                          <Icon name="trash" size={11} />
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Button
                    size="sm"
                    disabled={readOnly}
                    title="拆整条轨迹关键帧为独立框并删除原轨迹"
                    onClick={() => onConvertToBboxes?.(selectedTrack, {
                      operation: "split",
                      scope: "track",
                      frameMode: "keyframes",
                    })}
                  >
                    拆关键帧
                  </Button>
                  <Button
                    size="sm"
                    disabled={readOnly}
                    title="拆整条轨迹所有插值帧为独立框并删除原轨迹"
                    onClick={() => onConvertToBboxes?.(selectedTrack, {
                      operation: "split",
                      scope: "track",
                      frameMode: "all_frames",
                    })}
                  >
                    拆全帧
                  </Button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

    </div>
  );
});
