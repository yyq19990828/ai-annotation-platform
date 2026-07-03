import { Layer, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { classColorForCanvas, hexToRgba } from "./colors";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import type { AiBox } from "../state/transforms";

interface VideoKonvaAiLayerProps {
  /** 已按当前帧过滤的 AI 候选框(video_bbox, 归一化 0-1 坐标)。 */
  boxes: AiBox[];
  size: VideoPixelSize;
  scale: number;
  selectedId: string | null;
  /** 仅 select 工具下可点选(镜像图片舞台的 ai 层 listening=selectActive)。 */
  listening: boolean;
  fadedIds?: Set<string>;
  onSelect: (id: string) => void;
}

/**
 * v0.21.4 · 视频 AI 候选可视 + 可选层(Konva Layer "ai")。
 *
 * 渲染当前帧的 AI 候选框(虚线 + 类色 + 淡填充), 点击选中(cancelBubble 阻止冒泡到
 * Stage 级 picking, 否则会被空击逻辑立刻取消选)。采纳/驳回按钮由 SelectionOverlay
 * 在 DOM 层贴框呈现(见 VideoKonvaStage)。样式对齐图片工作台的候选框。
 */
export function VideoKonvaAiLayer({
  boxes,
  size,
  scale,
  selectedId,
  listening,
  fadedIds,
  onSelect,
}: VideoKonvaAiLayerProps) {
  return (
    <Layer name="ai" listening={listening}>
      {boxes.map((b) => {
        const color = classColorForCanvas(b.cls);
        const selected = selectedId === b.id;
        const faded = fadedIds?.has(b.id) ?? false;
        return (
          <Rect
            key={b.id}
            name="video-ai-candidate"
            x={b.x * size.w}
            y={b.y * size.h}
            width={b.w * size.w}
            height={b.h * size.h}
            stroke={color}
            strokeWidth={(selected ? 2.5 : 1.5) / scale}
            dash={[4 / scale, 3 / scale]}
            fill={hexToRgba(color, selected ? 0.12 : 0.05)}
            opacity={faded ? 0.35 : 1}
            onPointerDown={(e: KonvaEventObject<PointerEvent>) => {
              e.cancelBubble = true;
              onSelect(b.id);
            }}
          />
        );
      })}
    </Layer>
  );
}
