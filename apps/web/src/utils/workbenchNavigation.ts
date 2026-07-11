const LAST_TASK_BY_BATCH_KEY = "anno.workbench.lastTaskByBatch.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLastTaskMap(storage: StorageLike | null): Record<string, string> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(LAST_TASK_BY_BATCH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function scopedBatchKey(batchId: string, scope?: string | null) {
  return scope ? `${scope}:${batchId}` : batchId;
}

export function getRememberedWorkbenchTask(
  batchId: string | null | undefined,
  storage = getStorage(),
  scope?: string | null,
) {
  if (!batchId) return null;
  const taskId = readLastTaskMap(storage)[scopedBatchKey(batchId, scope)];
  return typeof taskId === "string" && taskId ? taskId : null;
}

export function rememberWorkbenchTask(
  batchId: string | null | undefined,
  taskId: string | null | undefined,
  storage = getStorage(),
  scope?: string | null,
) {
  if (!batchId || !taskId || !storage) return;
  const next = readLastTaskMap(storage);
  next[scopedBatchKey(batchId, scope)] = taskId;
  try {
    storage.setItem(LAST_TASK_BY_BATCH_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota / private mode failures; navigation should still work.
  }
}

export function currentWorkbenchReturnTo(location: { pathname: string; search?: string; hash?: string }) {
  return `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

export function resolveWorkbenchReturnTo(
  raw: string | null | undefined,
  currentPath: string,
  fallback = "/dashboard",
) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  try {
    const url = new URL(raw, "http://app.local");
    const target = `${url.pathname}${url.search}${url.hash}`;
    return target !== currentPath ? target : fallback;
  } catch {
    return fallback;
  }
}

export function buildWorkbenchUrl(
  projectId: string,
  opts: {
    batchId?: string | null;
    taskId?: string | null;
    annotationId?: string | null;
    trackId?: string | null;
    frameIndex?: number | null;
    returnTo?: string | null;
  } = {},
) {
  const q = new URLSearchParams();
  if (opts.batchId) q.set("batch", opts.batchId);
  if (opts.taskId) q.set("task", opts.taskId);
  if (opts.annotationId) q.set("focus", opts.annotationId);
  if (opts.trackId) q.set("track", opts.trackId);
  if (opts.frameIndex !== null && opts.frameIndex !== undefined) {
    q.set("frame", String(opts.frameIndex));
  }
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  const qs = q.toString();
  return `/projects/${projectId}/annotate${qs ? `?${qs}` : ""}`;
}

export function buildReviewWorkbenchUrl(
  projectId: string,
  opts: { batchId?: string | null; taskId?: string | null; returnTo?: string | null } = {},
) {
  const q = new URLSearchParams();
  if (opts.batchId) q.set("batch", opts.batchId);
  if (opts.taskId) q.set("task", opts.taskId);
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  const qs = q.toString();
  return `/projects/${projectId}/review${qs ? `?${qs}` : ""}`;
}

export function updateWorkbenchUrlSearch(
  location: { pathname: string; search?: string; hash?: string },
  opts: {
    batchId?: string | null;
    taskId?: string | null;
    annotationId?: string | null;
    trackId?: string | null;
    frameIndex?: number | null;
  } = {},
) {
  const q = new URLSearchParams(location.search ?? "");
  if ("batchId" in opts) {
    if (opts.batchId) q.set("batch", opts.batchId);
    else q.delete("batch");
  }
  if ("taskId" in opts) {
    if (opts.taskId) q.set("task", opts.taskId);
    else q.delete("task");
    if (!("annotationId" in opts)) q.delete("focus");
    if (!("trackId" in opts)) q.delete("track");
    if (!("frameIndex" in opts)) q.delete("frame");
  }
  if ("annotationId" in opts) {
    if (opts.annotationId) q.set("focus", opts.annotationId);
    else q.delete("focus");
  }
  if ("trackId" in opts) {
    if (opts.trackId) q.set("track", opts.trackId);
    else q.delete("track");
  }
  if ("frameIndex" in opts) {
    if (opts.frameIndex !== null && opts.frameIndex !== undefined) {
      q.set("frame", String(opts.frameIndex));
    } else {
      q.delete("frame");
    }
  }
  const qs = q.toString();
  return `${location.pathname}${qs ? `?${qs}` : ""}${location.hash ?? ""}`;
}
