import { useEffect, useLayoutEffect, useRef } from "react";
import type { CommentCanvasDrawing } from "@/api/comments";
import type { CanvasDraft } from "./useWorkbenchState";
import type { DiscussionDraftStore } from "./useDiscussionDraftStore";
import type { DiscussionOrigin, DiscussionTarget } from "./discussionTypes";
import {
  clearCanvasDraftRecovery,
  readCanvasDraftRecovery,
  writeCanvasDraftRecovery,
} from "./discussionCanvasRecovery";

interface Args {
  taskId: string | undefined;
  projectId?: string | null;
  store?: DiscussionDraftStore | null;
  /** Undefined while annotations load; an empty list is a completed result. */
  annotationIds?: readonly string[];
  canvasDraft: CanvasDraft;
  beginCanvasDraft: (
    annotationId: string | null,
    initial?: CommentCanvasDrawing | null,
    origin?: DiscussionOrigin,
  ) => void;
  releaseCanvasDraft?: () => void;
  consumeCanvasResult?: (resultId?: string) => void;
}

function flushActiveDrawing(draft: CanvasDraft, store: DiscussionDraftStore | null | undefined) {
  if (!draft.active || !draft.origin || !store?.isOwned(draft.origin)) return;
  const drawing = { shapes: draft.shapes };
  if (!store.saveDrawing(draft.origin, drawing, { active: true })) return;
  // Never serialize an old drawing under the currently displayed task.
  writeCanvasDraftRecovery(draft.origin, drawing);
}

/** Canvas is a view onto the session draft, with a scoped five-minute reload fallback. */
export function useCanvasDraftPersistence({
  taskId,
  projectId,
  store,
  annotationIds,
  canvasDraft,
  beginCanvasDraft,
  releaseCanvasDraft,
  consumeCanvasResult,
}: Args) {
  const latest = useRef({ canvasDraft, store });
  latest.current = { canvasDraft, store };
  const restoredForContext = useRef<string | null>(null);

  useLayoutEffect(() => {
    const origin = canvasDraft.origin;
    if (!origin) return;
    if (!store?.isOwned(origin)) {
      releaseCanvasDraft?.();
      return;
    }
    if (canvasDraft.active) {
      flushActiveDrawing(canvasDraft, store);
      if (origin.target.taskId !== taskId || origin.target.projectId !== projectId)
        releaseCanvasDraft?.();
    } else if (canvasDraft.pendingResult) {
      // Complete the original target even if its input is hidden/unmounted.
      if (store.saveDrawing(origin, canvasDraft.pendingResult, { active: false })) {
        clearCanvasDraftRecovery(origin);
      }
      consumeCanvasResult?.(canvasDraft.resultId ?? undefined);
    }
  }, [canvasDraft, store, taskId, projectId, releaseCanvasDraft, consumeCanvasResult]);

  useLayoutEffect(
    () => () => {
      flushActiveDrawing(latest.current.canvasDraft, latest.current.store);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!store || !projectId || !taskId || !annotationIds || store.getSnapshot().disposed) return;
    const context = JSON.stringify([store.owner.sessionId, projectId, taskId]);
    if (restoredForContext.current === context) return;
    // The preceding effect releases the old task before restoration can run.
    if (canvasDraft.active || canvasDraft.pendingResult) return;
    restoredForContext.current = context;
    const available = new Set(annotationIds);
    const memory = Object.values(store.getSnapshot().drafts).filter(
      (draft) =>
        draft.target.projectId === projectId &&
        draft.target.taskId === taskId &&
        draft.target.kind === "annotation" &&
        available.has(draft.target.annotationId) &&
        draft.canvasActive &&
        draft.canvasOrigin &&
        store.isOwned(draft.canvasOrigin) &&
        (draft.canvas_drawing?.shapes?.length ?? 0) > 0,
    );
    const selected = store.getSendTarget(projectId, taskId);
    const saved =
      memory.find(
        (draft) =>
          selected?.kind === "annotation" &&
          draft.target.kind === "annotation" &&
          draft.target.annotationId === selected.annotationId,
      ) ?? memory[memory.length - 1];
    if (saved?.canvasOrigin && saved.target.kind === "annotation") {
      store.setSendTarget(projectId, taskId, saved.target);
      beginCanvasDraft(saved.target.annotationId, saved.canvas_drawing, saved.canvasOrigin);
      return;
    }
    // Any memory entry wins, including an empty draft after successful send.
    for (const record of readCanvasDraftRecovery({
      userId: store.owner.userId,
      projectId,
      taskId,
    })) {
      if (!available.has(record.annotationId)) continue;
      const target: DiscussionTarget = {
        kind: "annotation",
        projectId,
        taskId,
        annotationId: record.annotationId,
      };
      if (store.getDraft(target)) continue;
      const origin = store.makeOrigin(target);
      if (!origin) continue;
      const drawing = { shapes: record.shapes };
      store.saveDrawing(origin, drawing, { active: true });
      store.setSendTarget(projectId, taskId, target);
      beginCanvasDraft(record.annotationId, drawing, origin);
      break;
    }
  }, [
    store,
    projectId,
    taskId,
    annotationIds,
    canvasDraft.active,
    canvasDraft.pendingResult,
    beginCanvasDraft,
  ]);

  useEffect(() => {
    if (
      !canvasDraft.active ||
      !canvasDraft.shapes.length ||
      !canvasDraft.origin ||
      !store?.isOwned(canvasDraft.origin)
    )
      return;
    const handler = (event: BeforeUnloadEvent) => {
      flushActiveDrawing(latest.current.canvasDraft, latest.current.store);
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [canvasDraft.active, canvasDraft.shapes.length, canvasDraft.origin, store]);
}
