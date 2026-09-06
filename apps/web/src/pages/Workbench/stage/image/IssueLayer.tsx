/**
 * v0.10.20 · I18 · IssueLayer
 *
 * 把 v0.10.19 已落的 pixel-anchored feedback (kind=issue, anchor_type=pixel) 同步渲染到
 * ImageStage Konva tree 中, 替代「输入框填 x/y」形态:
 *
 *   - 每个 pixel issue 渲染为 status 配色的图钉 (Circle + 字母)。
 *   - status: open=warning橙, resolved=success绿, wont_fix=fg-muted灰。
 *   - 单击图钉 → 派发 onPinClick(id), 由 Shell 高亮 + 切到 DiscussionPanel issues tab 对应项。
 *   - drop-arm 模式 (armedForDrop=true): 渲染一个透明全画布 Rect, 单击落点 → 派发 onDrop(x, y)
 *     (相对坐标 [0,1]); Shell 据此打开 IssueCreateModal 预填 anchor.
 *
 * 注意:
 *   - 本 Layer 必须挂在 ImageStage `</Stage>` 之前 (位于 ImageStageShapes 层之上, 确保图钉不被遮挡).
 *   - listening 行为:
 *       drop-arm 模式 → catcher Rect listening=true 拦截一切 click (含底层 shape);
 *       否则只有 pin Circle listening=true, 其余 hit 透到底层工具.
 */
import { Circle, Layer, Rect, Text } from "react-konva";
import type Konva from "konva";

import { hasPixelAnchor, type AnnotationFeedback } from "@/api/feedbacks";

interface Props {
  /** 仅 kind=issue + anchor_type=pixel + 含 anchor_position 的 feedback 行. */
  pixelIssues: AnnotationFeedback[];
  /** 当前图像绘制尺寸 (相对 0-1 → 像素坐标的缩放). */
  imgW: number;
  imgH: number;
  /** 视口缩放; 用于让图钉视觉大小不随 zoom 变化 (反向缩放). */
  scale: number;
  /** 高亮的 feedback id (单击列表 → 圆环加粗). */
  highlightId?: string | null;
  /** 单击图钉. */
  onPinClick?: (id: string) => void;
  /** drop-arm 模式: 渲染透明 catcher, 单击落点 → 派发归一化坐标 (相对 0-1). */
  armedForDrop?: boolean;
  onDrop?: (x: number, y: number) => void;
}

const STATUS_COLOR: Record<string, string> = {
  open: "#f59e0b", // warning 橙
  resolved: "#10b981", // success 绿
  wont_fix: "#71717a", // fg-muted 灰
};

export function IssueLayer({
  pixelIssues,
  imgW,
  imgH,
  scale,
  highlightId,
  onPinClick,
  armedForDrop = false,
  onDrop,
}: Props) {
  // 反向缩放后的视觉常量 (Konva 是相对图像坐标系, 1px = 1 image px; 缩 1/scale 让视觉恒定).
  const pinR = 8 / scale;
  const pinStroke = 2 / scale;
  const pinHighlightStroke = 3 / scale;
  const textSize = 10 / scale;

  return (
    <Layer name="issue-pins" listening={true}>
      {pixelIssues.map((issue) => {
        if (!hasPixelAnchor(issue)) return null;
        const x = issue.anchor_position.x * imgW;
        const y = issue.anchor_position.y * imgH;
        const color = STATUS_COLOR[issue.status] ?? STATUS_COLOR.open;
        const isHighlight = highlightId === issue.id;
        return (
          <Circle
            key={issue.id}
            x={x}
            y={y}
            radius={pinR}
            fill={color}
            stroke="#ffffff"
            strokeWidth={isHighlight ? pinHighlightStroke : pinStroke}
            shadowEnabled={isHighlight}
            shadowBlur={6 / scale}
            shadowOpacity={0.8}
            shadowColor={color}
            onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true;
              onPinClick?.(issue.id);
            }}
            // 装饰图钉中心的 "!"; 改用 Text node 而非自定义 path, 渲染极轻量.
          />
        );
      })}
      {/* pin 文字标签 (i) — 单独 map 避免 onClick 命中 Text 被 Circle 截获 */}
      {pixelIssues.map((issue) => {
        if (!hasPixelAnchor(issue)) return null;
        const x = issue.anchor_position.x * imgW;
        const y = issue.anchor_position.y * imgH;
        return (
          <Text
            key={`label-${issue.id}`}
            x={x - textSize / 2}
            y={y - textSize / 2}
            text="i"
            fontSize={textSize}
            fontStyle="bold"
            fill="#ffffff"
            listening={false}
          />
        );
      })}
      {armedForDrop && imgW > 0 && imgH > 0 && (
        <Rect
          x={0}
          y={0}
          width={imgW}
          height={imgH}
          fill="rgba(0,0,0,0)"
          listening={true}
          // 鼠标悬浮时显示 cell cursor 提示进入 drop 模式 (Konva container 接管 cursor).
          onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage();
            if (stage?.container()) stage.container().style.cursor = "crosshair";
          }}
          onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage();
            if (stage?.container()) stage.container().style.cursor = "";
          }}
          onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true;
            const stage = e.target.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;
            // pointer 是 Stage 容器坐标; 需要先 invert stage transform 再除图像尺寸归一.
            const transform = stage.getAbsoluteTransform().copy().invert();
            const local = transform.point(pointer);
            const x = local.x / imgW;
            const y = local.y / imgH;
            if (x < 0 || x > 1 || y < 0 || y > 1) return;
            onDrop?.(x, y);
          }}
        />
      )}
    </Layer>
  );
}
