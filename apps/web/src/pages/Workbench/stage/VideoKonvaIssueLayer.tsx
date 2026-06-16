import { Layer, Circle, Text } from "react-konva";
import { cssVarToHex } from "./colors";
import type { VideoPixelSize } from "./videoKonvaCoordinates";
import type { AnnotationFeedback } from "@/api/feedbacks";

// issue pin 半径(世界单位,= 旧 SVG viewBox 0.012,随画布缩放);描边 /scale 屏幕恒定。
const ISSUE_PIN_RADIUS = 0.012;

const STATUS_VAR: Record<string, string> = {
  open: "--color-warning",
  resolved: "--color-success",
  wont_fix: "--color-fg-muted",
};

interface VideoKonvaIssueLayerProps {
  /** 仅 kind=issue + anchor_type=pixel + 含 anchor_position 的 feedback 行。 */
  pixelIssues: AnnotationFeedback[];
  frameIndex: number;
  size: VideoPixelSize;
  scale: number;
  highlightId?: string | null;
}

/**
 * v0.16.2 · 视频 issue 图钉层(Konva Layer "issue",render-only)。
 *
 * 旧 VideoIssueLayer(SVG)的 Konva 对应物:只渲染 anchor_position.frame === 当前帧 的图钉,
 * 坐标像素空间(归一化 × size),status 配色复用 tokens(open/resolved/wont_fix)。
 * 本版 listening=false 不接点击(onPinClick 交互留 v0.16.3)。
 */
export function VideoKonvaIssueLayer({
  pixelIssues,
  frameIndex,
  size,
  scale,
  highlightId,
}: VideoKonvaIssueLayerProps) {
  const onFrame = pixelIssues.filter((issue) => issue.anchor_position?.frame === frameIndex);
  if (onFrame.length === 0) return null;
  const ringColor = cssVarToHex("--color-bg-elev");
  const radius = ISSUE_PIN_RADIUS * size.w;
  return (
    <Layer name="issue" listening={false}>
      {onFrame.map((issue) => {
        const x = issue.anchor_position!.x * size.w;
        const y = issue.anchor_position!.y * size.h;
        const fill = cssVarToHex(STATUS_VAR[issue.status] ?? STATUS_VAR.open);
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
            listening={false}
          />
        );
      })}
      {onFrame.map((issue) => (
        <Text
          key={`issue-label-${issue.id}`}
          x={issue.anchor_position!.x * size.w}
          y={issue.anchor_position!.y * size.h}
          text="i"
          fontSize={radius * 1.2}
          fontStyle="bold"
          fill={ringColor}
          offsetX={radius * 0.18}
          offsetY={radius * 0.6}
          listening={false}
        />
      ))}
    </Layer>
  );
}
