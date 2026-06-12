import { useCallback, useEffect, useState } from "react";

const MAX_RECENT = 5;
const storageKey = (projectId: string | undefined) =>
  projectId ? `recent-classes:${projectId}` : null;

function normalizeLimit(limit: number | undefined): number {
  return Number.isFinite(limit) ? Math.max(3, Math.min(20, Math.round(limit!))) : MAX_RECENT;
}

function readFromStorage(projectId: string | undefined, limit: number): string[] {
  const key = storageKey(projectId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((s) => typeof s === "string").slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

export function useRecentClasses(projectId: string | undefined, limit?: number) {
  const resolvedLimit = normalizeLimit(limit);
  const [recent, setRecent] = useState<string[]>(() => readFromStorage(projectId, resolvedLimit));

  useEffect(() => {
    setRecent(readFromStorage(projectId, resolvedLimit));
  }, [projectId, resolvedLimit]);

  const record = useCallback((className: string) => {
    if (!className) return;
    setRecent((prev) => {
      const next = [className, ...prev.filter((c) => c !== className)].slice(0, resolvedLimit);
      const key = storageKey(projectId);
      if (key) {
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      }
      return next;
    });
  }, [projectId, resolvedLimit]);

  return { recent, record };
}
