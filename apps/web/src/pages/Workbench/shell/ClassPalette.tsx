import { useEffect, useMemo, useRef, useState } from "react";
import type { ClassesConfig } from "@/api/projects";
import { classColor } from "../stage/colors";
import styles from "./ClassPalette.module.css";

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

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

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

  return (
    <div className={cn(styles.palette, dense && styles.paletteDense)}>
      {showSearch && (
        <input
          ref={inputRef}
          autoFocus={dense}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索类别..."
          className={styles.searchInput}
        />
      )}

      {visibleRecent.length > 0 && !query.trim() && (
        <div>
          <div className={styles.recentTitle}>
            最近使用
          </div>
          <div className={styles.recentList}>
            {visibleRecent.map((c) => (
              <button
                key={`recent-${c}`}
                type="button"
                onClick={readOnly ? undefined : () => handlePick(c)}
                disabled={readOnly}
                className={cn(styles.recentButton, readOnly && styles.readOnly)}
              >
                <svg className={styles.recentSwatch} viewBox="0 0 8 8" aria-hidden="true">
                  <rect width="8" height="8" rx="2" fill={classColor(c, classesConfig)} />
                </svg>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.classList}>
        {filtered.map((c) => {
          const idx = classes.indexOf(c);
          const sk = shortcutForIndex(idx);
          const isActive = activeClass === c;
          const isHighlighted = typeof highlightIndex === "number" && filtered.indexOf(c) === highlightIndex;
          return (
            <div
              key={c}
              onClick={readOnly ? undefined : () => handlePick(c)}
              className={cn(
                styles.classRow,
                dense && styles.classRowDense,
                readOnly && styles.classRowReadOnly,
                !readOnly && isActive && styles.classRowActive,
                isHighlighted && styles.classRowHighlighted,
              )}
            >
              <svg className={styles.classSwatch} viewBox="0 0 10 10" aria-hidden="true">
                <rect width="10" height="10" rx="2" fill={classColor(c, classesConfig)} />
              </svg>
              <span className={styles.className}>{c}</span>
              {sk && (
                <span className={styles.shortcut}>{sk}</span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className={styles.emptyState}>
            没有匹配的类别
          </div>
        )}
      </div>
    </div>
  );
}
