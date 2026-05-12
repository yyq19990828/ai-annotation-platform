import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { frameToTime, type FrameTimebase } from "./frameTimebase";
import type { VideoTimelineMarker } from "./videoFrameBuckets";

type HighlightAction = "prev" | "next" | "play" | null;

interface VideoPlaybackOverlayProps {
  frameIndex: number;
  maxFrame: number;
  timebase: FrameTimebase;
  isPlaying: boolean;
  annotatedFrames: number[];
  timelineMarkers?: VideoTimelineMarker[];
  currentFrameEntryCount: number;
  visible: boolean;
  interactive?: boolean;
  highlightAction?: HighlightAction;
  onSeek: (frameIndex: number) => void;
  onSeekByFrames: (delta: number) => void;
  onTogglePlay: () => void;
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
  currentFrameEntryCount,
  visible,
  interactive = true,
  highlightAction = null,
  onSeek,
  onSeekByFrames,
  onTogglePlay,
}: VideoPlaybackOverlayProps) {
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const frameTooltip = useMemo(() => {
    if (hoverFrame === null) return null;
    return `F ${hoverFrame} · ${formatTime(frameToTime(hoverFrame, timebase))}`;
  }, [hoverFrame, timebase]);

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

      <div style={{ position: "relative", height: 28, display: "flex", alignItems: "center", pointerEvents: visible && interactive ? "auto" : "none" }}>
        <input
          aria-label="视频帧时间轴"
          type="range"
          min={0}
          max={maxFrame}
          value={frameIndex}
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
            setHoverFrame(Math.max(0, Math.min(maxFrame, Math.round(ratio * maxFrame))));
          }}
          onPointerLeave={() => setHoverFrame(null)}
          style={{ width: "100%", accentColor: "var(--color-accent)" }}
        />
        <div style={{ position: "absolute", inset: "0 6px", pointerEvents: "none" }}>
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

      <div className="mono" style={{ display: "flex", gap: 10, fontSize: 12, color: "rgba(255,255,255,0.82)", whiteSpace: "nowrap" }}>
        <span>F {frameIndex} / {maxFrame}</span>
        <span>{formatTime(frameToTime(frameIndex, timebase))}</span>
        <span>{currentFrameEntryCount} 框</span>
      </div>
    </div>
  );
}
