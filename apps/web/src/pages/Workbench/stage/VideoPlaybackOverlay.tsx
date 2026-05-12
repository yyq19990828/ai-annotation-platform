import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { frameToTime, type FrameTimebase } from "./frameTimebase";
import type { VideoBookmark, VideoLoopRegion } from "./videoNavigationState";
import type { VideoTimelineMarker } from "./videoFrameBuckets";
import type { VideoTimelineDensityBin, VideoTrackTimeline } from "./videoTrackTimeline";

type HighlightAction = "prev" | "next" | "play" | null;

interface VideoPlaybackOverlayProps {
  frameIndex: number;
  maxFrame: number;
  timebase: FrameTimebase;
  isPlaying: boolean;
  annotatedFrames: number[];
  timelineMarkers?: VideoTimelineMarker[];
  selectedTrackTimeline?: VideoTrackTimeline | null;
  globalTimelineDensity?: VideoTimelineDensityBin[];
  loopRegion?: VideoLoopRegion | null;
  bookmarks?: VideoBookmark[];
  currentFrameEntryCount: number;
  visible: boolean;
  interactive?: boolean;
  highlightAction?: HighlightAction;
  onSeek: (frameIndex: number) => void;
  onSeekByFrames: (delta: number) => void;
  onTogglePlay: () => void;
  onLoopRegionChange?: (region: VideoLoopRegion) => void;
  onClearLoopRegion?: () => void;
  onSeekBookmark?: (frameIndex: number) => void;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.000";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

export function VideoPlaybackOverlay({
  frameIndex,
  maxFrame,
  timebase,
  isPlaying,
  annotatedFrames,
  timelineMarkers = [],
  selectedTrackTimeline = null,
  globalTimelineDensity = [],
  loopRegion = null,
  bookmarks = [],
  currentFrameEntryCount,
  visible,
  interactive = true,
  highlightAction = null,
  onSeek,
  onSeekByFrames,
  onTogglePlay,
  onLoopRegionChange,
  onClearLoopRegion,
  onSeekBookmark,
}: VideoPlaybackOverlayProps) {
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const [loopDraft, setLoopDraft] = useState<VideoLoopRegion | null>(null);
  const loopDraftRef = useRef<VideoLoopRegion | null>(null);
  const frameTooltip = useMemo(() => {
    if (hoverFrame === null) return null;
    return `F ${hoverFrame} · ${formatTime(frameToTime(hoverFrame, timebase))}`;
  }, [hoverFrame, timebase]);
  const maxDensity = useMemo(
    () => Math.max(1, ...globalTimelineDensity.map((bin) => bin.density)),
    [globalTimelineDensity],
  );
  const frameLeft = (frame: number) => `${maxFrame > 0 ? (frame / maxFrame) * 100 : 0}%`;
  const frameFromPointer = (clientX: number, rect: DOMRect) => {
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(maxFrame, Math.round(ratio * maxFrame)));
  };
  const normalizeLoop = (from: number, to: number): VideoLoopRegion => ({
    startFrame: Math.min(from, to),
    endFrame: Math.max(from, to),
  });
  const rangeStyle = (from: number, to: number) => {
    const left = maxFrame > 0 ? (from / maxFrame) * 100 : 0;
    const right = maxFrame > 0 ? (to / maxFrame) * 100 : 0;
    return { left: `${left}%`, width: `${Math.max(0.5, right - left)}%` };
  };

  const iconButtonStyle = (active: boolean): CSSProperties => ({
    color: "#fff",
    background: active ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
    borderColor: active ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.18)",
    pointerEvents: visible && interactive ? "auto" : "none",
  });

  return (
    <div
      data-testid="video-playback-overlay"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 12,
        transform: `translateX(-50%) translateY(${visible ? 0 : 8}px)`,
        opacity: visible ? 1 : 0,
        pointerEvents: "none",
        transition: "opacity 160ms ease, transform 160ms ease",
        width: "min(820px, calc(100% - 28px))",
        display: "grid",
        gridTemplateColumns: "auto minmax(180px, 1fr) auto",
        gap: 12,
        alignItems: "center",
        padding: "8px 14px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.14)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
        zIndex: 4,
      }}
    >
      <div style={{ display: "flex", gap: 6, pointerEvents: visible && interactive ? "auto" : "none" }}>
        <Button size="sm" title="上一帧" onClick={() => onSeekByFrames(-1)} style={iconButtonStyle(highlightAction === "prev")}>
          <Icon name="chevLeft" size={13} />
        </Button>
        <Button size="sm" title="播放 / 暂停 (Space)" onClick={onTogglePlay} style={iconButtonStyle(highlightAction === "play")}>
          <Icon name={isPlaying ? "pause" : "play"} size={13} />
        </Button>
        <Button size="sm" title="下一帧" onClick={() => onSeekByFrames(1)} style={iconButtonStyle(highlightAction === "next")}>
          <Icon name="chevRight" size={13} />
        </Button>
      </div>

      <div
        data-testid="video-timeline-shell"
        style={{ position: "relative", height: 28, display: "flex", alignItems: "center", pointerEvents: visible && interactive ? "auto" : "none" }}
        onPointerDownCapture={(e) => {
          if (!e.shiftKey || !onLoopRegionChange) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const frame = frameFromPointer(e.clientX, rect);
          const next = { startFrame: frame, endFrame: frame };
          loopDraftRef.current = next;
          setLoopDraft(next);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const draft = loopDraftRef.current;
          if (!draft) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const frame = frameFromPointer(e.clientX, rect);
          const next = normalizeLoop(draft.startFrame, frame);
          loopDraftRef.current = next;
          setLoopDraft(next);
        }}
        onPointerUp={(e) => {
          const draft = loopDraftRef.current;
          if (!draft || !onLoopRegionChange) return;
          e.preventDefault();
          onLoopRegionChange(draft);
          loopDraftRef.current = null;
          setLoopDraft(null);
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={(e) => {
          if (!loopDraftRef.current) return;
          loopDraftRef.current = null;
          setLoopDraft(null);
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
      >
        <input
          aria-label="视频帧时间轴"
          type="range"
          min={0}
          max={maxFrame}
          value={frameIndex}
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoverFrame(frameFromPointer(e.clientX, rect));
          }}
          onPointerLeave={() => setHoverFrame(null)}
          style={{ width: "100%", accentColor: "var(--color-accent)" }}
        />
        <div style={{ position: "absolute", inset: "0 6px", pointerEvents: "none" }}>
          {(loopRegion || loopDraft) && (
            <span
              data-testid={loopDraft ? "video-loop-region-preview" : "video-loop-region"}
              style={{
                position: "absolute",
                ...rangeStyle((loopDraft ?? loopRegion)!.startFrame, (loopDraft ?? loopRegion)!.endFrame),
                top: 0,
                height: 4,
                background: loopDraft ? "rgba(34,211,238,0.52)" : "rgba(34,211,238,0.72)",
                borderRadius: 999,
              }}
            />
          )}
          {bookmarks.map((bookmark) => (
            <button
              key={bookmark.id}
              type="button"
              data-testid="video-bookmark-marker"
              title={bookmark.label ?? `F ${bookmark.frameIndex}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSeekBookmark?.(bookmark.frameIndex);
              }}
              style={{
                position: "absolute",
                left: frameLeft(bookmark.frameIndex),
                top: -1,
                width: 0,
                height: 0,
                padding: 0,
                transform: "translateX(-50%)",
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "8px solid rgba(34,211,238,0.92)",
                background: "transparent",
                pointerEvents: visible && interactive ? "auto" : "none",
                cursor: "pointer",
              }}
            />
          ))}
          {!selectedTrackTimeline && globalTimelineDensity.length > 0 && (
            <div data-testid="video-timeline-density" style={{ position: "absolute", inset: "15px 0 2px 0" }}>
              {globalTimelineDensity.map((bin) => {
                if (bin.density <= 0) return null;
                const left = maxFrame > 0 ? (bin.from / maxFrame) * 100 : 0;
                const width = maxFrame > 0 ? ((bin.to - bin.from + 1) / (maxFrame + 1)) * 100 : 100;
                return (
                  <span
                    key={bin.index}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      bottom: 0,
                      width: `${Math.max(0.7, width)}%`,
                      height: `${Math.max(3, (bin.density / maxDensity) * 10)}px`,
                      background: "rgba(45,212,191,0.58)",
                      borderRadius: 2,
                    }}
                  />
                );
              })}
            </div>
          )}
          {selectedTrackTimeline && (
            <div data-testid="video-track-timeline" style={{ position: "absolute", inset: 0 }}>
              {selectedTrackTimeline.interpolated.map((segment) => (
                <span
                  key={`interpolated-${segment.from}-${segment.to}`}
                  data-testid="video-timeline-interpolated"
                  style={{
                    position: "absolute",
                    ...rangeStyle(segment.from, segment.to),
                    top: 12,
                    borderTop: `2px dashed ${segment.hasPrediction ? "rgba(251,191,36,0.78)" : "rgba(255,255,255,0.42)"}`,
                  }}
                />
              ))}
              {selectedTrackTimeline.outside.map((segment) => (
                <span
                  key={`track-outside-${segment.from}-${segment.to}`}
                  data-testid="video-timeline-outside"
                  style={{
                    position: "absolute",
                    ...rangeStyle(segment.from, segment.to),
                    top: 16,
                    height: 7,
                    background: segment.source === "prediction" ? "rgba(148,163,184,0.5)" : "rgba(148,163,184,0.38)",
                    borderRadius: 999,
                  }}
                />
              ))}
              {selectedTrackTimeline.keyframes.map((keyframe) => (
                <span
                  key={`track-keyframe-${keyframe.frame}`}
                  data-testid="video-timeline-track-keyframe"
                  style={{
                    position: "absolute",
                    left: frameLeft(keyframe.frame),
                    top: keyframe.occluded ? 4 : 5,
                    width: keyframe.source === "prediction" ? 8 : 7,
                    height: keyframe.source === "prediction" ? 8 : 7,
                    transform: "translateX(-50%)",
                    borderRadius: 999,
                    background: keyframe.source === "prediction" ? "oklch(0.78 0.14 78)" : "var(--color-accent)",
                    border: keyframe.occluded ? "1px dashed rgba(255,255,255,0.9)" : "1px solid rgba(255,255,255,0.8)",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
                  }}
                />
              ))}
            </div>
          )}
          {annotatedFrames.map((f) => (
            <span
              key={f}
              style={{
                position: "absolute",
                left: `${maxFrame > 0 ? (f / maxFrame) * 100 : 0}%`,
                top: 3,
                width: 2,
                height: 8,
                background: "rgba(255,255,255,0.45)",
                borderRadius: 1,
              }}
            />
          ))}
          {timelineMarkers.map((marker) => {
            if (marker.type === "outside") {
              const left = maxFrame > 0 ? (marker.from / maxFrame) * 100 : 0;
              const right = maxFrame > 0 ? (marker.to / maxFrame) * 100 : 0;
              return (
                <span
                  key={`outside-${marker.from}-${marker.to}-${marker.trackIds.join("-")}`}
                  data-testid="video-timeline-outside"
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    top: 12,
                    width: `${Math.max(0.5, right - left)}%`,
                    height: 7,
                    background: marker.hasPrediction ? "rgba(148,163,184,0.48)" : "rgba(148,163,184,0.36)",
                    borderRadius: 999,
                  }}
                />
              );
            }
            return (
              <span
                key={`keyframe-${marker.frame}-${marker.trackIds.join("-")}`}
                data-testid="video-timeline-keyframe"
                style={{
                  position: "absolute",
                  left: `${maxFrame > 0 ? (marker.frame / maxFrame) * 100 : 0}%`,
                  top: 2,
                  width: marker.density > 1 ? 3 : 2,
                  height: marker.hasAbsent ? 12 : 9,
                  background: marker.hasPrediction ? "oklch(0.78 0.14 78)" : "var(--color-accent)",
                  opacity: marker.hasAbsent ? 0.75 : 1,
                  borderRadius: 1,
                }}
              />
            );
          })}
        </div>
        {frameTooltip && (
          <div
            data-testid="video-frame-tooltip"
            style={{
              position: "absolute",
              left: `${maxFrame > 0 ? ((hoverFrame ?? 0) / maxFrame) * 100 : 0}%`,
              bottom: 30,
              transform: "translateX(-50%)",
              padding: "3px 6px",
              borderRadius: 5,
              background: "rgba(0,0,0,0.78)",
              color: "#fff",
              fontSize: 11,
              whiteSpace: "nowrap",
            }}
          >
            {frameTooltip}
          </div>
        )}
      </div>

      <div className="mono" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "rgba(255,255,255,0.82)", whiteSpace: "nowrap" }}>
        <span>F {frameIndex} / {maxFrame}</span>
        <span>{formatTime(frameToTime(frameIndex, timebase))}</span>
        {loopRegion && (
          <>
            <span data-testid="video-loop-region-label">Loop {loopRegion.startFrame}-{loopRegion.endFrame}</span>
            <button
              type="button"
              title="清除播放范围 (Alt+L)"
              onClick={onClearLoopRegion}
              style={{
                color: "rgba(255,255,255,0.86)",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: 5,
                padding: "1px 5px",
                pointerEvents: visible && interactive ? "auto" : "none",
                cursor: "pointer",
              }}
            >
              清除
            </button>
          </>
        )}
        <span>{currentFrameEntryCount} 框</span>
      </div>
    </div>
  );
}
