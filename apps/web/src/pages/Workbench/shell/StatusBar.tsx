import { Icon } from "@/components/ui/Icon";
import type { ReconnectState } from "@/hooks/useReconnectingWebSocket";
import { formatDuration } from "../state/useSessionStats";

interface PreannotationProgress {
  current: number;
  total: number;
  status: string;
}

interface StatusBarProps {
  userBoxesCount: number;
  aiBoxesCount: number;
  activeClass: string;
  imageWidth: number | null;
  imageHeight: number | null;
  cursor: { x: number; y: number } | null;
  preannotationProgress: PreannotationProgress | null;
  preannotationConn: ReconnectState;
  preannotationRetries: number;
  /** 本会话每题平均耗时（毫秒）。null = 样本 < 10。 */
  avgLeadMs?: number | null;
  /** 剩余题数（用于 ETA 计算）。 */
  remainingTaskCount?: number;
}

export function StatusBar({
  userBoxesCount, aiBoxesCount, activeClass,
  imageWidth, imageHeight, cursor,
  preannotationProgress, preannotationConn, preannotationRetries,
  avgLeadMs, remainingTaskCount,
}: StatusBarProps) {
  const dimText = imageWidth && imageHeight ? `${imageWidth}×${imageHeight}` : "—";
  const cursorText = cursor && imageWidth && imageHeight
    ? `(${Math.round(cursor.x * imageWidth)}, ${Math.round(cursor.y * imageHeight)})`
    : null;
  const etaText = avgLeadMs && remainingTaskCount && remainingTaskCount > 0
    ? `${formatDuration(avgLeadMs)}/题 · 剩 ${remainingTaskCount} · 约 ${formatDuration(avgLeadMs * remainingTaskCount)}`
    : avgLeadMs ? `${formatDuration(avgLeadMs)}/题` : "—";

  return (
    <div
      style={{
        padding: "6px 14px",
        background: "var(--color-bg-elev)", borderTop: "1px solid var(--color-border)",
        display: "flex", justifyContent: "space-between",
        fontSize: 11.5, color: "var(--color-fg-muted)",
      }}
    >
      <div style={{ display: "flex", gap: 16 }}>
        <span><span className="mono">{userBoxesCount}</span> 已确认</span>
        <span>
          <Icon name="sparkles" size={11} style={{ color: "var(--color-ai)", verticalAlign: "-2px" }} />
          {" "}<span className="mono">{aiBoxesCount}</span> AI 待审
        </span>
        <span>当前类别: <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{activeClass}</span></span>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <span title="本会话单题平均耗时与剩余 ETA（&lt; 10 题样本时显示 —）">
          ETA <span className="mono">{etaText}</span>
        </span>
        <span>分辨率 <span className="mono">{dimText}</span></span>
        {cursorText && (
          <span>光标 <span className="mono">{cursorText}</span></span>
        )}
        {preannotationProgress && (
          <span style={{ color: "var(--color-ai)" }}>
            预标注 {preannotationProgress.current}/{preannotationProgress.total}
          </span>
        )}
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: preannotationConn === "open" ? "oklch(0.65 0.18 142)"
              : preannotationConn === "reconnecting" ? "oklch(0.75 0.18 75)"
              : "oklch(0.65 0.05 0)",
            flexShrink: 0,
          }} />
          {preannotationConn === "open" && "实时同步"}
          {preannotationConn === "reconnecting" && `重连中… (${preannotationRetries})`}
          {preannotationConn === "failed" && "实时进度暂停"}
        </span>
      </div>
    </div>
  );
}
