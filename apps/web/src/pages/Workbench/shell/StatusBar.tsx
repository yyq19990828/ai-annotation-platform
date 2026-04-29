import { Icon } from "@/components/ui/Icon";
import type { ReconnectState } from "@/hooks/useReconnectingWebSocket";

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
}

export function StatusBar({
  userBoxesCount, aiBoxesCount, activeClass,
  imageWidth, imageHeight, cursor,
  preannotationProgress, preannotationConn, preannotationRetries,
}: StatusBarProps) {
  const dimText = imageWidth && imageHeight ? `${imageWidth}×${imageHeight}` : "—";
  const cursorText = cursor && imageWidth && imageHeight
    ? `(${Math.round(cursor.x * imageWidth)}, ${Math.round(cursor.y * imageHeight)})`
    : null;

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
        <span>分辨率 <span className="mono">{dimText}</span></span>
        {cursorText && (
          <span>光标 <span className="mono">{cursorText}</span></span>
        )}
        {preannotationProgress && (
          <span style={{ color: "var(--color-ai)" }}>
            预标注 {preannotationProgress.current}/{preannotationProgress.total}
          </span>
        )}
        {preannotationConn === "reconnecting" && (
          <span style={{ color: "var(--color-warning, #b45309)" }}>
            AI 通道重连中… ({preannotationRetries})
          </span>
        )}
        {preannotationConn === "failed" && (
          <span style={{ color: "var(--color-danger, #b91c1c)" }}>
            AI 通道断开
          </span>
        )}
      </div>
    </div>
  );
}
