import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse, TaskVideoFrameTimetableResponse, TaskVideoManifestResponse } from "@/types";
import type { PendingDrawing, VideoTool } from "../state/useWorkbenchState";
import { VideoFrameOverlay } from "./VideoFrameOverlay";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";
import { VideoQcWarnings } from "./VideoQcWarnings";
import { VideoSelectionActions } from "./VideoSelectionActions";
import { applyResize } from "./ResizeHandles";
import { buildFrameTimebase } from "./frameTimebase";
import { useFrameClock } from "./useFrameClock";
import {
  clamp01,
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

interface VideoStageProps {
  manifest: TaskVideoManifestResponse | undefined;
  frameTimetable?: TaskVideoFrameTimetableResponse;
  isLoading?: boolean;
  error?: unknown;
  annotations: AnnotationResponse[];
  selectedId: string | null;
  activeClass: string;
  frameIndex?: number;
  hiddenTrackIds?: Set<string>;
  lockedTrackIds?: Set<string>;
  readOnly?: boolean;
  videoTool?: VideoTool;
  pendingDrawing?: PendingDrawing;
  onSelect: (id: string | null) => void;
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
  seekByFrames: (delta: number) => void;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [uncontrolledFrameIndex, setUncontrolledFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [drag, setDrag] = useState<VideoDragState>(null);
  const [playbackOverlayVisible, setPlaybackOverlayVisible] = useState(true);
  const [highlightAction, setHighlightAction] = useState<"prev" | "next" | "play" | null>(null);
  const onSelectRef = useRef(onSelect);
  const lastResetTaskIdRef = useRef<string | null>(null);
  const overlayHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const frameIndex = controlledFrameIndex ?? uncontrolledFrameIndex;
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
    const out: VideoFrameEntry[] = [];
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

  const selectedTrackGhost = useMemo<VideoTrackGhost | null>(() => {
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
      source: "manual",
      trackId: selectedTrack.geometry.track_id,
      originFrame: nearest.frame_index,
    };
  }, [currentFrameEntries, frameIndex, hiddenTrackIds, selectedTrack]);

  const trackPreviews = useMemo<VideoTrackPreview[]>(
    () => videoTracks
      .filter((ann) => !hiddenTrackIds.has(ann.geometry.track_id))
      .map((ann) => ({
        id: ann.id,
        trackId: ann.geometry.track_id,
        className: ann.class_name,
        keyframes: ann.geometry.keyframes,
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

  const frameClock = useFrameClock({
    videoRef,
    frameIndex,
    timebase,
    isPlaying,
    onFrameChange: setFrameIndex,
  });

  const seekFrame = useCallback(
    (nextFrame: number) => {
      frameClock.seekTo(nextFrame);
    },
    [frameClock],
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
    setPlaybackOverlayVisible(true);
    onSelectRef.current(null);
  }, [manifest?.task_id, setFrameIndex]);

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
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      setIsPlaying(false);
      setPlaybackError(video.error?.message || "当前浏览器无法播放该视频源");
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const diagnosticsTarget = window as unknown as {
      __videoFrameClockDiagnostics?: Record<string, unknown>;
    };
    const taskId = manifest?.task_id ?? "unknown";
    diagnosticsTarget.__videoFrameClockDiagnostics = {
      ...(diagnosticsTarget.__videoFrameClockDiagnostics ?? {}),
      [taskId]: frameClock.diagnostics,
    };
  }, [frameClock.diagnostics, manifest?.task_id]);

  const pointFromEvent = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp01((evt.clientX - rect.left) / rect.width),
      y: clamp01((evt.clientY - rect.top) / rect.height),
    };
  }, []);

  const updateCursor = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    const pt = pointFromEvent(evt);
    onCursorMove?.(pt);
  }, [onCursorMove, pointFromEvent]);

  const selectedTrackLocked = selectedTrack ? lockedTrackIds.has(selectedTrack.geometry.track_id) : false;

  const beginDraw = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || isPlaying || (videoTool === "track" && selectedTrackLocked)) return;
    const pt = pointFromEvent(evt);
    if (!pt) return;
    if (videoTool !== "track" || !selectedTrack) onSelect(null);
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "draw", start: pt, current: pt });
  }, [isPlaying, onSelect, pointFromEvent, readOnly, selectedTrack, selectedTrackLocked, videoTool]);

  const beginMove = useCallback((evt: ReactPointerEvent<SVGRectElement>, entry: VideoFrameEntry | VideoTrackGhost) => {
    const trackId = isVideoTrack(entry.ann) ? entry.ann.geometry.track_id : null;
    evt.stopPropagation();
    onSelect(entry.ann.id);
    if (readOnly || isPlaying || (trackId && lockedTrackIds.has(trackId))) return;
    const pt = pointFromEvent(evt as unknown as ReactPointerEvent<SVGSVGElement>);
    if (!pt) return;
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "move", id: entry.ann.id, start: pt, origin: entry.geom, current: entry.geom });
  }, [isPlaying, lockedTrackIds, onSelect, pointFromEvent, readOnly]);

  const beginResize = useCallback((
    dir: VideoResizeDirection,
    evt: ReactPointerEvent<SVGRectElement>,
    entry: VideoFrameEntry | VideoTrackGhost,
  ) => {
    const trackId = isVideoTrack(entry.ann) ? entry.ann.geometry.track_id : null;
    evt.stopPropagation();
    onSelect(entry.ann.id);
    if (readOnly || isPlaying || (trackId && lockedTrackIds.has(trackId))) return;
    const pt = pointFromEvent(evt as unknown as ReactPointerEvent<SVGSVGElement>);
    if (!pt) return;
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setPlaybackOverlayVisible(false);
    setDrag({ kind: "resize", id: entry.ann.id, dir, start: pt, origin: entry.geom, current: entry.geom });
  }, [isPlaying, lockedTrackIds, onSelect, pointFromEvent, readOnly]);

  const onPointerMove = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    updateCursor(evt);
    const pt = pointFromEvent(evt);
    if (!pt || !drag) return;
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
  }, [drag, pointFromEvent, updateCursor]);

  const finishDrag = useCallback((evt: ReactPointerEvent<SVGSVGElement>) => {
    const pt = pointFromEvent(evt);
    const cur = drag;
    setDrag(null);
    showPlaybackOverlay();
    schedulePlaybackOverlayHide();
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
      <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}>
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
            <VideoFrameOverlay
              overlayRef={overlayRef}
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
              isPlaying={isPlaying}
              videoTool={videoTool}
              selectedTrackLocked={selectedTrackLocked}
              onBeginDraw={beginDraw}
              onBeginMove={beginMove}
              onBeginResize={beginResize}
              onPointerMove={onPointerMove}
              onFinishDrag={finishDrag}
              onCancelDrag={() => setDrag(null)}
              onPointerLeave={onOverlayPointerLeave}
            />
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
            isPlaying={isPlaying}
            annotatedFrames={[...annotatedFrames].sort((a, b) => a - b)}
            currentFrameEntryCount={currentFrameEntries.length}
            visible={playbackOverlayVisible && !drag}
            interactive
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

      </div>
    </div>
  );
});
