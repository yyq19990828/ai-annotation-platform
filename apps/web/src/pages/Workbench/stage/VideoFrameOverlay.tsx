import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor } from "./colors";
import {
  BOX_LABEL_FONT_PX,
  BOX_LABEL_PAD_PX,
  VIDEO_HANDLE_HIT_SIZE,
  VIDEO_HANDLE_SIZE,
  VIDEO_LABEL_HEIGHT,
  VIDEO_LABEL_OFFSET,
  VIDEO_LABEL_WIDTH,
} from "./boxVisual";
import type {
  VideoDragState,
  VideoFrameEntry,
  VideoResizeDirection,
  VideoStageGeom,
  VideoTrackGhost,
  VideoTrackPreview,
} from "./videoStageTypes";

const HANDLE_DIRECTIONS: { dir: VideoResizeDirection; cx: number; cy: number; cursor: string }[] = [
  { dir: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { dir: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { dir: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { dir: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
  { dir: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { dir: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { dir: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { dir: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
];

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
  onBeginResize: (
    dir: VideoResizeDirection,
    evt: ReactPointerEvent<SVGRectElement>,
    entry: VideoFrameEntry | VideoTrackGhost,
  ) => void;
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
  onBeginResize,
  onPointerMove,
  onFinishDrag,
  onCancelDrag,
  onPointerLeave,
}: VideoFrameOverlayProps) {
  const viewBoxHeight = Number.isFinite(aspectRatio) && aspectRatio > 0 ? 1 / aspectRatio : 9 / 16;
  const y = (value: number) => value * viewBoxHeight;
  const h = (value: number) => value * viewBoxHeight;
  const labelY = (geom: VideoStageGeom) => Number(Math.max(0, y(geom.y) - VIDEO_LABEL_OFFSET).toFixed(4));
  const renderLabel = (geom: VideoStageGeom, color: string, text: string, opacity = 1) => (
    <foreignObject
      x={geom.x}
      y={labelY(geom)}
      width={VIDEO_LABEL_WIDTH}
      height={VIDEO_LABEL_HEIGHT}
      style={{ overflow: "visible", pointerEvents: "none" }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          maxWidth: "100%",
          padding: `${BOX_LABEL_PAD_PX - 1}px ${BOX_LABEL_PAD_PX + 2}px`,
          borderRadius: 3,
          background: color,
          color: "white",
          fontSize: BOX_LABEL_FONT_PX,
          fontFamily: "var(--font-sans, sans-serif)",
          fontWeight: 500,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          opacity,
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
        }}
      >
        {text}
      </div>
    </foreignObject>
  );
  const renderResizeHandles = (
    geom: VideoStageGeom,
    color: string,
    entry: VideoFrameEntry | VideoTrackGhost,
  ) => (
    <>
      {HANDLE_DIRECTIONS.map(({ dir, cx, cy, cursor }) => {
        const centerX = geom.x + geom.w * cx;
        const centerY = y(geom.y + geom.h * cy);
        return (
          <g key={dir}>
            <rect
              data-testid="video-resize-hit-area"
              data-dir={dir}
              x={centerX - VIDEO_HANDLE_HIT_SIZE / 2}
              y={centerY - VIDEO_HANDLE_HIT_SIZE / 2}
              width={VIDEO_HANDLE_HIT_SIZE}
              height={VIDEO_HANDLE_HIT_SIZE}
              fill="transparent"
              style={{ cursor, pointerEvents: "visibleFill" }}
              onPointerDown={(evt) => onBeginResize(dir, evt, entry)}
            />
            <rect
              data-testid="video-resize-handle"
              data-dir={dir}
              x={centerX - VIDEO_HANDLE_SIZE / 2}
              y={centerY - VIDEO_HANDLE_SIZE / 2}
              width={VIDEO_HANDLE_SIZE}
              height={VIDEO_HANDLE_SIZE}
              rx={0.0025}
              fill="white"
              stroke={color}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ cursor, pointerEvents: "auto" }}
              onPointerDown={(evt) => onBeginResize(dir, evt, entry)}
            />
          </g>
        );
      })}
    </>
  );

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
        zIndex: 2,
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
        const g = (drag?.kind === "move" || drag?.kind === "resize") && drag.id === entry.ann.id ? drag.current : entry.geom;
        const color = classColor(entry.className);
        const selected = entry.ann.id === selectedId;
        const canEditSelected = selected && !readOnly && !isPlaying && !(entry.trackId && selectedTrackLocked);
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
              style={{ cursor: canEditSelected ? "move" : "pointer", pointerEvents: "auto" }}
              onPointerDown={(evt) => onBeginMove(evt, entry)}
            />
            {renderLabel(g, color, `${entry.className}${labelSuffix}`)}
            {canEditSelected && renderResizeHandles(g, color, entry)}
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
            style={{ cursor: "move", pointerEvents: "auto" }}
            onPointerDown={(evt) => onBeginMove(evt, selectedTrackGhost)}
          />
          {renderLabel(
            selectedTrackGhost.geom,
            classColor(selectedTrackGhost.className),
            `${selectedTrackGhost.className} · 参考 F${selectedTrackGhost.originFrame}`,
            0.86,
          )}
          {!readOnly && !isPlaying && !selectedTrackLocked && renderResizeHandles(
            selectedTrackGhost.geom,
            classColor(selectedTrackGhost.className),
            selectedTrackGhost,
          )}
        </g>
      )}
      {selectedTrackGhost && (drag?.kind === "move" || drag?.kind === "resize") && drag.id === selectedTrackGhost.ann.id && (
        <g data-testid="video-track-ghost">
          <rect
            x={drag.current.x}
            y={y(drag.current.y)}
            width={drag.current.w}
            height={h(drag.current.h)}
            fill="rgba(255,255,255,0.035)"
            stroke={classColor(selectedTrackGhost.className)}
            strokeWidth={2}
            strokeDasharray="3 5"
            opacity={0.72}
            vectorEffect="non-scaling-stroke"
          />
          {drag.kind === "resize" && renderResizeHandles(drag.current, classColor(selectedTrackGhost.className), selectedTrackGhost)}
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
