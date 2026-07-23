import { Layer, Rect } from "react-konva";
import type Konva from "konva";
import { colorToHex, hexToRgba } from "./colors";
import { BOX_HANDLE_SCREEN_PX } from "./boxVisual";
import { screenToWorld } from "./shared/viewport/scaleCancel";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import type { ResizeDirection } from "./ResizeHandles";
import type { VideoDragState, VideoStageGeom } from "./videoStageTypes";

/** 8 方向句柄锚点(归一化框内比例),与图片 / 旧 SVG 栈一致。 */
const HANDLE_DIRECTIONS: { dir: ResizeDirection; cx: number; cy: number; cursor: string }[] = [
  { dir: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { dir: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { dir: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { dir: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
  { dir: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { dir: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { dir: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { dir: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
];

export type VideoHandleBox = { id: string; geom: VideoStageGeom; color: string };
export type VideoPreviewBox = { geom: VideoStageGeom; color: string };

interface VideoKonvaInteractionLayerProps {
  size: VideoPixelSize;
  scale: number;
  drag: VideoDragState;
  /** 可编辑的选中框(已含拖拽中的 live geom);非空时画 8 向句柄。 */
  handleBox: VideoHandleBox | null;
  /** 画框/移动/缩放的实时预览(虚线);松手前覆盖在静态层之上。 */
  preview: VideoPreviewBox | null;
  onResizeHandlePointerDown: (
    dir: ResizeDirection,
    entryId: string,
    geom: VideoStageGeom,
    e: Konva.KonvaEventObject<PointerEvent>,
  ) => void;
}

/**
 * v0.16.3 · 视频交互层(Konva,listening=true)。对应旧 SVG 栈 VideoInteractionLayer。
 *
 * 只画「交互态」:选中框的 8 向 resize 句柄 + 拖拽实时预览(画框/移动/缩放)。
 * 命中(画框/移动分流)由 VideoKonvaStage 在 Stage 级 pointerdown 用几何 pick 处理,
 * 不需逐形状事件;句柄是唯一逐形状事件(pointerdown 需 cancelBubble 防冒泡到 Stage)。
 * 静态框/轨迹/标签仍由 v0.16.2 的渲染层(listening=false)绘制,本层不重复。
 *
 * scale 抵消:句柄尺寸/线宽屏幕恒定(`/scale`),与图片栈同范式。
 */
export function VideoKonvaInteractionLayer({
  size,
  scale,
  drag,
  handleBox,
  preview,
  onResizeHandlePointerDown,
}: VideoKonvaInteractionLayerProps) {
  const handleSize = screenToWorld(BOX_HANDLE_SCREEN_PX, scale);
  const previewHex = preview ? colorToHex(preview.color) : "";

  return (
    <Layer name="interaction">
      {preview && (
        <Rect
          name={drag?.kind === "draw" ? "video-pending-draft" : "video-drag-preview"}
          x={preview.geom.x * size.w}
          y={preview.geom.y * size.h}
          width={preview.geom.w * size.w}
          height={preview.geom.h * size.h}
          stroke={previewHex}
          strokeWidth={screenToWorld(2, scale)}
          dash={[screenToWorld(6, scale), screenToWorld(4, scale)]}
          fill={hexToRgba(previewHex, 0.06)}
          listening={false}
        />
      )}
      {handleBox &&
        HANDLE_DIRECTIONS.map(({ dir, cx, cy, cursor }) => (
          <Rect
            key={dir}
            name="video-resize-handle"
            x={(handleBox.geom.x + handleBox.geom.w * cx) * size.w - handleSize / 2}
            y={(handleBox.geom.y + handleBox.geom.h * cy) * size.h - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill="white"
            stroke={colorToHex(handleBox.color)}
            strokeWidth={screenToWorld(1.5, scale)}
            cornerRadius={screenToWorld(2, scale)}
            hitStrokeWidth={screenToWorld(6, scale)}
            onPointerDown={(e: Konva.KonvaEventObject<PointerEvent>) =>
              onResizeHandlePointerDown(dir, handleBox.id, handleBox.geom, e)
            }
            onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = cursor;
            }}
            onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
          />
        ))}
    </Layer>
  );
}
