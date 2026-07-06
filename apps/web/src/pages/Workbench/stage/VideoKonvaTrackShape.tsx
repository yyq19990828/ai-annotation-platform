import { memo, Fragment } from "react";
import { Rect } from "react-konva";
import { colorToHex, hexToRgba } from "./colors";
import { fillAlpha, strokeWidthFor, type AnnotationVisualConfig } from "./annotationVisual";
import { screenToWorld } from "./shared/viewport/scaleCancel";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import type { VideoStageGeom } from "./videoStageTypes";

/** v0.21.9 · AI 追出关键帧的角标色 (amber, 对齐时间轴 trackKeyframePrediction / 预测密度轨)。 */
const PREDICTED_BADGE_HEX = "#fbbf24";

interface VideoKonvaTrackShapeProps {
  /** 归一化 [0,1] bbox。 */
  geom: VideoStageGeom;
  /** 原始 CSS 色(轨迹色 / 类别色);内部转 hex。 */
  color: string;
  /** 插值帧或遮挡 → 虚线(对齐旧 SVG VideoTrackShape 的 "6 4")。 */
  dashed: boolean;
  /** v0.21.9 · 当前帧是 AI 追出的关键帧 → 左上角 amber 角标 (区别于插值虚线、人工实线)。 */
  predicted?: boolean;
  selected: boolean;
  size: VideoPixelSize;
  scale: number;
  visual: AnnotationVisualConfig;
}

/**
 * v0.16.2 · 单个视频 track 框(Konva,抄图片 KonvaBox 范式)。
 *
 * 像素空间(归一化 × size,决策 B);线宽/虚线走 `/scale` 抵消(替代旧 SVG 的
 * `non-scaling-stroke`,屏幕恒定);线宽/填充 alpha 复用 annotationVisual 纯函数
 * (与图片同源)。本版 listening=false,不接交互(交互在 v0.16.3)。
 */
function VideoKonvaTrackShapeComponent({
  geom,
  color,
  dashed,
  predicted = false,
  selected,
  size,
  scale,
  visual,
}: VideoKonvaTrackShapeProps) {
  const hex = colorToHex(color);
  const sw = screenToWorld(strokeWidthFor(selected, visual), scale);
  const x = geom.x * size.w;
  const y = geom.y * size.h;
  const badge = 6 / scale; // 屏幕恒定的角标边长
  return (
    <Fragment>
      <Rect
        name="video-track-shape"
        x={x}
        y={y}
        width={geom.w * size.w}
        height={geom.h * size.h}
        stroke={hex}
        strokeWidth={sw}
        dash={dashed ? [6 / scale, 4 / scale] : undefined}
        fill={hexToRgba(hex, fillAlpha(selected, visual))}
        listening={false}
      />
      {predicted && (
        <Rect
          name="video-track-predicted-badge"
          x={x}
          y={y}
          width={badge}
          height={badge}
          fill={PREDICTED_BADGE_HEX}
          listening={false}
        />
      )}
    </Fragment>
  );
}

export const VideoKonvaTrackShape = memo(VideoKonvaTrackShapeComponent);
