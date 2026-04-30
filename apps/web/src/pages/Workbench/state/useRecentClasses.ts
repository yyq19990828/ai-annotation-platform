import { useCallback, useEffect, useState } from "react";

const MAX_RECENT = 5;
const storageKey = (projectId: string | undefined) =>
  projectId ? `recent-classes:${projectId}` : null;

function readFromStorage(projectId: string | undefined): string[] {
  const key = storageKey(projectId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function useRecentClasses(projectId: string | undefined) {
  const [recent, setRecent] = useState<string[]>(() => readFromStorage(projectId));

  useEffect(() => {
    setRecent(readFromStorage(projectId));
  }, [projectId]);

  const record = useCallback((className: string) => {
    if (!className) return;
    setRecent((prev) => {
      const next = [className, ...prev.filter((c) => c !== className)].slice(0, MAX_RECENT);
      const key = storageKey(projectId);
      if (key) {
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      }
      return next;
    });
  }, [projectId]);

  return { recent, record };
}
