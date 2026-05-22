import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import styles from "./Modal.module.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: number;
  children: ReactNode;
}

export function Modal({ open, onClose, title, width = 560, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    dialogRef.current?.style.setProperty("--modal-width", `${width}px`);
  }, [open, width]);

  if (!open) return null;

  return createPortal(
    <div onClick={onClose} className={styles.overlay}>
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className={styles.dialog}
      >
        {title !== undefined && (
          <div className={styles.header}>
            <div className={styles.title}>{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className={styles.closeButton}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
