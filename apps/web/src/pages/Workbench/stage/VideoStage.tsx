import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse, TaskVideoManifestResponse, VideoBboxGeometry } from "@/types";
import { classColor } from "./colors";

type Geom = { x: number; y: number; w: number; h: number };
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
  onSelect: (id: string | null) => void;
  onCreate: (frameIndex: number, geom: Geom) => void;
  onUpdate: (annotation: AnnotationResponse, geom: Geom) => void;
  onDelete: (id: string) => void;
  onCursorMove?: (pt: { x: number; y: number } | null) => void;
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normalizeGeom(a: { x: number; y: number }, b: { x: number; y: number }): Geom {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.000";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function isVideoBbox(ann: AnnotationResponse): ann is AnnotationResponse & { geometry: VideoBboxGeometry } {
  return ann.geometry.type === "video_bbox";
}

export function VideoStage({
  manifest,
  isLoading = false,
  error,
  annotations,
  selectedId,
  activeClass,
  readOnly = false,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onCursorMove,
}: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);

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

  const currentFrameAnnotations = useMemo(
    () => annotations.filter((a) => isVideoBbox(a) && a.geometry.frame_index === frameIndex),
    [annotations, frameIndex],
  );
  const annotatedFrames = useMemo(() => {
    const out = new Set<number>();
    for (const ann of annotations) {
      if (isVideoBbox(ann)) out.add(ann.geometry.frame_index);
    }
    return out;
  }, [annotations]);

  const seekFrame = useCallback(
    (nextFrame: number) => {
      const frame = Math.max(0, Math.min(maxFrame, Math.round(nextFrame)));
      setFrameIndex(frame);
      const video = videoRef.current;
      if (video) video.currentTime = frame / fps;
    },
    [fps, maxFrame],
  );

  useEffect(() => {
    setFrameIndex(0);
    setIsPlaying(false);
    setDrag(null);
    onSelect(null);
  }, [manifest?.task_id, onSelect]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setFrameIndex(Math.max(0, Math.min(maxFrame, Math.round(video.currentTime * fps))));
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [fps, maxFrame]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (!manifest) return;
      if (e.key === " ") {
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        videoRef.current?.pause();
        seekFrame(frameIndex + (e.shiftKey ? 10 : 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        videoRef.current?.pause();
        seekFrame(frameIndex - (e.shiftKey ? 10 : 1));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !readOnly) {
        e.preventDefault();
        onDelete(selectedId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [frameIndex, manifest, onDelete, readOnly, seekFrame, selectedId]);

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

  const beginDraw = useCallback((evt: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly || isPlaying) return;
    const pt = pointFromEvent(evt);
    if (!pt) return;
    onSelect(null);
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    setDrag({ kind: "draw", start: pt, current: pt });
  }, [isPlaying, onSelect, pointFromEvent, readOnly]);

  const beginMove = useCallback((evt: React.PointerEvent<SVGRectElement>, ann: AnnotationResponse & { geometry: VideoBboxGeometry }) => {
    if (readOnly || isPlaying) return;
    const pt = pointFromEvent(evt as unknown as React.PointerEvent<SVGSVGElement>);
    if (!pt) return;
    evt.stopPropagation();
    onSelect(ann.id);
    (evt.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture?.(evt.pointerId);
    setDrag({ kind: "move", id: ann.id, start: pt, origin: ann.geometry, current: ann.geometry });
  }, [isPlaying, onSelect, pointFromEvent, readOnly]);

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
    const next = {
      ...drag.origin,
      x: Math.max(0, Math.min(1 - drag.origin.w, drag.origin.x + dx)),
      y: Math.max(0, Math.min(1 - drag.origin.h, drag.origin.y + dy)),
    };
    setDrag({ ...drag, current: next });
  }, [drag, pointFromEvent, updateCursor]);

  const finishDrag = useCallback((evt: React.PointerEvent<SVGSVGElement>) => {
    const pt = pointFromEvent(evt);
    const cur = drag;
    setDrag(null);
    if (!pt || !cur) return;
    if (cur.kind === "draw") {
      const geom = normalizeGeom(cur.start, pt);
      if (geom.w >= 0.003 && geom.h >= 0.003) onCreate(frameIndex, geom);
      return;
    }
    const ann = annotations.find((a) => a.id === cur.id);
    if (ann) {
      onUpdate(ann, cur.current);
    }
  }, [annotations, drag, frameIndex, onCreate, onUpdate, pointFromEvent]);

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
    <div data-testid="video-stage" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "1fr auto", background: "#050507" }}>
      <div style={{ position: "relative", minHeight: 0, display: "grid", placeItems: "center", overflow: "hidden" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: "100%", maxHeight: "100%", aspectRatio: stageAspect }}>
          <video
            ref={videoRef}
            src={manifest.video_url}
            poster={manifest.poster_url ?? undefined}
            playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play();
              else video.pause();
            }}
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
              cursor: readOnly || isPlaying ? "default" : "crosshair",
              pointerEvents: readOnly && !selectedId ? "none" : "auto",
            }}
          >
          {currentFrameAnnotations.map((ann) => {
            const videoAnn = ann as AnnotationResponse & { geometry: VideoBboxGeometry };
            const g: Geom = drag?.kind === "move" && drag.id === videoAnn.id ? drag.current : videoAnn.geometry;
            const color = classColor(videoAnn.class_name);
            const selected = videoAnn.id === selectedId;
            return (
              <g key={videoAnn.id}>
                <rect
                  x={g.x}
                  y={g.y}
                  width={g.w}
                  height={g.h}
                  fill="transparent"
                  stroke={color}
                  strokeWidth={selected ? 0.004 : 0.002}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(evt) => beginMove(evt, videoAnn)}
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
                  {videoAnn.class_name}
                </text>
              </g>
            );
          })}
          {draft && (
            <rect
              x={draft.x}
              y={draft.y}
              width={draft.w}
              height={draft.h}
              fill="rgba(255,255,255,0.08)"
              stroke={classColor(activeClass)}
              strokeWidth={0.002}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="0.01 0.008"
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
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: "10px 14px", background: "var(--color-bg-elev)", borderTop: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={() => seekFrame(frameIndex - 1)} title="上一帧">
            <Icon name="chevLeft" size={13} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play();
              else video.pause();
            }}
            title="播放 / 暂停 (Space)"
          >
            <Icon name={isPlaying ? "pause" : "play"} size={13} />
          </Button>
          <Button size="sm" onClick={() => seekFrame(frameIndex + 1)} title="下一帧">
            <Icon name="chevRight" size={13} />
          </Button>
        </div>
        <div style={{ position: "relative", height: 28, display: "flex", alignItems: "center" }}>
          <input
            aria-label="视频帧时间轴"
            type="range"
            min={0}
            max={maxFrame}
            value={frameIndex}
            onChange={(e) => {
              videoRef.current?.pause();
              seekFrame(Number(e.currentTarget.value));
            }}
            style={{ width: "100%" }}
          />
          <div style={{ position: "absolute", inset: "0 6px", pointerEvents: "none" }}>
            {[...annotatedFrames].map((f) => (
              <span
                key={f}
                style={{
                  position: "absolute",
                  left: `${maxFrame > 0 ? (f / maxFrame) * 100 : 0}%`,
                  top: 3,
                  width: 2,
                  height: 8,
                  background: "var(--color-accent)",
                  borderRadius: 1,
                }}
              />
            ))}
          </div>
        </div>
        <div className="mono" style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>
          <span>F {frameIndex} / {maxFrame}</span>
          <span>{formatTime(frameIndex / fps)}</span>
          <span>{currentFrameAnnotations.length} 框</span>
        </div>
      </div>
    </div>
  );
}
