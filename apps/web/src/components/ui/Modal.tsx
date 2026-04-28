import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: number;
  children: ReactNode;
}

export function Modal({ open, onClose, title, width = 560, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.4)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "calc(100vh - 48px)",
          background: "var(--color-bg-elev)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {title !== undefined && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg)" }}>{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--color-fg-muted)",
                padding: 4,
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div style={{ overflowY: "auto", padding: "16px 18px" }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
