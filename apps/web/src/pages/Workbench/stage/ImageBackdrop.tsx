import { Icon } from "@/components/ui/Icon";

export function ImageBackdrop({ url, onRetry }: { url: string | null; onRetry?: () => void }) {
  if (url) {
    return (
      <img
        src={url}
        alt="task"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        draggable={false}
      />
    );
  }
  return (
    <div
      style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
        color: "var(--color-fg-subtle)", background: "var(--color-bg-sunken)",
      }}
    >
      <Icon name="warning" size={32} />
      <div style={{ fontSize: 13 }}>图像不可用</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            fontSize: 12, padding: "4px 10px",
            background: "var(--color-bg-elev)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer", color: "var(--color-fg-muted)",
          }}
        >
          重试
        </button>
      )}
    </div>
  );
}
