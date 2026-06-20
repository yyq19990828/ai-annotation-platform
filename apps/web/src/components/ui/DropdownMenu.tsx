import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "./Icon";

/**
 * v0.17.2:module.css → Tailwind。逻辑/定位/键盘/a11y 一律不动(已等价 Radix);仅把 className
 * 换成 Tailwind,面板位置/尺寸沿用 imperative CSS 变量(--dropdown-*),用 Tailwind 任意值消费。
 * item 是 portal 内原生 <button>,加 appearance-none 防 UA 默认样式漏出。
 */

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

const UNITLESS_STYLE_PROPS = new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "boxFlex",
  "boxFlexGroup",
  "boxOrdinalGroup",
  "columnCount",
  "columns",
  "flex",
  "flexGrow",
  "flexPositive",
  "flexShrink",
  "flexNegative",
  "flexOrder",
  "gridArea",
  "gridRow",
  "gridRowEnd",
  "gridRowSpan",
  "gridRowStart",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnSpan",
  "gridColumnStart",
  "fontWeight",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
]);

function cssPropertyName(key: string) {
  if (key.startsWith("--")) return key;
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function cssPropertyValue(key: string, value: string | number) {
  if (typeof value === "number" && value !== 0 && !UNITLESS_STYLE_PROPS.has(key)) {
    return `${value}px`;
  }
  return String(value);
}

function syncDomStyles(
  node: HTMLElement | null,
  next: CSSProperties | undefined,
  prev: MutableRefObject<CSSProperties | undefined>,
) {
  if (!node) return;
  for (const key of Object.keys(prev.current ?? {})) {
    if (!next || !(key in next)) node.style.removeProperty(cssPropertyName(key));
  }
  for (const [key, value] of Object.entries(next ?? {})) {
    const name = cssPropertyName(key);
    if (value === undefined || value === null) node.style.removeProperty(name);
    else node.style.setProperty(name, cssPropertyValue(key, value as string | number));
  }
  prev.current = next;
}

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
  const prevHostStyleRef = useRef<CSSProperties | undefined>(undefined);
  const prevPanelStyleRef = useRef<CSSProperties | undefined>(undefined);
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
      const target = e.target as Node;
      if (
        !hostRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
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

  useLayoutEffect(() => {
    syncDomStyles(hostRef.current, hostStyle, prevHostStyleRef);
  }, [hostStyle]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    menu.style.setProperty("--dropdown-min-width", `${minWidth}px`);
    menu.style.setProperty("--dropdown-z-index", String(zIndex));
    menu.style.setProperty("--dropdown-padding", disablePanelPadding ? "0" : "4px");
    syncDomStyles(menu, panelStyle, prevPanelStyleRef);
    // `open` 必须入依赖：面板挂载在 createPortal 里、且 open 是组件内部 state，
    // 切换 open 不会改变父级传入的 panelStyle 引用。若不依赖 open，重新打开时
    // 这个 effect 不会重跑，新挂载的面板节点拿不到 panelStyle（如 width），
    // 直到某次父级重渲染（轮询）恰好刷新 panelStyle 引用才补上 —— 表现为面板尺寸忽大忽小。
  }, [disablePanelPadding, minWidth, panelStyle, zIndex, open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const triggerNode = triggerRef.current;
      const menuNode = menuRef.current;
      if (!triggerNode || !menuNode) return;

      const triggerRect = triggerNode.getBoundingClientRect();
      const menuWidth = menuNode.offsetWidth || minWidth;
      const menuHeight = menuNode.offsetHeight;
      const margin = 8;
      const gap = 4;

      let left = align === "start"
        ? triggerRect.left
        : triggerRect.right - menuWidth;
      left = Math.max(
        margin,
        Math.min(left, window.innerWidth - margin - menuWidth),
      );

      let top = triggerRect.bottom + gap;
      const flippedTop = triggerRect.top - gap - menuHeight;
      if (
        menuHeight > 0 &&
        top + menuHeight > window.innerHeight - margin &&
        flippedTop >= margin
      ) {
        top = flippedTop;
      }
      if (menuHeight > 0) {
        top = Math.min(top, window.innerHeight - margin - menuHeight);
      }
      top = Math.max(margin, top);

      menuNode.style.setProperty("--dropdown-left", `${left}px`);
      menuNode.style.setProperty("--dropdown-top", `${top}px`);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, minWidth, open]);

  const menuPanel = open ? (
    <div
      ref={menuRef}
      role={items ? "menu" : "dialog"}
      aria-orientation={items ? "vertical" : undefined}
      tabIndex={-1}
      onKeyDown={onMenuKey}
      className="fixed left-[var(--dropdown-left)] top-[var(--dropdown-top)] z-[var(--dropdown-z-index)] min-w-[var(--dropdown-min-width)] rounded-md border border-border bg-popover p-[var(--dropdown-padding)] shadow-md outline-none"
    >
      {content
        ? content({ close })
        : items?.map((it, i) => {
            if (it.divider) {
              return (
                <div
                  key={it.id || `div-${i}`}
                  role="separator"
                  className="my-1 h-px bg-border"
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
                className={cn(
                  "flex w-full appearance-none items-center gap-2 rounded-sm border-0 bg-transparent px-2.5 py-2 text-left text-sm font-normal text-muted-foreground",
                  (it.active || focused) && "bg-accent",
                  it.active && "font-semibold text-foreground",
                  it.disabled && "cursor-not-allowed text-muted-foreground/60 opacity-60",
                )}
              >
                {it.icon && <Icon name={it.icon} size={13} />}
                <span className="flex-1">{it.label}</span>
                {it.kbd && (
                  <span className="mono rounded border border-b-2 border-border bg-muted px-1.5 py-px text-2xs text-muted-foreground">
                    {it.kbd}
                  </span>
                )}
                {it.active && !it.kbd && (
                  <Icon name="check" size={12} className="text-brand" />
                )}
              </button>
            );
          })}
      {footer}
    </div>
  ) : null;

  return (
    <div ref={hostRef} className="inline-flex">
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        close,
        ref: triggerRef,
      })}
      {menuPanel && createPortal(menuPanel, document.body)}
    </div>
  );
}
