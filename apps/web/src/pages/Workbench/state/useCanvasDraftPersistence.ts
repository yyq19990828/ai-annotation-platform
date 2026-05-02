// v0.6.5：CanvasDrawing 草稿持久化。
//
// 解决 v0.6.4 后续观察项「画完一笔但忘发评论 / 刷新 → painting 全丢」。
// 策略：
//   - 切题 / shape 增删时把 { annotationId, shapes, ts } 写到
//     sessionStorage["canvas_draft:" + taskId]，TTL 5 分钟
//   - 切回同一 taskId（含刷新）时若仍在 TTL 内自动恢复
//   - beforeunload 时若 active && shapes.length > 0 → 浏览器原生确认提示
import { useEffect, useRef } from "react";
import type { CanvasDraft } from "./useWorkbenchState";
import type { CommentCanvasDrawing } from "@/api/comments";

const TTL_MS = 5 * 60 * 1000;
const KEY_PREFIX = "canvas_draft:";

interface Stored {
  annotationId: string | null;
  shapes: NonNullable<CommentCanvasDrawing["shapes"]>;
  ts: number;
}

function readStored(taskId: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + taskId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (Date.now() - parsed.ts > TTL_MS) {
      sessionStorage.removeItem(KEY_PREFIX + taskId);
      return null;
    }
    if (!Array.isArray(parsed.shapes) || parsed.shapes.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface Args {
  taskId: string | undefined;
  canvasDraft: CanvasDraft;
  beginCanvasDraft: (annotationId: string | null, initial?: CommentCanvasDrawing | null) => void;
}

export function useCanvasDraftPersistence({ taskId, canvasDraft, beginCanvasDraft }: Args) {
  // 恢复一次：切到新 taskId 时检查 sessionStorage。
  // 用 ref 防止同 taskId 多次恢复（shapes 落库后不应反复弹回来）。
  const restoredForTask = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId) return;
    if (restoredForTask.current === taskId) return;
    if (canvasDraft.active) return; // 已在画了，不要覆盖现场
    const stored = readStored(taskId);
    restoredForTask.current = taskId;
    if (stored) {
      beginCanvasDraft(stored.annotationId, { shapes: stored.shapes });
    }
  }, [taskId, canvasDraft.active, beginCanvasDraft]);

  // 持久化：active + shapes 任何变化都写一次（节流由 React 批量更新负担）。
  useEffect(() => {
    if (!taskId) return;
    const key = KEY_PREFIX + taskId;
    if (canvasDraft.active && canvasDraft.shapes.length > 0) {
      const payload: Stored = {
        annotationId: canvasDraft.annotationId,
        shapes: canvasDraft.shapes,
        ts: Date.now(),
      };
      try { sessionStorage.setItem(key, JSON.stringify(payload)); } catch { /* quota */ }
    } else if (!canvasDraft.active) {
      // 退出 canvas 模式（commit / cancel）时清掉，避免下次回来又被恢复
      sessionStorage.removeItem(key);
    }
  }, [taskId, canvasDraft.active, canvasDraft.shapes, canvasDraft.annotationId]);

  // 关闭 / 刷新页面前若有未提交画笔 → 浏览器原生确认（returnValue 任意非空字符串即可）。
  useEffect(() => {
    if (!canvasDraft.active || canvasDraft.shapes.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [canvasDraft.active, canvasDraft.shapes.length]);
}
