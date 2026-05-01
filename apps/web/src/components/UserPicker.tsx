import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface UserPickerOption {
  id: string;
  name: string;
  email?: string | null;
  hint?: string;
}

interface UserPickerProps {
  /** 视口绝对坐标（建议传光标处屏幕坐标）。 */
  anchor: { left: number; top: number };
  /** 候选项；多由调用方按当前 query 过滤后传入。 */
  options: UserPickerOption[];
  /** 当前过滤词，用于显示「无匹配」提示。 */
  query: string;
  onPick: (opt: UserPickerOption) => void;
  onClose: () => void;
}

/** 受控浮层：列表 + ↑↓ Home End + Enter 选中 + Esc 关闭。
 *  与 CommentInput 配合：在 contenteditable 中输入 `@` 触发，输入 query 实时过滤。 */
export function UserPicker({ anchor, options, query, onPick, onClose }: UserPickerProps) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 8);
    return options
      .filter((o) =>
        o.name.toLowerCase().includes(q) ||
        (o.email ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [options, query]);

  useEffect(() => {
    setActive(0);
  }, [query, options.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActive(Math.max(0, filtered.length - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered[active]) {
          e.preventDefault();
          onPick(filtered[active]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // capture 阶段：保证比文档上其它 keydown 先处理
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filtered, active, onPick, onClose]);

  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      aria-label="选择用户"
      style={{
        position: "fixed",
        left: anchor.left,
        top: anchor.top,
        zIndex: 80,
        minWidth: 200,
        maxHeight: 240,
        overflowY: "auto",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        padding: 4,
      }}
    >
      {filtered.length === 0 ? (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-fg-muted)" }}>
          {query ? `无匹配 "${query}"` : "无项目成员"}
        </div>
      ) : (
        filtered.map((o, i) => (
          <div
            key={o.id}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(o);
            }}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 3,
              cursor: "pointer",
              background: i === active ? "oklch(0.55 0.18 250 / 0.15)" : "transparent",
              color: "var(--color-fg)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontWeight: 500 }}>{o.name}</span>
            {(o.email || o.hint) && (
              <span style={{ fontSize: 10.5, color: "var(--color-fg-muted)" }}>
                {o.email ?? o.hint}
              </span>
            )}
          </div>
        ))
      )}
    </div>,
    document.body,
  );
}
