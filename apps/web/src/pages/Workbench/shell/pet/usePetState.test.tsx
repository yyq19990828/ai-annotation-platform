import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePetState, type WorkbenchPetContext } from "./usePetState";

function ctx(overrides: Partial<WorkbenchPetContext> = {}): WorkbenchPetContext {
  return {
    selection: {
      count: 0,
      title: null,
      collapsed: false,
      sourceKind: "unknown",
      ...overrides.selection,
    },
    ai: {
      running: false,
      candidateCount: 0,
      backendOnline: true,
      ...overrides.ai,
    },
    workflow: {
      saving: false,
      offline: false,
      offlineQueueCount: 0,
      readOnly: false,
      reviewMode: false,
      ...overrides.workflow,
    },
    quality: {
      warningCount: 0,
      primaryWarning: null,
      ...overrides.quality,
    },
    counts: {
      annotationCount: 0,
      ...overrides.counts,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("usePetState", () => {
  it("transient 标注反馈高于 offline / warning 等上下文状态", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ context }) => usePetState({ context, poke: 0 }),
      {
        initialProps: {
          context: ctx({
            workflow: { saving: true, offline: false, offlineQueueCount: 0, readOnly: false, reviewMode: false },
            counts: { annotationCount: 1 },
          }),
        },
      },
    );

    expect(result.current.mood).toBe("offline");

    rerender({
      context: ctx({
        workflow: { saving: true, offline: false, offlineQueueCount: 0, readOnly: false, reviewMode: false },
        counts: { annotationCount: 2 },
      }),
    });

    expect(result.current.mood).toBe("happy");

    act(() => {
      vi.advanceTimersByTime(1_900);
    });

    expect(result.current.mood).toBe("offline");
  });

  it("按 offline、warning、aiRunning、candidateReady、holding 的顺序压住低优先级状态", () => {
    vi.useFakeTimers();
    const base = ctx({
      selection: { count: 1, title: "car", collapsed: true, sourceKind: "manual" },
      ai: { running: true, candidateCount: 2, backendOnline: true },
      quality: { warningCount: 1, primaryWarning: "必填属性未填" },
      workflow: { saving: false, offline: false, offlineQueueCount: 1, readOnly: false, reviewMode: false },
    });
    const { result, rerender } = renderHook(
      ({ context }) => usePetState({ context, poke: 0 }),
      { initialProps: { context: base } },
    );

    expect(result.current.mood).toBe("offline");
    expect(result.current.message).toBe("离线队列 1");

    rerender({ context: ctx({ ...base, workflow: { ...base.workflow, offlineQueueCount: 0 } }) });
    expect(result.current.mood).toBe("warning");

    rerender({ context: ctx({ ...base, workflow: { ...base.workflow, offlineQueueCount: 0 }, quality: { warningCount: 0, primaryWarning: null } }) });
    expect(result.current.mood).toBe("aiRunning");

    rerender({
      context: ctx({
        ...base,
        ai: { running: false, candidateCount: 2, backendOnline: true },
        workflow: { ...base.workflow, offlineQueueCount: 0 },
        quality: { warningCount: 0, primaryWarning: null },
      }),
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.mood).toBe("candidateReady");

    rerender({
      context: ctx({
        ...base,
        ai: { running: false, candidateCount: 0, backendOnline: true },
        workflow: { ...base.workflow, offlineQueueCount: 0 },
        quality: { warningCount: 0, primaryWarning: null },
      }),
    });
    expect(result.current.mood).toBe("holding");
    expect(result.current.message).toBe("car");
  });

  it("AI running 至少保持 800ms 后才回落到候选状态", () => {
    vi.useFakeTimers();
    const running = ctx({ ai: { running: true, candidateCount: 1, backendOnline: true } });
    const { result, rerender } = renderHook(
      ({ context }) => usePetState({ context, poke: 0 }),
      { initialProps: { context: running } },
    );

    expect(result.current.mood).toBe("aiRunning");

    rerender({ context: ctx({ ai: { running: false, candidateCount: 1, backendOnline: true } }) });
    expect(result.current.mood).toBe("aiRunning");

    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(result.current.mood).toBe("aiRunning");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.mood).toBe("candidateReady");
  });

  it("久坐闲聊不会覆盖工作上下文", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ context }) => usePetState({ context, poke: 0 }),
      {
        initialProps: {
          context: ctx({
            selection: { count: 1, title: "car", collapsed: false, sourceKind: "manual" },
          }),
        },
      },
    );

    act(() => {
      vi.advanceTimersByTime(46_000);
    });
    expect(result.current.mood).toBe("selected");

    act(() => {
      rerender({ context: ctx() });
    });
    act(() => {
      vi.advanceTimersByTime(46_000);
    });
    expect(result.current.mood).toBe("idleTalk");
  });
});
