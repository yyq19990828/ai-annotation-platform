import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { useAuthenticatedDiscussionSession } from "./useAuthenticatedDiscussionSession";
import { canvasRecoveryKey, writeCanvasDraftRecovery } from "./discussionCanvasRecovery";

const user = { id: "user-a" } as MeResponse;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.getState().setAuth("test-token", user);
});
afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  localStorage.clear();
  sessionStorage.clear();
});

describe("authenticated discussion lease", () => {
  it("retires the old session during batched logout/login of the same user", () => {
    const { result } = renderHook(useAuthenticatedDiscussionSession);
    const old = { userId: user.id, sessionId: result.current.sessionId };
    expect(result.current.isOwnerCurrent(old)).toBe(true);
    act(() => {
      useAuthStore.getState().logout();
      expect(result.current.isOwnerCurrent(old)).toBe(false);
      useAuthStore.getState().setAuth("test-token", user);
      expect(result.current.isOwnerCurrent(old)).toBe(false);
    });
    expect(result.current.userId).toBe(user.id);
    expect(result.current.sessionId).not.toBe(old.sessionId);
    expect(
      result.current.isOwnerCurrent({ userId: user.id, sessionId: result.current.sessionId }),
    ).toBe(true);
  });

  it("preserves the session during token renewal and checks cross-tab credential replacement", () => {
    const { result } = renderHook(useAuthenticatedDiscussionSession);
    const owner = { userId: user.id, sessionId: result.current.sessionId };
    act(() => useAuthStore.getState().setAuth("renewed-test-token", user));
    expect(result.current.sessionId).toBe(owner.sessionId);
    expect(result.current.isOwnerCurrent(owner)).toBe(true);
    localStorage.setItem("token", "another-tab-token");
    expect(result.current.isOwnerCurrent(owner)).toBe(false);
  });

  it("clears only the retired user's scoped canvas recovery on account change", () => {
    const { result } = renderHook(useAuthenticatedDiscussionSession);
    const scope = { userId: user.id, projectId: "p", taskId: "t" };
    writeCanvasDraftRecovery(
      {
        owner: { userId: user.id, sessionId: result.current.sessionId },
        target: { projectId: "p", taskId: "t", kind: "annotation", annotationId: "a" },
        requestId: "r",
      },
      { shapes: [{ type: "line", points: [0, 0, 1, 1] }] },
    );
    sessionStorage.setItem("canvas_draft:t", "ownerless legacy");
    act(() => useAuthStore.getState().setAuth("other-user-token", { id: "user-b" } as MeResponse));
    expect(sessionStorage.getItem(canvasRecoveryKey(scope, "a"))).toBeNull();
    expect(sessionStorage.getItem("canvas_draft:t")).toBe("ownerless legacy");
  });

  it("survives StrictMode replay but denies late work after actual unmount", () => {
    const { result, unmount } = renderHook(useAuthenticatedDiscussionSession, {
      wrapper: StrictMode,
    });
    const owner = { userId: user.id, sessionId: result.current.sessionId };
    const valid = result.current.isOwnerCurrent;
    expect(valid(owner)).toBe(true);
    unmount();
    expect(valid(owner)).toBe(false);
  });
});
