import { Icon } from "@/components/ui/Icon";

interface FloatingDockProps {
  scale: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

/**
 * 画布右下角悬浮工具岛（v0.5.3）。
 * 承载撤销 / 重做 / 缩放-100%-放大 / 适应。
 * 与 Konva viewport 贴合，不占 Topbar 横向空间。
 */
export function FloatingDock({
  scale, canUndo, canRedo, onUndo, onRedo, onZoomIn, onZoomOut, onFit,
}: FloatingDockProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: 12, bottom: 12,
        display: "flex", alignItems: "center", gap: 2,
        padding: 4,
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        zIndex: 14,
        userSelect: "none",
      }}
    >
      <DockButton onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
        <Icon name="chevLeft" size={13} />
      </DockButton>
      <DockButton onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">
        <Icon name="chevRight" size={13} />
      </DockButton>
      <Sep />
      <DockButton onClick={onZoomOut} title="缩小">
        <Icon name="zoomOut" size={13} />
      </DockButton>
      <span
        className="mono"
        style={{ minWidth: 42, textAlign: "center", fontSize: 11.5, color: "var(--color-fg-muted)" }}
      >
        {Math.round(scale * 100)}%
      </span>
      <DockButton onClick={onZoomIn} title="放大">
        <Icon name="zoomIn" size={13} />
      </DockButton>
      <DockButton onClick={onFit} title="适应视口（双击空白）" style={{ fontSize: 11, padding: "0 8px" }}>
        适应
      </DockButton>
    </div>
  );
}

interface DockButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
function DockButton({ onClick, disabled, title, children, style }: DockButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 26,
        minWidth: 26,
        padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent",
        color: disabled ? "var(--color-fg-faint)" : "var(--color-fg-muted)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--color-bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 16, background: "var(--color-border)", margin: "0 2px" }} />;
}
