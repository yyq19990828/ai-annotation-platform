import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

import { useElementStyle } from "@/components/ui/useElementStyle";
import styles from "./UserPicker.module.css";

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
  const popoverRef = useElementStyle<HTMLDivElement>(
    {
      "--user-picker-left": anchor.left,
      "--user-picker-top": anchor.top,
    } as React.CSSProperties,
    listRef,
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 8);
    return options
      .filter((o) => o.name.toLowerCase().includes(q) || (o.email ?? "").toLowerCase().includes(q))
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
    <div ref={popoverRef} role="listbox" aria-label="选择用户" className={styles.popover}>
      {filtered.length === 0 ? (
        <div className={styles.empty}>{query ? `无匹配 "${query}"` : "无项目成员"}</div>
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
            className={clsx(styles.option, i === active && styles.optionActive)}
          >
            <span className={styles.name}>{o.name}</span>
            {(o.email || o.hint) && <span className={styles.hint}>{o.email ?? o.hint}</span>}
          </div>
        ))
      )}
    </div>,
    document.body,
  );
}
