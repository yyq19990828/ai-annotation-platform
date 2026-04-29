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
