import type { CommentCanvasDrawing } from "@/api/comments";
import type { DiscussionOrigin } from "./discussionTypes";

export const CANVAS_RECOVERY_TTL_MS = 5 * 60 * 1000;
const PREFIX = "canvas_draft:v2:";

export interface CanvasRecoveryScope {
  userId: string;
  projectId: string;
  taskId: string;
}

export interface CanvasRecoveryRecord extends CanvasRecoveryScope {
  schemaVersion: 2;
  annotationId: string;
  shapes: NonNullable<CommentCanvasDrawing["shapes"]>;
  ts: number;
}

export function canvasRecoveryKey(scope: CanvasRecoveryScope, annotationId: string): string {
  return PREFIX + JSON.stringify([scope.userId, scope.projectId, scope.taskId, annotationId]);
}

function storageKeys(): string[] {
  return Array.from({ length: sessionStorage.length }, (_, index) =>
    sessionStorage.key(index),
  ).filter((key): key is string => key !== null);
}

function validRecord(value: unknown): value is CanvasRecoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as CanvasRecoveryRecord;
  return (
    record.schemaVersion === 2 &&
    [record.userId, record.projectId, record.taskId, record.annotationId].every(
      (id) => typeof id === "string" && id.length > 0,
    ) &&
    Number.isFinite(record.ts) &&
    Array.isArray(record.shapes) &&
    record.shapes.length > 0 &&
    record.shapes.every(
      (shape) =>
        shape &&
        ["line", "arrow", "rect", "ellipse"].includes(shape.type) &&
        Array.isArray(shape.points) &&
        shape.points.length >= 4 &&
        shape.points.length % 2 === 0 &&
        shape.points.every((point) => Number.isFinite(point)),
    )
  );
}

/** Reload recovery never guesses the owner of the old task-only storage format. */
export function readCanvasDraftRecovery(scope: CanvasRecoveryScope): CanvasRecoveryRecord[] {
  try {
    const legacyKey = `canvas_draft:${scope.taskId}`;
    const legacy = sessionStorage.getItem(legacyKey);
    if (legacy) {
      try {
        const value = JSON.parse(legacy) as { ts?: number };
        if (typeof value.ts === "number" && Date.now() - value.ts > CANVAS_RECOVERY_TTL_MS) {
          sessionStorage.removeItem(legacyKey);
        }
      } catch {
        /* Leave unknown legacy content untouched. */
      }
    }
    const records: CanvasRecoveryRecord[] = [];
    for (const key of storageKeys()) {
      if (!key.startsWith(PREFIX)) continue;
      let value: unknown;
      try {
        value = JSON.parse(sessionStorage.getItem(key) ?? "null");
      } catch {
        continue;
      }
      if (!validRecord(value) || canvasRecoveryKey(value, value.annotationId) !== key) continue;
      if (
        value.userId !== scope.userId ||
        value.projectId !== scope.projectId ||
        value.taskId !== scope.taskId
      )
        continue;
      const age = Date.now() - value.ts;
      if (age > CANVAS_RECOVERY_TTL_MS || age < 0) {
        sessionStorage.removeItem(key);
        continue;
      }
      records.push(value);
    }
    return records.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export function writeCanvasDraftRecovery(
  origin: DiscussionOrigin,
  drawing: CommentCanvasDrawing,
): void {
  if (origin.target.kind !== "annotation") return;
  const scope = {
    userId: origin.owner.userId,
    projectId: origin.target.projectId,
    taskId: origin.target.taskId,
  };
  const record: CanvasRecoveryRecord = {
    ...scope,
    schemaVersion: 2,
    annotationId: origin.target.annotationId,
    shapes: drawing.shapes ?? [],
    ts: Date.now(),
  };
  try {
    const key = canvasRecoveryKey(scope, record.annotationId);
    if (!record.shapes.length) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(record));
  } catch {
    /* In-memory drafts remain available when storage is blocked/full. */
  }
}

export function clearCanvasDraftRecovery(origin: DiscussionOrigin): void {
  if (origin.target.kind !== "annotation") return;
  try {
    sessionStorage.removeItem(
      canvasRecoveryKey(
        { userId: origin.owner.userId, ...origin.target },
        origin.target.annotationId,
      ),
    );
  } catch {
    /* Storage may be disabled. */
  }
}

/** Logout removes only this user's scoped recovery, never ownerless legacy data. */
export function clearUserCanvasDraftRecovery(userId: string): void {
  try {
    for (const key of storageKeys()) {
      if (!key.startsWith(PREFIX)) continue;
      try {
        const tuple: unknown = JSON.parse(key.slice(PREFIX.length));
        if (Array.isArray(tuple) && tuple.length === 4 && tuple[0] === userId)
          sessionStorage.removeItem(key);
      } catch {
        /* Do not guess the owner of malformed keys. */
      }
    }
  } catch {
    /* Storage may be disabled. */
  }
}
