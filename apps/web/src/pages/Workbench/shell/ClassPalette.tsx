import { useEffect, useMemo, useRef, useState } from "react";
import type { ClassesConfig } from "@/api/projects";
import { classColor } from "../stage/colors";

interface ClassPaletteProps {
  classes: string[];
  recent?: string[];
  activeClass?: string | null;
  /** v0.5.4：项目级 classes_config，决定每个类别的颜色覆盖。空时回落 hash。 */
  classesConfig?: ClassesConfig;
  /** readOnly 时点击无效，仅作为图例 + 快捷键速查（左侧常驻面板用）。 */
  onPick?: (cls: string) => void;
  /** 是否启用搜索框（默认：类别 > 9 时自动启用） */
  enableSearch?: boolean;
  /** 高亮第 N 个（用于键盘导航；undefined = 跟随 activeClass） */
  highlightIndex?: number;
  /** 紧凑模式（popover 内使用） */
  dense?: boolean;
  /** 纯预览模式：行不响应点击；hover 不变色；鼠标 default。 */
  readOnly?: boolean;
}

const SHORTCUT_LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** 1-9 数字键 + a-z 字母键依次映射到 classes 列表。 */
export function shortcutForIndex(idx: number): string {
  if (idx < 9) return String(idx + 1);
  const letterIdx = idx - 9;
  if (letterIdx < SHORTCUT_LETTERS.length) return SHORTCUT_LETTERS[letterIdx].toUpperCase();
  return "";
}

export function ClassPalette({
  classes, recent = [], activeClass, classesConfig, onPick,
  enableSearch, highlightIndex, dense = false, readOnly = false,
}: ClassPaletteProps) {
  const handlePick = (c: string) => {
    if (readOnly) return;
    onPick?.(c);
  };
  const [query, setQuery] = useState("");
  const showSearch = enableSearch ?? classes.length > 9;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(""); }, [classes]);

  const filtered = useMemo(() => {
    if (!query.trim()) return classes;
    const q = query.toLowerCase();
    return classes.filter((c) => c.toLowerCase().includes(q));
  }, [classes, query]);

  // recent 只展示当前项目存在的类别
  const visibleRecent = useMemo(
    () => recent.filter((c) => classes.includes(c)).slice(0, 5),
    [recent, classes],
  );

  const rowPad = dense ? "4px 8px" : "5px 8px";
  const gap = dense ? 6 : 8;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dense ? 6 : 8 }}>
      {showSearch && (
        <input
          ref={inputRef}
          autoFocus={dense}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索类别..."
          style={{
            padding: "5px 8px",
            fontSize: 12,
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-bg)",
            outline: "none",
          }}
        />
      )}

      {visibleRecent.length > 0 && !query.trim() && (
        <div>
          <div style={{ fontSize: 10, color: "var(--color-fg-subtle)", marginBottom: 4, letterSpacing: 0.5 }}>
            最近使用
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {visibleRecent.map((c) => (
              <button
                key={`recent-${c}`}
                type="button"
                onClick={readOnly ? undefined : () => handlePick(c)}
                disabled={readOnly}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 7px",
                  fontSize: 11.5,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  borderRadius: 12,
                  cursor: readOnly ? "default" : "pointer",
                  color: "var(--color-fg)",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: classColor(c, classesConfig) }} />
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {filtered.map((c) => {
          const idx = classes.indexOf(c);
          const sk = shortcutForIndex(idx);
          const isActive = activeClass === c;
          const isHighlighted = typeof highlightIndex === "number" && filtered.indexOf(c) === highlightIndex;
          return (
            <div
              key={c}
              onClick={readOnly ? undefined : () => handlePick(c)}
              style={{
                display: "flex", alignItems: "center", gap,
                padding: rowPad, borderRadius: "var(--radius-sm)",
                cursor: readOnly ? "default" : "pointer",
                background: isHighlighted
                  ? "var(--color-accent-soft)"
                  : !readOnly && isActive ? "var(--color-bg-sunken)" : "transparent",
                fontSize: 12.5,
                border: "1px solid " + (isHighlighted ? "oklch(0.85 0.06 252)" : "transparent"),
                opacity: readOnly ? 0.92 : 1,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: classColor(c, classesConfig) }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</span>
              {sk && (
                <span style={{
                  display: "inline-block", padding: "1px 5px",
                  background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
                  borderBottomWidth: 2, borderRadius: 3,
                  fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-fg-muted)", lineHeight: 1,
                }}>{sk}</span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)", padding: "8px 4px", textAlign: "center" }}>
            没有匹配的类别
          </div>
        )}
      </div>
    </div>
  );
}
