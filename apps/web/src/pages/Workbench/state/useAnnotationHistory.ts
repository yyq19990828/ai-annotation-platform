import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationResponse } from "@/types";
import type { AnnotationPayload, AnnotationUpdatePayload } from "@/api/tasks";

/**
 * 标注操作命令栈。每条命令记录足够 redo / undo 的状态。
 * 切任务清栈，避免误撤销另一题。
 */
export type Command =
  | { kind: "create"; annotationId: string; payload: AnnotationPayload }
  | { kind: "delete"; annotation: AnnotationResponse }
  | { kind: "update"; annotationId: string; before: AnnotationUpdatePayload; after: AnnotationUpdatePayload }
  | { kind: "acceptPrediction"; predictionId: string; createdAnnotationIds: string[] }
  /** 批量命令：undo 时反序应用、redo 时正序应用。子命令必须不含 batch（一层）。 */
  | { kind: "batch"; commands: Exclude<Command, { kind: "batch" }>[] };

export interface HistoryHandlers {
  createAnnotation: (payload: AnnotationPayload) => Promise<AnnotationResponse>;
  deleteAnnotation: (annotationId: string) => Promise<unknown>;
  updateAnnotation: (annotationId: string, payload: AnnotationUpdatePayload) => Promise<unknown>;
}

export function useAnnotationHistory(taskId: string | undefined, handlers: HistoryHandlers) {
  const [undoStack, setUndoStack] = useState<Command[]>([]);
  const [redoStack, setRedoStack] = useState<Command[]>([]);
  const [busy, setBusy] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // 切任务清栈
  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [taskId]);

  const push = useCallback((cmd: Command) => {
    setUndoStack((s) => [...s, cmd]);
    setRedoStack([]); // 新操作会清掉 redo
  }, []);

  const apply = useCallback(async (cmd: Command, direction: "undo" | "redo") => {
    const h = handlersRef.current;
    if (cmd.kind === "batch") {
      // batch 的子命令在 undo 时倒序、redo 时正序执行
      const ordered = direction === "undo" ? [...cmd.commands].reverse() : cmd.commands;
      for (const sub of ordered) {
        try { await applyLeaf(sub, direction, h); } catch { /* 单条失败不阻塞 */ }
      }
      return;
    }
    await applyLeaf(cmd, direction, h);
  }, []);

  // 内部：单条非 batch 命令的实际执行
  async function applyLeaf(
    cmd: Exclude<Command, { kind: "batch" }>,
    direction: "undo" | "redo",
    h: HistoryHandlers,
  ) {
    if (cmd.kind === "create") {
      if (direction === "undo") await h.deleteAnnotation(cmd.annotationId);
      else {
        const fresh = await h.createAnnotation(cmd.payload);
        // redo 重新创建会拿到新 id；后续 undo 还得知道这个 id
        cmd.annotationId = fresh.id;
      }
    } else if (cmd.kind === "delete") {
      if (direction === "undo") {
        const restored = await h.createAnnotation({
          annotation_type: cmd.annotation.annotation_type,
          class_name: cmd.annotation.class_name,
          geometry: cmd.annotation.geometry,
          confidence: cmd.annotation.confidence ?? undefined,
          parent_prediction_id: cmd.annotation.parent_prediction_id ?? undefined,
          lead_time: cmd.annotation.lead_time ?? undefined,
        });
        // 反向时新 id；后续 redo 删除以新 id 执行
        cmd.annotation = { ...cmd.annotation, id: restored.id };
      } else {
        await h.deleteAnnotation(cmd.annotation.id);
      }
    } else if (cmd.kind === "update") {
      const target = direction === "undo" ? cmd.before : cmd.after;
      await h.updateAnnotation(cmd.annotationId, target);
    } else if (cmd.kind === "acceptPrediction") {
      // accept 的 undo：删掉那一批由 prediction 派生的 annotation；redo 走批量删除策略不实现，避免重复采纳引发 ID 漂移。
      if (direction === "undo") {
        for (const id of cmd.createdAnnotationIds) {
          try { await h.deleteAnnotation(id); } catch { /* ignore */ }
        }
      }
      // redo 不再触发后端 accept（对方端点是幂等的但 id 不复用），仅消费 redo 栈无副作用
    }
  }

  const pushBatch = useCallback((commands: Exclude<Command, { kind: "batch" }>[]) => {
    if (commands.length === 0) return;
    if (commands.length === 1) {
      setUndoStack((s) => [...s, commands[0]]);
    } else {
      setUndoStack((s) => [...s, { kind: "batch", commands }]);
    }
    setRedoStack([]);
  }, []);

  const undo = useCallback(async () => {
    if (busy) return;
    setUndoStack((stack) => {
      const cmd = stack[stack.length - 1];
      if (!cmd) return stack;
      setBusy(true);
      apply(cmd, "undo")
        .then(() => setRedoStack((r) => [...r, cmd]))
        .catch(() => {/* swallow; 命令已从栈移除 */})
        .finally(() => setBusy(false));
      return stack.slice(0, -1);
    });
  }, [apply, busy]);

  const redo = useCallback(async () => {
    if (busy) return;
    setRedoStack((stack) => {
      const cmd = stack[stack.length - 1];
      if (!cmd) return stack;
      setBusy(true);
      apply(cmd, "redo")
        .then(() => setUndoStack((u) => [...u, cmd]))
        .catch(() => {/* swallow */})
        .finally(() => setBusy(false));
      return stack.slice(0, -1);
    });
  }, [apply, busy]);

  return {
    push,
    pushBatch,
    undo,
    redo,
    canUndo: undoStack.length > 0 && !busy,
    canRedo: redoStack.length > 0 && !busy,
    busy,
  };
}
