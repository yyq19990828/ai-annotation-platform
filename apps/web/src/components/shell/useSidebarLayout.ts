import { useEffect, useState } from "react";

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;
export const SIDEBAR_COLLAPSED = 56;
const STORAGE_KEY = "anno.sidebar-layout";
export const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number.isFinite(width) ? width : 220));

export function useSidebarLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      return {
        width: clampSidebarWidth(saved?.width ?? 220),
        collapsed: saved?.collapsed === true,
      };
    } catch {
      return { width: 220, collapsed: false };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, [layout]);
  return { ...layout, setLayout };
}
