import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

const STORAGE_KEY = "anno.theme";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* SSR / private mode */ }
  return "system";
}

function systemResolved(): Resolved {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: Resolved) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

/**
 * 主题切换（v0.5.3）。
 * - 用户偏好持久化到 localStorage
 * - 'system' 模式跟随 prefers-color-scheme，并监听变更
 * - 写 <html data-theme="..."> 触发 tokens.css 暗色块覆盖
 *
 * 启动时建议在 main.tsx 内调用 initThemeFromStorage()，避免 first paint 闪烁。
 */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(() => readPref());
  const [resolved, setResolved] = useState<Resolved>(() =>
    pref === "system" ? systemResolved() : pref,
  );

  // pref 变化 → 写存储 + 重算 resolved
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* ignore */ }
    const r = pref === "system" ? systemResolved() : pref;
    setResolved(r);
    applyTheme(r);
  }, [pref]);

  // 'system' 模式下监听 OS 主题变化
  useEffect(() => {
    if (pref !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r: Resolved = mql.matches ? "dark" : "light";
      setResolved(r);
      applyTheme(r);
    };
    // 兼容 Safari 旧版（addListener）
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    return undefined;
  }, [pref]);

  const setTheme = useCallback((next: ThemePref) => setPrefState(next), []);

  return { theme: pref, resolved, setTheme };
}

/** 启动时从 localStorage 应用初始主题，避免 paint flash。 */
export function initThemeFromStorage(): Resolved {
  const pref = readPref();
  const resolved: Resolved = pref === "system" ? systemResolved() : pref;
  applyTheme(resolved);
  return resolved;
}
