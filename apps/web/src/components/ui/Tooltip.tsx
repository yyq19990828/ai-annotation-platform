import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Side = "right" | "left" | "top" | "bottom";

interface TooltipProps {
  /** 主标题（粗体首行）。 */
  name: ReactNode;
  /** 描述（次行，灰）。 */
  desc?: ReactNode;
  /** hotkey 徽（kbd 样式末行；多键用空格分隔，如 "Ctrl Z"）。 */
  hotkey?: string;
  /** 显示位置（默认 right，主工具栏在左侧时弹右）。 */
  side?: Side;
  /** hover 触发延迟 ms（默认 200）。 */
  delay?: number;
  /**
   * 子元素必须是单个 ReactElement（如 <button>），用于附加 ref + 事件。
   * 不会改变子元素的渲染层级，仅在子元素旁边 portal 出 tooltip。
   */
  children: ReactElement;
}

/**
 * 轻量级 Tooltip — 用 portal + 绝对定位，不依赖 Floating UI。
 *
 * - hover/focus 触发；blur/leave/Esc 立即关闭
 * - 三行内容：name (粗) + desc (灰) + hotkey (kbd 徽)
 * - `aria-describedby` 自动接 children
 */
export function Tooltip({ name, desc, hotkey, side = "right", delay = 200, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const computePos = (rect: DOMRect) => {
    // 纸面中心的 8px 间隔；side 决定 anchor 位置
    const gap = 8;
    if (side === "right") return { top: rect.top + rect.height / 2, left: rect.right + gap };
    if (side === "left") return { top: rect.top + rect.height / 2, left: rect.left - gap };
    if (side === "top") return { top: rect.top - gap, left: rect.left + rect.width / 2 };
    return { top: rect.bottom + gap, left: rect.left + rect.width / 2 };
  };

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      setPos(computePos(el.getBoundingClientRect()));
      setOpen(true);
    }, delay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const childRef = (children as { ref?: React.Ref<HTMLElement> }).ref;
  const setRef = (node: HTMLElement | null) => {
    triggerRef.current = node;
    if (typeof childRef === "function") childRef(node);
    else if (childRef && typeof childRef === "object") {
      (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
    }
  };

  const cloned = cloneElement(children, {
    ref: setRef,
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      show();
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hide();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      // focus 立即显示，无延迟
      if (timerRef.current) clearTimeout(timerRef.current);
      const el = triggerRef.current;
      if (el) {
        setPos(computePos(el.getBoundingClientRect()));
        setOpen(true);
      }
      children.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      hide();
      children.props.onBlur?.(e);
    },
  } as Record<string, unknown>);

  const transform =
    side === "right" ? "translate(0, -50%)"
    : side === "left" ? "translate(-100%, -50%)"
    : side === "top" ? "translate(-50%, -100%)"
    : "translate(-50%, 0)";

  return (
    <>
      {cloned}
      {open && pos && createPortal(
        <div
          id={id}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform,
            zIndex: 1000,
            pointerEvents: "none",
            background: "var(--color-bg-elev)",
            color: "var(--color-fg)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            padding: "8px 10px",
            minWidth: 140,
            maxWidth: 240,
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--color-fg)" }}>{name}</div>
          {desc && (
            <div style={{ color: "var(--color-fg-muted)", marginTop: 2 }}>{desc}</div>
          )}
          {hotkey && (
            <div style={{ marginTop: 6, display: "flex", gap: 3, flexWrap: "wrap" }}>
              {hotkey.split(/\s+/).map((k, i) => (
                <kbd
                  key={i}
                  style={{
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 3,
                    padding: "1px 5px",
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    fontSize: 10.5,
                    color: "var(--color-fg-muted)",
                    minWidth: 14,
                    textAlign: "center",
                  }}
                >
                  {k}
                </kbd>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
