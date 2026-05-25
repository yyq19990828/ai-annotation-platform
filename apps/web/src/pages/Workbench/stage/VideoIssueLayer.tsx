/**
 * v0.11.7 · VideoIssueLayer
 *
 * video stage 的 pixel-anchored issue 图钉层 (image stage 的 IssueLayer 对应物)。
 * image stage 用 react-konva, video stage 用 SVG overlay, 故单独实现:
 *   - 仅渲染 anchor_position.frame === 当前帧 的图钉 (按帧显隐)。
 *   - 坐标系与 VideoObjectsLayer 一致: viewBox "0 0 1 {viewBoxHeight}", x∈[0,1], y=normY*viewBoxHeight。
 *   - status 配色复用 tokens (open=warning / resolved=success / wont_fix=fg-muted)。
 *   - 单击图钉 → onPinClick(id) (Shell 据此高亮 + 切到 DiscussionPanel issues tab)。
 */
import type { AnnotationFeedback } from "@/api/feedbacks";
import styles from "./VideoIssueLayer.module.css";

interface Props {
  /** 仅 kind=issue + anchor_type=pixel + 含 anchor_position 的 feedback 行。 */
  pixelIssues: AnnotationFeedback[];
  /** 当前播放帧 (只显示该帧命中的图钉)。 */
  frameIndex: number;
  /** SVG viewBox 高度 (= 1/aspectRatio), 与 VideoObjectsLayer 一致。 */
  viewBoxHeight: number;
  /** 高亮的 feedback id (圆环加粗)。 */
  highlightId?: string | null;
  onPinClick?: (id: string) => void;
}

const STATUS_VAR: Record<string, string> = {
  open: "var(--color-warning)",
  resolved: "var(--color-success)",
  wont_fix: "var(--color-fg-muted)",
};

export function VideoIssueLayer({ pixelIssues, frameIndex, viewBoxHeight, highlightId, onPinClick }: Props) {
  const onFrame = pixelIssues.filter((issue) => issue.anchor_position?.frame === frameIndex);
  if (onFrame.length === 0) return null;
  return (
    <svg
      data-testid="video-issue-layer"
      viewBox={`0 0 1 ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className={styles.layer}
    >
      {onFrame.map((issue) => {
        const x = issue.anchor_position!.x;
        const y = issue.anchor_position!.y * viewBoxHeight;
        const color = STATUS_VAR[issue.status] ?? STATUS_VAR.open;
        const isHighlight = highlightId === issue.id;
        return (
          <g key={issue.id} data-testid={`video-issue-pin-${issue.id}`}>
            <circle
              cx={x}
              cy={y}
              r={0.012}
              fill={color}
              stroke="var(--color-bg-elev)"
              strokeWidth={isHighlight ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
              className={styles.pin}
              onClick={(e) => {
                e.stopPropagation();
                onPinClick?.(issue.id);
              }}
            />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={0.014}
              fontWeight="bold"
              fill="var(--color-bg-elev)"
              className={styles.label}
            >
              i
            </text>
          </g>
        );
      })}
    </svg>
  );
}
