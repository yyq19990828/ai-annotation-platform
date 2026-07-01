import { useMemo } from "react";
import { Layer, Line, Circle, Rect, Ellipse } from "react-konva";
import { useTheme } from "@/hooks/useTheme";
import { colorToHex, cssVarToHex, hexToRgba } from "./colors";
import { strokeWidthFor, type AnnotationVisualConfig } from "./annotationVisual";
import { screenToWorld } from "./shared/viewport/scaleCancel";
import { VideoKonvaTrackShape } from "./VideoKonvaTrackShape";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import type { VideoEntryView, VideoGhostView, VideoTrackPreviewView } from "./videoFrameViews";

// 关键帧圆点半径(世界单位,= 旧 SVG viewBox 单位 0.0038/0.0052,随画布缩放;
// 描边走 /scale 屏幕恒定,与旧 non-scaling-stroke 一致)。
const TRACK_KEYFRAME_DOT_RADIUS = 0.0038;
const TRACK_OCCLUDED_DOT_RADIUS = 0.0052;

interface VideoKonvaTracksLayerProps {
  entries: VideoEntryView[];
  previews: VideoTrackPreviewView[];
  ghost: VideoGhostView | null;
  size: VideoPixelSize;
  scale: number;
  visual: AnnotationVisualConfig;
}

/**
 * v0.16.2 · 视频 track 可视层(Konva Layer "tracks")。
 *
 * 渲染:轨迹预览线(Line)+ 选中态关键帧圆点(Circle)+ 当前帧 track 框
 * (VideoKonvaTrackShape)+ 选中轨迹 ghost 参考框。坐标像素空间(归一化 × size);
 * 线宽/虚线 `/scale` 屏幕恒定(替代旧 SVG non-scaling-stroke),圆点半径世界单位
 * (随画布缩放,与旧 SVG viewBox 几何一致)。本版 listening=false,不接交互(v0.16.3)。
 */
export function VideoKonvaTracksLayer({
  entries,
  previews,
  ghost,
  size,
  scale,
  visual,
}: VideoKonvaTracksLayerProps) {
  const { resolved: theme } = useTheme();
  const occludedDotFill = useMemo(() => cssVarToHex("--sc-card", theme), [theme]);

  return (
    <Layer name="tracks" listening={false}>
      {previews.map((preview) => {
        if (preview.points.length === 0) return null;
        if (preview.points.length === 1 && !preview.selected) return null;
        const hex = colorToHex(preview.color);
        return (
          <Line
            key={`preview-line-${preview.key}`}
            name="video-track-path-preview"
            points={preview.points.flatMap((p) => [p.x * size.w, p.y * size.h])}
            stroke={hex}
            strokeWidth={(preview.selected ? 2.5 : 1.5) / scale}
            dash={preview.selected ? undefined : [4 / scale, 4 / scale]}
            lineCap="round"
            lineJoin="round"
            opacity={preview.selected ? 0.82 : 0.42}
            listening={false}
          />
        );
      })}
      {previews.flatMap((preview) =>
        preview.selected
          ? preview.points.map((p) => {
            const hex = colorToHex(preview.color);
            return (
              <Circle
                key={`kf-${preview.key}-${p.frame}`}
                name="video-track-keyframe-dot"
                x={p.x * size.w}
                y={p.y * size.h}
                radius={(p.occluded ? TRACK_OCCLUDED_DOT_RADIUS : TRACK_KEYFRAME_DOT_RADIUS) * size.w}
                fill={p.occluded ? occludedDotFill : hex}
                stroke={hex}
                strokeWidth={1.5 / scale}
                opacity={0.82}
                listening={false}
              />
            );
          })
          : [],
      )}
      {entries.map((entry) => (
        <VideoKonvaTrackShape
          key={entry.key}
          geom={entry.geom}
          color={entry.color}
          dashed={entry.dashed}
          selected={entry.selected}
          size={size}
          scale={scale}
          visual={visual}
        />
      ))}
      {ghost && (() => {
        const hex = colorToHex(ghost.color);
        const stroke = screenToWorld(strokeWidthFor(false, visual), scale);
        // kalman 模式:在参考框外画一圈淡色误差椭圆——半轴 = 框半宽高 + 2σ(≈95% 置信),
        // σ 随外推距离/关键帧稀疏度增长,膨胀的椭圆即「预测越不确定、椭圆越大」的视觉提示。
        const cx = (ghost.geom.x + ghost.geom.w / 2) * size.w;
        const cy = (ghost.geom.y + ghost.geom.h / 2) * size.h;
        const ellipse = ghost.uncertainty ? (
          <Ellipse
            name="video-track-ghost-uncertainty"
            x={cx}
            y={cy}
            radiusX={(ghost.geom.w / 2) * size.w + 2 * ghost.uncertainty.sx * size.w}
            radiusY={(ghost.geom.h / 2) * size.h + 2 * ghost.uncertainty.sy * size.h}
            stroke={hex}
            strokeWidth={stroke}
            dash={[3 / scale, 5 / scale]}
            opacity={0.3}
            listening={false}
          />
        ) : null;
        return (
          <>
            {ellipse}
            <Rect
              name="video-track-ghost"
              x={ghost.geom.x * size.w}
              y={ghost.geom.y * size.h}
              width={ghost.geom.w * size.w}
              height={ghost.geom.h * size.h}
              stroke={hex}
              strokeWidth={stroke}
              dash={[6 / scale, 4 / scale]}
              fill={hexToRgba(hex, 0.05)}
              opacity={0.6}
              listening={false}
            />
          </>
        );
      })()}
    </Layer>
  );
}
