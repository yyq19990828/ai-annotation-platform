import { Icon } from "@/components/ui/Icon";
import styles from "./FloatingDock.module.css";

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
    <div className={styles.root}>
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
        className={`mono ${styles.scale}`}
      >
        {Math.round(scale * 100)}%
      </span>
      <DockButton onClick={onZoomIn} title="放大">
        <Icon name="zoomIn" size={14} />
      </DockButton>
      <Sep />
      <DockButton onClick={onFit} title="适应视口（双击空白）" variant="fit">
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
  variant?: "fit";
}
function DockButton({ onClick, disabled, title, children, variant }: DockButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        styles.button,
        disabled ? styles.buttonDisabled : "",
        variant === "fit" ? styles.buttonFit : "",
      ].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className={styles.separator} />;
}
