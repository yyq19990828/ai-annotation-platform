/**
 * v0.8.8 · useCanvasDraftPersistence 单测：sessionStorage TTL + active 写入 + 退出清理。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasDraftPersistence } from "../useCanvasDraftPersistence";
import type { CanvasDraft } from "../useWorkbenchState";

const KEY = (taskId: string) => `canvas_draft:${taskId}`;

const inactiveDraft: CanvasDraft = {
  active: false,
  annotationId: null,
  shapes: [],
  stroke: "#ef4444",
  pendingResult: null,
};

const activeDraft = (shapes: CanvasDraft["shapes"]): CanvasDraft => ({
  active: true,
  annotationId: "a1",
  shapes,
  stroke: "#ef4444",
  pendingResult: null,
});

describe("useCanvasDraftPersistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it("active + shapes 时把 payload 写到 sessionStorage", () => {
    const begin = vi.fn();
    const shapes = [{ type: "line" as const, points: [0.1, 0.1, 0.2, 0.2], stroke: "#f00" }];
    renderHook(() =>
      useCanvasDraftPersistence({
        taskId: "t1",
        canvasDraft: activeDraft(shapes),
        beginCanvasDraft: begin,
      }),
    );
    const raw = sessionStorage.getItem(KEY("t1"));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.shapes).toEqual(shapes);
    expect(parsed.annotationId).toBe("a1");
    expect(typeof parsed.ts).toBe("number");
  });

  it("非 active 时清掉 sessionStorage 条目", () => {
    sessionStorage.setItem(
      KEY("t1"),
      JSON.stringify({ annotationId: null, shapes: [{ type: "line", points: [0.1, 0.1, 0.2, 0.2] }], ts: Date.now() }),
    );
    renderHook(() =>
      useCanvasDraftPersistence({
        taskId: "t1",
        canvasDraft: inactiveDraft,
        beginCanvasDraft: vi.fn(),
      }),
    );
    expect(sessionStorage.getItem(KEY("t1"))).toBeNull();
  });

  it("切到 taskId 时若有未过期 stored 则调用 beginCanvasDraft 恢复", () => {
    const begin = vi.fn();
    const shapes = [{ kind: "free" as const, points: [[0.2, 0.2]], color: "#f00" }];
    sessionStorage.setItem(
      KEY("t2"),
      JSON.stringify({ annotationId: "ann-x", shapes, ts: Date.now() }),
    );
    renderHook(() =>
      useCanvasDraftPersistence({
        taskId: "t2",
        canvasDraft: inactiveDraft,
        beginCanvasDraft: begin,
      }),
    );
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledWith("ann-x", { shapes });
  });

  it("已过期 stored（> 5min）不恢复且自动清理", () => {
    const begin = vi.fn();
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    sessionStorage.setItem(
      KEY("t3"),
      JSON.stringify({ annotationId: null, shapes: [{ type: "line", points: [0, 0, 0.1, 0.1] }], ts: tenMinAgo }),
    );
    renderHook(() =>
      useCanvasDraftPersistence({
        taskId: "t3",
        canvasDraft: inactiveDraft,
        beginCanvasDraft: begin,
      }),
    );
    expect(begin).not.toHaveBeenCalled();
    // 非 active effect 兜底也会清掉
    expect(sessionStorage.getItem(KEY("t3"))).toBeNull();
  });

  it("draft 已 active 时不应反复 restore（防止 shapes 落库后又被弹回）", () => {
    const begin = vi.fn();
    const shapes = [{ type: "line" as const, points: [0.1, 0.1, 0.2, 0.2] }];
    sessionStorage.setItem(
      KEY("t4"),
      JSON.stringify({ annotationId: null, shapes, ts: Date.now() }),
    );
    renderHook(() =>
      useCanvasDraftPersistence({
        taskId: "t4",
        canvasDraft: activeDraft(shapes),
        beginCanvasDraft: begin,
      }),
    );
    expect(begin).not.toHaveBeenCalled();
  });

  it("undefined taskId 时一切都是 noop", () => {
    const begin = vi.fn();
    renderHook(() =>
      useCanvasDraftPersistence({
        taskId: undefined,
        canvasDraft: activeDraft([{ type: "line", points: [0.1, 0.1, 0.2, 0.2] }]),
        beginCanvasDraft: begin,
      }),
    );
    expect(begin).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("active + shapes 时挂上 beforeunload 监听，inactive 时清理", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { rerender, unmount } = renderHook(
      (props: { draft: CanvasDraft }) =>
        useCanvasDraftPersistence({
          taskId: "t5",
          canvasDraft: props.draft,
          beginCanvasDraft: vi.fn(),
        }),
      { initialProps: { draft: activeDraft([{ type: "line", points: [0, 0, 0.1, 0.1] }]) } },
    );
    const beforeunloadAdds = addSpy.mock.calls.filter((c) => c[0] === "beforeunload");
    expect(beforeunloadAdds.length).toBeGreaterThanOrEqual(1);

    // 切回非 active 时应该 removeEventListener
    rerender({ draft: inactiveDraft });
    const beforeunloadRemoves = removeSpy.mock.calls.filter((c) => c[0] === "beforeunload");
    expect(beforeunloadRemoves.length).toBeGreaterThanOrEqual(1);

    unmount();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("malformed JSON in sessionStorage → readStored 返回 null", () => {
    sessionStorage.setItem(KEY("t6"), "{not valid json");
    const begin = vi.fn();
    renderHook(() =>
      useCanvasDraftPersistence({
        taskId: "t6",
        canvasDraft: inactiveDraft,
        beginCanvasDraft: begin,
      }),
    );
    expect(begin).not.toHaveBeenCalled();
  });
});
