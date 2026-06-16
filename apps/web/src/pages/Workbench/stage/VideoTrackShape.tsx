import { memo } from "react";
import type { VideoStageGeom } from "./videoStageTypes";

interface VideoTrackShapeProps {
  geom: VideoStageGeom;
  color: string;
  dashed: boolean;
  viewBoxHeight: number;
  // v0.15.27 · 共享视觉规格解析后的最终值(已含选中态加权);填充改为类别色 + fillOpacity。
  // 选中态差异已收敛进 strokeWidth/fillOpacity,故不再单独传 selected。
  strokeWidth: number;
  fillOpacity: number;
}

function VideoTrackShapeComponent({
  geom,
  color,
  dashed,
  viewBoxHeight,
  strokeWidth,
  fillOpacity,
}: VideoTrackShapeProps) {
  return (
    <rect
      data-testid="video-track-shape"
      x={geom.x}
      y={geom.y * viewBoxHeight}
      width={geom.w}
      height={geom.h * viewBoxHeight}
      fill={color}
      fillOpacity={fillOpacity}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeDasharray={dashed ? "6 4" : undefined}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
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
  prev.viewBoxHeight === next.viewBoxHeight &&
  prev.strokeWidth === next.strokeWidth &&
  prev.fillOpacity === next.fillOpacity
));
