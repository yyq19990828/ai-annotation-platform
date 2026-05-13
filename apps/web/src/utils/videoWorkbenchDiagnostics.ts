type VideoWorkbenchDiagnosticsStore = {
  activeTaskId?: string;
  byTask?: Record<string, unknown>;
};

export type VideoWorkbenchDiagnosticsSnapshot = Record<string, unknown>;

const MAX_DIAGNOSTIC_JSON_CHARS = 6000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getWindowDiagnostics() {
  if (typeof window === "undefined") return null;
  return window as unknown as {
    __videoWorkbenchDiagnostics?: VideoWorkbenchDiagnosticsStore;
    __videoFrameClockDiagnostics?: Record<string, unknown>;
  };
}

function stableStringify(value: unknown, maxChars = MAX_DIAGNOSTIC_JSON_CHARS) {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxChars) return json;
  return `${json.slice(0, maxChars)}\n... truncated`;
}

export function getVideoWorkbenchDiagnosticsSnapshot(): VideoWorkbenchDiagnosticsSnapshot | null {
  const target = getWindowDiagnostics();
  if (!target) return null;

  const store = target.__videoWorkbenchDiagnostics;
  const activeTaskId = store?.activeTaskId;
  const activeSnapshot = activeTaskId ? store?.byTask?.[activeTaskId] : null;
  if (activeSnapshot && typeof activeSnapshot === "object") {
    const route = (activeSnapshot as { route?: unknown }).route;
    if (typeof route === "string" && route !== `${window.location.pathname}${window.location.search}`) {
      return null;
    }
    return activeSnapshot as VideoWorkbenchDiagnosticsSnapshot;
  }

  if (
    window.location.pathname.includes("annotate") &&
    target.__videoFrameClockDiagnostics &&
    Object.keys(target.__videoFrameClockDiagnostics).length > 0
  ) {
    return {
      updatedAt: new Date().toISOString(),
      route: `${window.location.pathname}${window.location.search}`,
      frameClock: target.__videoFrameClockDiagnostics,
    };
  }

  return null;
}

export function appendVideoWorkbenchDiagnostics(
  description: string,
  snapshot: VideoWorkbenchDiagnosticsSnapshot | null,
) {
  if (!snapshot) return description;
  return `${description}\n\n---\n\n### Video Workbench Diagnostics\n\n\`\`\`json\n${stableStringify(snapshot)}\n\`\`\``;
}

export function videoWorkbenchDiagnosticsConsoleEntry(snapshot: VideoWorkbenchDiagnosticsSnapshot | null) {
  if (!snapshot) return null;
  return {
    msg: "[video-workbench-diagnostics]",
    stack: stableStringify(snapshot),
  };
}

export function taskIdFromVideoWorkbenchDiagnostics(snapshot: VideoWorkbenchDiagnosticsSnapshot | null) {
  const taskId = typeof snapshot?.taskId === "string" ? snapshot.taskId : null;
  return taskId && UUID_RE.test(taskId) ? taskId : undefined;
}
