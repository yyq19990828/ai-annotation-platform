import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon, type IconName } from "./Icon";

export interface DropdownItem {
  /** 唯一 id，作为 React key */
  id: string;
  /** 显示文本 */
  label: ReactNode;
  /** 左侧 icon */
  icon?: IconName;
  /** 右侧快捷键徽章（如 "N" / "?"） */
  kbd?: string;
  /** 选中态（尾部加 check，背景 sunken） */
  active?: boolean;
  /** 项被选中时回调；同时菜单自动关闭 */
  onSelect?: () => void;
  /** true = 渲染为分隔线（其它字段忽略） */
  divider?: boolean;
  /** 禁用 */
  disabled?: boolean;
}

interface DropdownMenuBaseProps {
  /** 触发器 render —— 接收 `open` 状态用于切换样式（按钮按下高亮）。 */
  trigger: (ctx: { open: boolean; toggle: () => void; close: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  /** 菜单对齐：默认 "end"（右对齐 trigger）。 */
  align?: "start" | "end";
  /** 触发器宿主上的额外样式（默认 inline-block + relative）。 */
  hostStyle?: CSSProperties;
  /** 菜单宽度，默认 180px。 */
  minWidth?: number;
  /** 菜单 z-index，默认 30。 */
  zIndex?: number;
  /** 面板根 style 覆盖（用于 NotificationsPopover 这类需要更宽 / 自管 padding 的场景）。 */
  panelStyle?: CSSProperties;
  /** 是否禁用面板默认 padding（content 模式下，自定义内容自管 padding 时设 true）。 */
  disablePanelPadding?: boolean;
}

interface DropdownMenuItemsProps extends DropdownMenuBaseProps {
  items: DropdownItem[];
  content?: never;
  footer?: ReactNode;
}

interface DropdownMenuContentProps extends DropdownMenuBaseProps {
  items?: never;
  /** v0.9.3 · 自定义内容槽（与 items 互斥）。ctx.close 用于业务确认后主动关闭面板。 */
  content: (ctx: { close: () => void }) => ReactNode;
  footer?: never;
}

type DropdownMenuProps = DropdownMenuItemsProps | DropdownMenuContentProps;

/**
 * 通用 dropdown 菜单（v0.5.5 phase 2；v0.9.3 加 content 槽）：
 * - outside-mousedown / Esc 关闭；
 * - items 模式：子项 ↑↓ Home End 键盘导航 + role="menu" / "menuitem"；
 * - content 模式：自由 ReactNode（form / 列表等），仅保留 outside-click + Esc。
 */
export function DropdownMenu(props: DropdownMenuProps) {
  const {
    trigger,
    align = "end",
    hostStyle,
    minWidth = 180,
    zIndex = 30,
    panelStyle,
    disablePanelPadding,
  } = props;
  const items = "items" in props ? props.items : undefined;
  const content = "content" in props ? props.content : undefined;
  const footer = "footer" in props ? props.footer : undefined;

  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(-1);

  const selectableIdx = items
    ? items
        .map((it, i) => (!it.divider && !it.disabled ? i : -1))
        .filter((i) => i >= 0)
    : [];

  // 点外面 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!hostRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // items 模式：打开时聚焦 active 项 / 第一项
  useEffect(() => {
    if (!items) return;
    if (!open) {
      setFocusIdx(-1);
      return;
    }
    const activePos = items.findIndex((it) => it.active && !it.divider && !it.disabled);
    setFocusIdx(activePos >= 0 ? activePos : selectableIdx[0] ?? -1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveFocus = (dir: 1 | -1) => {
    if (selectableIdx.length === 0) return;
    const cur = selectableIdx.indexOf(focusIdx);
    const next = cur < 0 ? 0 : (cur + dir + selectableIdx.length) % selectableIdx.length;
    setFocusIdx(selectableIdx[next]);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!items) return; // content 模式不处理列表导航
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIdx(selectableIdx[0] ?? -1);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusIdx(selectableIdx[selectableIdx.length - 1] ?? -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const it = items[focusIdx];
      if (it && !it.divider && !it.disabled) {
        it.onSelect?.();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={hostRef} style={{ position: "relative", display: "inline-flex", ...hostStyle }}>
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        close,
        ref: triggerRef,
      })}
      {open && (
        <div
          ref={menuRef}
          role={items ? "menu" : "dialog"}
          aria-orientation={items ? "vertical" : undefined}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            [align === "start" ? "left" : "right"]: 0,
            minWidth,
            padding: disablePanelPadding ? 0 : 4,
            background: "var(--color-bg-elev)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md, 0 8px 24px rgba(0,0,0,0.12))",
            zIndex,
            outline: "none",
            ...panelStyle,
          }}
        >
          {content
            ? content({ close })
            : items?.map((it, i) => {
                if (it.divider) {
                  return (
                    <div
                      key={it.id || `div-${i}`}
                      role="separator"
                      style={{
                        height: 1,
                        background: "var(--color-border)",
                        margin: "4px 0",
                      }}
                    />
                  );
                }
                const focused = focusIdx === i;
                return (
                  <button
                    key={it.id}
                    type="button"
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={() => {
                      if (it.disabled) return;
                      it.onSelect?.();
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    onMouseEnter={() => setFocusIdx(i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "7px 10px",
                      background:
                        it.active || focused ? "var(--color-bg-sunken)" : "transparent",
                      border: "none",
                      borderRadius: "var(--radius-sm, 3px)",
                      cursor: it.disabled ? "not-allowed" : "pointer",
                      textAlign: "left",
                      fontSize: 12.5,
                      color: it.disabled
                        ? "var(--color-fg-subtle)"
                        : it.active
                        ? "var(--color-fg)"
                        : "var(--color-fg-muted)",
                      fontWeight: it.active ? 600 : 400,
                      fontFamily: "inherit",
                      opacity: it.disabled ? 0.6 : 1,
                    }}
                  >
                    {it.icon && <Icon name={it.icon} size={13} />}
                    <span style={{ flex: 1 }}>{it.label}</span>
                    {it.kbd && (
                      <span
                        className="mono"
                        style={{
                          padding: "1px 5px",
                          background: "var(--color-bg-sunken)",
                          border: "1px solid var(--color-border)",
                          borderBottomWidth: 2,
                          borderRadius: 3,
                          fontSize: 10.5,
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        {it.kbd}
                      </span>
                    )}
                    {it.active && !it.kbd && (
                      <Icon name="check" size={12} style={{ color: "var(--color-accent)" }} />
                    )}
                  </button>
                );
              })}
          {footer}
        </div>
      )}
    </div>
  );
}
