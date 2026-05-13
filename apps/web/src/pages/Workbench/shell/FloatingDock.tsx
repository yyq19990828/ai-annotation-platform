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
  showHistory?: boolean;
}

/**
 * 画布右下角悬浮工具岛（v0.5.3）。
 * 承载撤销 / 重做 / 缩放-100%-放大 / 适应。
 * 与 Konva viewport 贴合，不占 Topbar 横向空间。
 */
export function FloatingDock({
  scale, canUndo, canRedo, onUndo, onRedo, onZoomIn, onZoomOut, onFit, showHistory = true,
}: FloatingDockProps) {
  return (
    <div
      style={{
        position: "absolute",
        right: 12, bottom: 12,
        display: "flex", alignItems: "center", gap: 2,
        padding: 5,
        background: "color-mix(in oklab, var(--color-bg-elev) 92%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        zIndex: 14,
        userSelect: "none",
      }}
    >
      {showHistory && (
        <>
          <DockButton onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
            <Icon name="chevLeft" size={14} />
          </DockButton>
          <DockButton onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">
            <Icon name="chevRight" size={14} />
          </DockButton>
          <Sep />
        </>
      )}
      <DockButton onClick={onZoomOut} title="缩小">
        <Icon name="zoomOut" size={14} />
      </DockButton>
      <span
        className="mono"
        style={{
          minWidth: 46, textAlign: "center", fontSize: 12.5, fontWeight: 500,
          color: "var(--color-fg)",
          letterSpacing: 0.2,
        }}
      >
        {Math.round(scale * 100)}%
      </span>
      <DockButton onClick={onZoomIn} title="放大">
        <Icon name="zoomIn" size={14} />
      </DockButton>
      <Sep />
      <DockButton onClick={onFit} title="适应视口（双击空白）" style={{ fontSize: 11.5, padding: "0 10px", fontWeight: 500 }}>
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
        height: 28,
        minWidth: 28,
        padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent",
        color: disabled ? "var(--color-fg-faint)" : "var(--color-fg)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: disabled ? "default" : "pointer",
        transition: "background 0.12s",
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
