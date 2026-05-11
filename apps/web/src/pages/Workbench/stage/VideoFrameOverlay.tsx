import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor } from "./colors";
import type {
  VideoDragState,
  VideoFrameEntry,
  VideoStageGeom,
  VideoTrackGhost,
  VideoTrackPreview,
} from "./videoStageTypes";

interface VideoFrameOverlayProps {
  overlayRef: RefObject<SVGSVGElement>;
  entries: VideoFrameEntry[];
  trackPreviews: VideoTrackPreview[];
  aspectRatio: number;
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
  trackPreviews,
  aspectRatio,
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
  const viewBoxHeight = Number.isFinite(aspectRatio) && aspectRatio > 0 ? 1 / aspectRatio : 9 / 16;
  const y = (value: number) => value * viewBoxHeight;
  const h = (value: number) => value * viewBoxHeight;
  const labelY = (geom: VideoStageGeom) => Number(Math.max(0.028, y(geom.y) - 0.006).toFixed(4));

  return (
    <svg
      ref={overlayRef}
      data-testid="video-overlay"
      viewBox={`0 0 1 ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
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
      {trackPreviews.map((preview) => {
        const color = classColor(preview.className);
        const points = [...preview.keyframes]
          .filter((kf) => !kf.absent)
          .sort((a, b) => a.frame_index - b.frame_index)
          .map((kf) => ({
            frame: kf.frame_index,
            x: kf.bbox.x + kf.bbox.w / 2,
            y: y(kf.bbox.y + kf.bbox.h / 2),
            occluded: Boolean(kf.occluded),
          }));
        if (points.length === 0) return null;
        const pointAttr = points.map((p) => `${p.x},${p.y}`).join(" ");
        return (
          <g
            key={preview.id}
            data-testid="video-track-path-preview"
            opacity={preview.selected ? 0.82 : 0.42}
            style={{ pointerEvents: "none" }}
          >
            {points.length > 1 && (
              <polyline
                points={pointAttr}
                fill="none"
                stroke={color}
                strokeWidth={preview.selected ? 2.5 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={preview.selected ? undefined : "4 4"}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {points.map((p) => (
              <circle
                key={`${preview.id}-${p.frame}`}
                cx={p.x}
                cy={p.y}
                r={p.occluded ? 0.008 : 0.006}
                fill={p.occluded ? "var(--color-bg-elev)" : color}
                stroke={color}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
      {entries.map((entry) => {
        const g = drag?.kind === "move" && drag.id === entry.ann.id ? drag.current : entry.geom;
        const color = classColor(entry.className);
        const selected = entry.ann.id === selectedId;
        const labelSuffix = entry.source === "interpolated"
          ? " · 插值"
          : entry.occluded
            ? " · 遮挡"
            : "";
        return (
          <g key={`${entry.id}-${entry.trackId ?? "legacy"}`}>
            <rect
              x={g.x}
              y={y(g.y)}
              width={g.w}
              height={h(g.h)}
              fill={selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)"}
              stroke={color}
              strokeWidth={selected ? 3 : 2}
              strokeDasharray={entry.source === "interpolated" || entry.occluded ? "6 4" : undefined}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(evt) => onBeginMove(evt, entry)}
            />
            <text
              x={g.x}
              y={labelY(g)}
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
            y={y(selectedTrackGhost.geom.y)}
            width={selectedTrackGhost.geom.w}
            height={h(selectedTrackGhost.geom.h)}
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
            y={labelY(selectedTrackGhost.geom)}
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
          y={y(draft.y)}
          width={draft.w}
          height={h(draft.h)}
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
