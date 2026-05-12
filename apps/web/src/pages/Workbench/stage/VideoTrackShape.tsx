import { memo } from "react";
import type { VideoStageGeom } from "./videoStageTypes";

interface VideoTrackShapeProps {
  geom: VideoStageGeom;
  color: string;
  selected: boolean;
  dashed: boolean;
  viewBoxHeight: number;
}

function VideoTrackShapeComponent({ geom, color, selected, dashed, viewBoxHeight }: VideoTrackShapeProps) {
  return (
    <rect
      data-testid="video-track-shape"
      x={geom.x}
      y={geom.y * viewBoxHeight}
      width={geom.w}
      height={geom.h * viewBoxHeight}
      fill={selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)"}
      stroke={color}
      strokeWidth={selected ? 3 : 2}
      strokeDasharray={dashed ? "6 4" : undefined}
      vectorEffect="non-scaling-stroke"
      style={{ pointerEvents: "none" }}
    />
  );
}

export const VideoTrackShape = memo(VideoTrackShapeComponent, (prev, next) => (
  prev.geom.x === next.geom.x &&
  prev.geom.y === next.geom.y &&
  prev.geom.w === next.geom.w &&
  prev.geom.h === next.geom.h &&
  prev.color === next.color &&
  prev.selected === next.selected &&
  prev.dashed === next.dashed &&
  prev.viewBoxHeight === next.viewBoxHeight
));
