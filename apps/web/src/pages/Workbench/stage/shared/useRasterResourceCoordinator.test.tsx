import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRasterResourceDiagnosticsSnapshot } from "@/utils/rasterResourceDiagnostics";
import { RasterResourceCoordinator } from "./rasterResourceCoordinator";
import { useRasterResourceCoordinator } from "./useRasterResourceCoordinator";

const budget = {
  tier: "standard" as const,
  softBudgetBytes: 1_024,
  hardBudgetBytes: 2_048,
  hiddenFreezeMs: 10,
};

describe("useRasterResourceCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("在 StrictMode 重放期间保留任务级实例，真实卸载后归零", async () => {
    const dispose = vi.spyOn(RasterResourceCoordinator.prototype, "dispose");
    const view = renderHook(() => useRasterResourceCoordinator({ taskId: "task-1", budget }), {
      wrapper: StrictMode,
    });

    await act(async () => Promise.resolve());
    expect(view.result.current?.getSnapshot().disposed).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(getRasterResourceDiagnosticsSnapshot()?.resources.hardBudgetBytes).toBe(2_048);

    view.unmount();
    await act(async () => Promise.resolve());
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(getRasterResourceDiagnosticsSnapshot()).toBeNull();
  });

  it("BFCache 只换代并保留 P0 真值，真正 pagehide 全量释放", async () => {
    const view = renderHook(() => useRasterResourceCoordinator({ taskId: "task-1", budget }));
    const coordinator = view.result.current!;
    const truth = coordinator.tryReserve({
      owner: "mask-history",
      category: "mask-history",
      priority: 0,
      bytes: 256,
      reconstructible: false,
      pinned: true,
    })!;
    expect(truth.commit()).toBe(true);

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      generation: 2,
      committedBytes: 256,
      disposed: false,
    });

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      committedBytes: 0,
      reservedBytes: 0,
      disposed: true,
    });
    view.unmount();
    await act(async () => Promise.resolve());
  });
});
