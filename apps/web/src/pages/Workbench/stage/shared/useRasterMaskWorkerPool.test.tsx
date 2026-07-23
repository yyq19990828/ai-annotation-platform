import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RasterMaskWorkerPool } from "./rasterMaskWorkerPool";
import { useRasterMaskWorkerPool } from "./useRasterMaskWorkerPool";

describe("useRasterMaskWorkerPool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("StrictMode 模拟卸载不会销毁仍在使用的任务级 Worker 池", async () => {
    vi.stubGlobal("Worker", class {});
    const dispose = vi.spyOn(RasterMaskWorkerPool.prototype, "dispose");
    const view = renderHook(() => useRasterMaskWorkerPool("task-1"), {
      wrapper: StrictMode,
    });

    await act(async () => Promise.resolve());
    expect(view.result.current).toBeDefined();
    expect(dispose).not.toHaveBeenCalled();

    view.unmount();
    await act(async () => Promise.resolve());
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("切换任务后只销毁旧池，保留新池", async () => {
    vi.stubGlobal("Worker", class {});
    const dispose = vi.spyOn(RasterMaskWorkerPool.prototype, "dispose");
    const view = renderHook(({ taskId }) => useRasterMaskWorkerPool(taskId), {
      initialProps: { taskId: "task-1" },
    });
    const first = view.result.current;

    view.rerender({ taskId: "task-2" });
    const second = view.result.current;
    await act(async () => Promise.resolve());

    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(dispose).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => Promise.resolve());
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
