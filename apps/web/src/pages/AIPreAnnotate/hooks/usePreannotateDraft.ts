/**
 * v0.9.7 · AI 预标 prompt 草稿持久化.
 *
 * 按 projectId 分桶存 localStorage, 切项目时旧 prompt 不丢. 写入加 300ms
 * debounce 避免频繁 setItem.
 */

import { useEffect, useRef } from "react";

const KEY_PREFIX = "wb:ai-pre:draft:";
const DEBOUNCE_MS = 300;

function key(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

export function readDraft(projectId: string | undefined | null): string {
  if (!projectId) return "";
  try {
    return localStorage.getItem(key(projectId)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(projectId: string, value: string): void {
  try {
    if (value.trim()) {
      localStorage.setItem(key(projectId), value);
    } else {
      localStorage.removeItem(key(projectId));
    }
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function clearDraft(projectId: string | undefined | null): void {
  if (!projectId) return;
  try {
    localStorage.removeItem(key(projectId));
  } catch {
    /* ignore */
  }
}

/**
 * 监听 (projectId, prompt) 变化, debounce 写入 localStorage.
 *
 * 不主动读初始值——由调用方在切项目时手动 readDraft 决定回填策略, 避免 hook
 * 隐式覆盖正在编辑的 prompt.
 */
export function usePreannotateDraftAutosave(
  projectId: string | undefined | null,
  prompt: string,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      writeDraft(projectId, prompt);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [projectId, prompt]);
}
