import { useCallback, useRef, useState } from "react";
import type { AnnotationUpdatePayload } from "@/api/tasks";

export type DirtyField = keyof AnnotationUpdatePayload;

/**
 * Per-annotation dirty-field tracker (v0.9.41 I16 infrastructure).
 *
 * 当前 useWorkbenchAnnotationActions 在每次 commit 已经只发送变更字段（如
 * `{ geometry }`），不需要 dirty bits 也能省 PATCH 体积。这个 hook 是为未来
 * 多字段批量编辑（Wave γ I13 Attribute Schema、I12 Object Group）铺路：
 * 当一次交互涉及 className + attributes + geometry 多字段时，flush 路径可以
 * 用本 tracker 一次性收集后再合并到一个 PATCH。
 *
 * API:
 *   markDirty(id, field)        标记某条 annotation 的某字段已脏
 *   getDirtyFields(id)          读取脏字段集合（拷贝，避免外部 mutate）
 *   clear(id)                   清空某条
 *   clearAll()                  清空所有
 *   subscribe(listener)         订阅变更，便于自动 flush
 */
export function useDirtyTracker() {
  const mapRef = useRef<Map<string, Set<DirtyField>>>(new Map());
  const listenersRef = useRef<Set<() => void>>(new Set());
  const [revision, setRevision] = useState(0);

  const notify = useCallback(() => {
    setRevision((n) => n + 1);
    listenersRef.current.forEach((l) => {
      try { l(); } catch { /* listeners must not throw */ }
    });
  }, []);

  const markDirty = useCallback((id: string, field: DirtyField) => {
    let s = mapRef.current.get(id);
    if (!s) {
      s = new Set();
      mapRef.current.set(id, s);
    }
    if (s.has(field)) return;
    s.add(field);
    notify();
  }, [notify]);

  const getDirtyFields = useCallback((id: string): DirtyField[] => {
    const s = mapRef.current.get(id);
    return s ? [...s] : [];
  }, []);

  const clear = useCallback((id: string) => {
    if (!mapRef.current.delete(id)) return;
    notify();
  }, [notify]);

  const clearAll = useCallback(() => {
    if (mapRef.current.size === 0) return;
    mapRef.current.clear();
    notify();
  }, [notify]);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  return { markDirty, getDirtyFields, clear, clearAll, subscribe, revision };
}
