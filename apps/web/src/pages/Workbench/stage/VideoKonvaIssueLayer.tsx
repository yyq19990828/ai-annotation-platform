import { useMemo } from "react";
import { Layer, Circle, Text, Rect } from "react-konva";
import type Konva from "konva";
import { useTheme } from "@/hooks/useTheme";
import { cssVarToHex } from "./colors";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import { hasPixelAnchor, type AnnotationFeedback } from "@/api/feedbacks";

// issue pin 半径(世界单位,= 旧 SVG viewBox 0.012,随画布缩放);描边 /scale 屏幕恒定。
const ISSUE_PIN_RADIUS = 0.012;

const STATUS_VAR: Record<string, string> = {
  open: "--sc-caution",
  resolved: "--sc-positive",
  wont_fix: "--sc-muted-foreground",
};

interface VideoKonvaIssueLayerProps {
  /** 仅 kind=issue + anchor_type=pixel + 含 anchor_position 的 feedback 行。 */
  pixelIssues: AnnotationFeedback[];
  frameIndex: number;
  size: VideoPixelSize;
  scale: number;
  highlightId?: string | null;
  /** 单击图钉 → onPinClick(id)(Shell 据此高亮 + 切到 DiscussionPanel issues tab)。 */
  onPinClick?: (id: string) => void;
  dropArmed?: boolean;
  onDrop?: (x: number, y: number, frame: number) => void;
}

/**
 * v0.16.2 · 视频 issue 图钉层(Konva Layer "issue",render-only)。
 *
 * 旧 VideoIssueLayer(SVG)的 Konva 对应物:只渲染 anchor_position.frame === 当前帧 的图钉,
 * 坐标像素空间(归一化 × size),status 配色复用 shadcn tokens(open/resolved/wont_fix)。
 * 提供 onPinClick 时图钉可点击(Layer/Circle listening);pointerdown 用 cancelBubble 阻止
 * 冒泡到 Stage(避免误触发画框/取消选中),click 触发回调(对齐旧 SVG 栈 onPinClick)。
 */
export function VideoKonvaIssueLayer({
  pixelIssues,
  frameIndex,
  size,
  scale,
  highlightId,
  onPinClick,
  dropArmed = false,
  onDrop,
}: VideoKonvaIssueLayerProps) {
  const { resolved: theme } = useTheme();
  const ringColor = useMemo(() => cssVarToHex("--sc-card", theme), [theme]);
  const statusFillByStatus = useMemo(() => {
    const fills: Record<string, string> = {};
    for (const [status, varName] of Object.entries(STATUS_VAR)) {
      fills[status] = cssVarToHex(varName, theme);
    }
    return fills;
  }, [theme]);
  const onFrame = pixelIssues
    .filter(hasPixelAnchor)
    .filter((issue) => issue.anchor_position.frame === frameIndex);
  if (onFrame.length === 0 && !dropArmed) return null;
  const radius = ISSUE_PIN_RADIUS * size.w;
  const clickable = !!onPinClick;
  const setCursor = (e: Konva.KonvaEventObject<MouseEvent>, cursor: string) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = cursor;
  };
  return (
    <Layer name="issue" listening={clickable || dropArmed}>
      {onFrame.map((issue) => {
        const x = issue.anchor_position.x * size.w;
        const y = issue.anchor_position.y * size.h;
        const fill = statusFillByStatus[issue.status] ?? statusFillByStatus.open;
        const isHighlight = highlightId === issue.id;
        return (
          <Circle
            key={`issue-${issue.id}`}
            name={`video-issue-pin-${issue.id}`}
            x={x}
            y={y}
            radius={radius}
            fill={fill}
            stroke={ringColor}
            strokeWidth={(isHighlight ? 3 : 1.5) / scale}
            listening={clickable}
            onPointerDown={(e) => {
              e.cancelBubble = true;
            }}
            onClick={(e) => {
              e.cancelBubble = true;
              onPinClick?.(issue.id);
            }}
            onMouseEnter={(e) => setCursor(e, "pointer")}
            onMouseLeave={(e) => setCursor(e, "")}
          />
        );
      })}
      {onFrame.map((issue) => (
        <Text
          key={`issue-label-${issue.id}`}
          x={issue.anchor_position.x * size.w}
          y={issue.anchor_position.y * size.h}
          text="i"
          fontSize={radius * 1.2}
          fontStyle="bold"
          fill={ringColor}
          offsetX={radius * 0.18}
          offsetY={radius * 0.6}
          listening={false}
        />
      ))}
      {dropArmed && (
        <Rect
          name="video-issue-drop-catcher"
          x={0}
          y={0}
          width={size.w}
          height={size.h}
          fill="rgba(0,0,0,0)"
          listening
          onPointerDown={(event) => {
            event.cancelBubble = true;
          }}
          onPointerUp={(event) => {
            event.cancelBubble = true;
          }}
          onClick={(event) => {
            event.cancelBubble = true;
            if (event.evt.button !== 0 || size.w <= 0 || size.h <= 0) return;
            const stage = event.target.getStage();
            const position = stage?.getPointerPosition();
            if (!stage || !position) return;
            const point = stage.getAbsoluteTransform().copy().invert().point(position);
            const x = point.x / size.w;
            const y = point.y / size.h;
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)
              return;
            onDrop?.(x, y, frameIndex);
          }}
        />
      )}
    </Layer>
  );
}
