import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor } from "./colors";
import type {
  VideoDragState,
  VideoFrameEntry,
  VideoStageGeom,
  VideoTrackGhost,
} from "./videoStageTypes";

interface VideoFrameOverlayProps {
  overlayRef: RefObject<SVGSVGElement>;
  entries: VideoFrameEntry[];
  selectedId: string | null;
  selectedTrackGhost: VideoTrackGhost | null;
  draft: VideoStageGeom | null;
  drag: VideoDragState;
  activeClass: string;
  selectedTrackClassName?: string;
  readOnly: boolean;
  isPlaying: boolean;
  videoTool: VideoTool;
  selectedTrackLocked: boolean;
  onBeginDraw: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onBeginMove: (evt: ReactPointerEvent<SVGRectElement>, entry: VideoFrameEntry | VideoTrackGhost) => void;
  onPointerMove: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onFinishDrag: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onCancelDrag: () => void;
  onPointerLeave: (evt: ReactPointerEvent<SVGSVGElement>) => void;
}

export function VideoFrameOverlay({
  overlayRef,
  entries,
  selectedId,
  selectedTrackGhost,
  draft,
  drag,
  activeClass,
  selectedTrackClassName,
  readOnly,
  isPlaying,
  videoTool,
  selectedTrackLocked,
  onBeginDraw,
  onBeginMove,
  onPointerMove,
  onFinishDrag,
  onCancelDrag,
  onPointerLeave,
}: VideoFrameOverlayProps) {
  return (
    <svg
      ref={overlayRef}
      data-testid="video-overlay"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onPointerDown={onBeginDraw}
      onPointerMove={onPointerMove}
      onPointerUp={onFinishDrag}
      onPointerCancel={onCancelDrag}
      onPointerLeave={onPointerLeave}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        cursor: readOnly || isPlaying || (videoTool === "track" && selectedTrackLocked)
          ? "default"
          : videoTool === "track"
            ? "copy"
            : "crosshair",
        pointerEvents: "auto",
      }}
    >
      {entries.map((entry) => {
        const g = drag?.kind === "move" && drag.id === entry.ann.id ? drag.current : entry.geom;
        const color = classColor(entry.className);
        const selected = entry.ann.id === selectedId;
        const labelSuffix = entry.source === "interpolated"
          ? " · 插值"
          : entry.source === "legacy"
            ? " · 旧框"
            : entry.occluded
              ? " · 遮挡"
              : "";
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
              onPointerDown={(evt) => onBeginMove(evt, entry)}
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
            onPointerDown={(evt) => onBeginMove(evt, selectedTrackGhost)}
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
          stroke={classColor(selectedTrackClassName ?? activeClass)}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="6 4"
        />
      )}
    </svg>
  );
}
