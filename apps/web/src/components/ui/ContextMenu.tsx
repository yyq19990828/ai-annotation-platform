import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import type { DropdownItem } from "./DropdownMenu";
import styles from "./ContextMenu.module.css";

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: DropdownItem[];
  onClose: () => void;
}

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState({ x: false, y: false });

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (evt: MouseEvent) => {
      if (!menuRef.current?.contains(evt.target as Node)) onClose();
    };
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setFlip({
      x: x + rect.width > window.innerWidth,
      y: y + rect.height > window.innerHeight,
    });
  }, [items, open, x, y]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      tabIndex={-1}
      className={[
        styles.panel,
        flip.x && styles.flipX,
        flip.y && styles.flipY,
      ].filter(Boolean).join(" ")}
      // eslint-disable-next-line no-restricted-syntax -- 坐标锚点是一次性动态值，经 CSS custom property 交给 CSS module 使用
      style={{
        "--context-menu-x": `${x}px`,
        "--context-menu-y": `${y}px`,
      } as CSSProperties}
    >
      {items.map((item, index) => {
        if (item.divider) {
          return (
            <div
              key={item.id || `div-${index}`}
              role="separator"
              className={styles.divider}
            />
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose();
            }}
            className={[
              styles.item,
              item.active && styles.itemActive,
              item.disabled && styles.itemDisabled,
            ].filter(Boolean).join(" ")}
          >
            {item.icon && <Icon name={item.icon} size={13} />}
            <span className={styles.itemLabel}>{item.label}</span>
            {item.kbd && (
              <span className={`mono ${styles.kbd}`}>
                {item.kbd}
              </span>
            )}
            {item.active && !item.kbd && (
              <Icon name="check" size={12} className={styles.checkIcon} />
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
