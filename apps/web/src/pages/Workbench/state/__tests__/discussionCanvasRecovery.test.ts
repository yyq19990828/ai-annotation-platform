import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscussionOrigin } from "../discussionTypes";
import {
  CANVAS_RECOVERY_TTL_MS,
  canvasRecoveryKey,
  clearCanvasDraftRecovery,
  clearUserCanvasDraftRecovery,
  readCanvasDraftRecovery,
  writeCanvasDraftRecovery,
} from "../discussionCanvasRecovery";

const scope = { userId: "u", projectId: "p", taskId: "t" };
const origin: DiscussionOrigin = {
  owner: { userId: "u", sessionId: "ephemeral" },
  target: { kind: "annotation", projectId: "p", taskId: "t", annotationId: "a" },
  requestId: "drawing",
};
const drawing = { shapes: [{ type: "line" as const, points: [0, 0, 0.5, 0.5] }] };

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("discussion canvas reload recovery", () => {
  it("binds recovery to user/project/task/annotation, not ephemeral session ID", () => {
    writeCanvasDraftRecovery(origin, drawing);
    expect(readCanvasDraftRecovery(scope)[0]).toMatchObject({
      ...scope,
      annotationId: "a",
      shapes: drawing.shapes,
    });
    expect(readCanvasDraftRecovery({ ...scope, userId: "other" })).toEqual([]);
    expect(readCanvasDraftRecovery({ ...scope, projectId: "other" })).toEqual([]);
    expect(readCanvasDraftRecovery({ ...scope, taskId: "other" })).toEqual([]);
    expect(sessionStorage.getItem(canvasRecoveryKey(scope, "a"))).not.toContain("ephemeral");
    clearCanvasDraftRecovery({ ...origin, owner: { ...origin.owner, sessionId: "new-session" } });
    expect(readCanvasDraftRecovery(scope)).toEqual([]);
  });

  it("expires after five minutes and leaves unexpired ownerless recovery untouched", () => {
    const legacyKey = "canvas_draft:t";
    const legacy = JSON.stringify({ annotationId: "a", shapes: drawing.shapes, ts: Date.now() });
    sessionStorage.setItem(legacyKey, legacy);
    expect(readCanvasDraftRecovery(scope)).toEqual([]);
    expect(sessionStorage.getItem(legacyKey)).toBe(legacy);
    writeCanvasDraftRecovery(origin, drawing);
    vi.advanceTimersByTime(CANVAS_RECOVERY_TTL_MS + 1);
    expect(readCanvasDraftRecovery(scope)).toEqual([]);
    expect(sessionStorage.getItem(canvasRecoveryKey(scope, "a"))).toBeNull();
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
  });

  it("does not restore malformed shapes or a payload whose identity differs from its key", () => {
    const key = canvasRecoveryKey(scope, "a");
    writeCanvasDraftRecovery(origin, drawing);
    const value = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify({ ...value, annotationId: "other" }));
    expect(readCanvasDraftRecovery(scope)).toEqual([]);
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...value, shapes: [{ type: "line", points: [0, "not-a-number"] }] }),
    );
    expect(readCanvasDraftRecovery(scope)).toEqual([]);
  });

  it("logout clears only owned scoped records and empty drawings clear their own slot", () => {
    writeCanvasDraftRecovery(origin, drawing);
    const otherOrigin = { ...origin, owner: { ...origin.owner, userId: "other" } };
    writeCanvasDraftRecovery(otherOrigin, drawing);
    sessionStorage.setItem("canvas_draft:t", "unknown legacy owner");
    clearUserCanvasDraftRecovery("u");
    expect(readCanvasDraftRecovery(scope)).toEqual([]);
    expect(readCanvasDraftRecovery({ ...scope, userId: "other" })).toHaveLength(1);
    expect(sessionStorage.getItem("canvas_draft:t")).toBe("unknown legacy owner");
    writeCanvasDraftRecovery(otherOrigin, { shapes: [] });
    expect(readCanvasDraftRecovery({ ...scope, userId: "other" })).toEqual([]);
  });

  it("handles unavailable sessionStorage without losing control flow", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeCanvasDraftRecovery(origin, drawing)).not.toThrow();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(readCanvasDraftRecovery(scope)).toEqual([]);
  });
});
