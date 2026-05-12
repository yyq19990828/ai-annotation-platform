import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor } from "./colors";
import {
  VIDEO_HANDLE_HIT_SIZE,
  VIDEO_HANDLE_SIZE,
} from "./boxVisual";
import { clientPointToVideoPoint } from "./videoStageCoordinates";
import { pickTopVideoEntryAt } from "./videoStagePicking";
import type {
  VideoDragState,
  VideoFrameEntry,
  VideoResizeDirection,
  VideoStageGeom,
  VideoTrackGhost,
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

type VideoObjectEntry = {
  key: string;
  entry: VideoFrameEntry;
  geom: VideoStageGeom;
  color: string;
  canEditSelected: boolean;
};

interface VideoInteractionLayerProps {
  overlayRef: RefObject<SVGSVGElement>;
  entries: VideoObjectEntry[];
  viewBoxHeight: number;
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
  onBeginMove: (evt: ReactPointerEvent<SVGElement>, entry: VideoFrameEntry | VideoTrackGhost) => void;
  onBeginResize: (
    dir: VideoResizeDirection,
    evt: ReactPointerEvent<SVGElement>,
    entry: VideoFrameEntry | VideoTrackGhost,
  ) => void;
  onPointerMove: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onFinishDrag: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onCancelDrag: () => void;
  onPointerLeave: (evt: ReactPointerEvent<SVGSVGElement>) => void;
}

export function VideoInteractionLayer({
  overlayRef,
  entries,
  viewBoxHeight,
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
}: VideoInteractionLayerProps) {
  const ghostColor = selectedTrackGhost ? classColor(selectedTrackGhost.className) : "";
  const interactiveGhost = selectedTrackGhost && !drag ? selectedTrackGhost : null;
  const dragColor = drag && (drag.kind === "move" || drag.kind === "resize")
    ? entries.find(({ entry }) => entry.ann.id === drag.id)?.color || ghostColor || classColor(activeClass)
    : classColor(activeClass);

  const renderResizeHandles = (
    geom: VideoStageGeom,
    color: string,
    entry: VideoFrameEntry | VideoTrackGhost,
  ) => (
    <>
      {HANDLE_DIRECTIONS.map(({ dir, cx, cy, cursor }) => {
        const centerX = geom.x + geom.w * cx;
        const centerY = (geom.y + geom.h * cy) * viewBoxHeight;
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

  const onPointerDown = (evt: ReactPointerEvent<SVGSVGElement>) => {
    const svg = overlayRef.current;
    if (!svg) {
      onBeginDraw(evt);
      return;
    }
    const point = clientPointToVideoPoint(svg, { x: evt.clientX, y: evt.clientY }, viewBoxHeight);
    const hit = pickTopVideoEntryAt(
      [
        ...entries.map((entry) => ({ ...entry.entry, geom: entry.geom })),
        ...(interactiveGhost ? [interactiveGhost] : []),
      ],
      point,
    );
    if (hit) onBeginMove(evt, hit);
    else onBeginDraw(evt);
  };

  return (
    <svg
      ref={overlayRef}
      data-testid="video-overlay"
      data-layer="interaction"
      viewBox={`0 0 1 ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onFinishDrag}
      onPointerCancel={onCancelDrag}
      onPointerLeave={onPointerLeave}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 6,
        cursor: readOnly || isPlaying || (videoTool === "track" && selectedTrackLocked)
          ? "default"
          : videoTool === "track"
            ? "copy"
            : "crosshair",
        pointerEvents: "auto",
      }}
    >
      {entries.map(({ key, entry, geom, color, canEditSelected }) => (
        <g key={key}>
          {canEditSelected && (
            <>
              <rect
                data-testid="video-selected-shape"
                x={geom.x}
                y={geom.y * viewBoxHeight}
                width={geom.w}
                height={geom.h * viewBoxHeight}
                fill="rgba(255,255,255,0.01)"
                stroke={color}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
              {renderResizeHandles(geom, color, entry)}
            </>
          )}
        </g>
      ))}
      {selectedTrackGhost && !drag && (
        <g data-testid="video-track-ghost">
          <rect
            x={selectedTrackGhost.geom.x}
            y={selectedTrackGhost.geom.y * viewBoxHeight}
            width={selectedTrackGhost.geom.w}
            height={selectedTrackGhost.geom.h * viewBoxHeight}
            fill="rgba(255,255,255,0.035)"
            stroke={ghostColor}
            strokeWidth={2}
            strokeDasharray="3 5"
            opacity={0.72}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
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
            y={drag.current.y * viewBoxHeight}
            width={drag.current.w}
            height={drag.current.h * viewBoxHeight}
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
      {(drag?.kind === "move" || drag?.kind === "resize") && !selectedTrackGhost && (
        <rect
          x={drag.current.x}
          y={drag.current.y * viewBoxHeight}
          width={drag.current.w}
          height={drag.current.h * viewBoxHeight}
          fill="rgba(255,255,255,0.05)"
          stroke={dragColor}
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {draft && (
        <rect
          x={draft.x}
          y={draft.y * viewBoxHeight}
          width={draft.w}
          height={draft.h * viewBoxHeight}
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
