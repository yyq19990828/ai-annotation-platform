import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

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
  const tooltipRef = useRef<HTMLDivElement | null>(null);
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

  useLayoutEffect(() => {
    if (!open || !pos) return;
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    tooltip.style.setProperty("--tooltip-top", `${pos.top}px`);
    tooltip.style.setProperty("--tooltip-left", `${pos.left}px`);
  }, [open, pos]);

  return (
    <>
      {cloned}
      {open && pos && createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`${styles.tooltip} ${styles[side]}`}
        >
          <div className={styles.name}>{name}</div>
          {desc && (
            <div className={styles.desc}>{desc}</div>
          )}
          {hotkey && (
            <div className={styles.hotkeyRow}>
              {hotkey.split(/\s+/).map((k, i) => (
                <kbd key={i} className={styles.kbd}>
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
