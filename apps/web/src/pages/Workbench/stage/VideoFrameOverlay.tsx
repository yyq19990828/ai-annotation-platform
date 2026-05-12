import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor } from "./colors";
import {
  BOX_LABEL_FONT_PX,
  VIDEO_HANDLE_HIT_SIZE,
  VIDEO_HANDLE_SIZE,
  VIDEO_LABEL_OFFSET,
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
  pendingDraft?: { geom: VideoStageGeom; className: string } | null;
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
  pendingDraft,
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
  const entryViews = entries.map((entry) => {
    const geom = (drag?.kind === "move" || drag?.kind === "resize") && drag.id === entry.ann.id ? drag.current : entry.geom;
    const color = classColor(entry.className);
    const selected = entry.ann.id === selectedId;
    const canEditSelected = selected && !readOnly && !isPlaying && !(entry.trackId && selectedTrackLocked);
    const labelSuffix = entry.source === "interpolated"
      ? " · 插值"
      : entry.occluded
        ? " · 遮挡"
        : "";
    return {
      key: `${entry.id}-${entry.trackId ?? "legacy"}`,
      entry,
      geom,
      color,
      canEditSelected,
      labelText: `${entry.className}${labelSuffix}`,
    };
  });
  const pendingDraftColor = pendingDraft ? classColor(pendingDraft.className) : "";
  const ghostColor = selectedTrackGhost ? classColor(selectedTrackGhost.className) : "";
  const labelEntries: Array<{ key: string; geom: VideoStageGeom; color: string; text: string; opacity?: number }> = [
    ...entryViews.map((view) => ({
      key: `entry-${view.key}`,
      geom: view.geom,
      color: view.color,
      text: view.labelText,
    })),
    ...(pendingDraft && !drag
      ? [{ key: "pending-draft", geom: pendingDraft.geom, color: pendingDraftColor, text: pendingDraft.className, opacity: 0.9 }]
      : []),
    ...(selectedTrackGhost && !drag
      ? [{
        key: `ghost-${selectedTrackGhost.ann.id}`,
        geom: selectedTrackGhost.geom,
        color: ghostColor,
        text: `${selectedTrackGhost.className} · 参考 F${selectedTrackGhost.originFrame}`,
        opacity: 0.86,
      }]
      : []),
  ];
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
    <>
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
      {entryViews.map(({ entry, geom, color, canEditSelected, key }) => {
        return (
          <g key={key}>
            <rect
              x={geom.x}
              y={y(geom.y)}
              width={geom.w}
              height={h(geom.h)}
              fill={entry.ann.id === selectedId ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)"}
              stroke={color}
              strokeWidth={entry.ann.id === selectedId ? 3 : 2}
              strokeDasharray={entry.source === "interpolated" || entry.occluded ? "6 4" : undefined}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: canEditSelected ? "move" : "pointer", pointerEvents: "auto" }}
              onPointerDown={(evt) => onBeginMove(evt, entry)}
            />
            {canEditSelected && renderResizeHandles(geom, color, entry)}
          </g>
        );
      })}
      {pendingDraft && !drag && (
        <g data-testid="video-pending-draft" opacity={0.9} style={{ pointerEvents: "none" }}>
          <rect
            x={pendingDraft.geom.x}
            y={y(pendingDraft.geom.y)}
            width={pendingDraft.geom.w}
            height={h(pendingDraft.geom.h)}
            fill="rgba(255,255,255,0.08)"
            stroke={pendingDraftColor}
            strokeWidth={2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      {selectedTrackGhost && !drag && (
        <g data-testid="video-track-ghost">
          <rect
            x={selectedTrackGhost.geom.x}
            y={y(selectedTrackGhost.geom.y)}
            width={selectedTrackGhost.geom.w}
            height={h(selectedTrackGhost.geom.h)}
            fill="rgba(255,255,255,0.035)"
            stroke={ghostColor}
            strokeWidth={2}
            strokeDasharray="3 5"
            opacity={0.72}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: "move", pointerEvents: "auto" }}
            onPointerDown={(evt) => onBeginMove(evt, selectedTrackGhost)}
          />
          {!readOnly && !isPlaying && !selectedTrackLocked && renderResizeHandles(
            selectedTrackGhost.geom,
            ghostColor,
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
            stroke={ghostColor}
            strokeWidth={2}
            strokeDasharray="3 5"
            opacity={0.72}
            vectorEffect="non-scaling-stroke"
          />
          {drag.kind === "resize" && renderResizeHandles(drag.current, ghostColor, selectedTrackGhost)}
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
      <div
        data-testid="video-label-overlay"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {labelEntries.map((label) => (
          <div
            key={label.key}
            data-testid="video-label"
            data-color={label.color}
            style={{
              position: "absolute",
              left: `${Math.max(0, Math.min(98, label.geom.x * 100))}%`,
              top: `${Math.max(0, Math.min(100, label.geom.y * 100))}%`,
              transform: label.geom.y > VIDEO_LABEL_OFFSET ? "translateY(calc(-100% - 4px))" : "translateY(4px)",
              maxWidth: "min(220px, calc(100% - 8px))",
              padding: `${Math.max(2, BOX_LABEL_FONT_PX / 4)}px ${Math.max(5, BOX_LABEL_FONT_PX / 2)}px`,
              borderRadius: 3,
              background: label.color,
              color: "white",
              fontSize: BOX_LABEL_FONT_PX,
              fontFamily: "var(--font-sans, sans-serif)",
              fontWeight: 700,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              opacity: label.opacity ?? 1,
              textShadow: "0 1px 2px rgba(0,0,0,0.55)",
              boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
            }}
          >
            {label.text}
          </div>
        ))}
      </div>
    </>
  );
}
