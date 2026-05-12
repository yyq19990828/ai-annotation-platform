import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { tasksApi } from "@/api/tasks";
import { useVideoFramePreview } from "./useVideoFramePreview";

vi.mock("@/api/tasks", () => ({
  tasksApi: {
    getVideoFrame: vi.fn(),
    prefetchVideoFrames: vi.fn(),
  },
}));

const api = vi.mocked(tasksApi);

describe("useVideoFramePreview", () => {
  beforeEach(() => {
    vi.useRealTimers();
    api.getVideoFrame.mockReset();
    api.prefetchVideoFrames.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads a ready frame preview and reuses the in-memory cache", async () => {
    api.getVideoFrame.mockResolvedValue({
      frame_index: 5,
      width: 320,
      format: "webp",
      status: "ready",
      url: "/frame-5.webp",
      retry_after: null,
      error: null,
    });

    const { result } = renderHook(() => useVideoFramePreview({ taskId: "task-1", maxFrame: 9 }));

    act(() => result.current.previewFor(5));

    await waitFor(() => expect(result.current.preview?.status).toBe("ready"));
    expect(result.current.preview?.url).toBe("/frame-5.webp");

    act(() => result.current.previewFor(5));

    expect(api.getVideoFrame).toHaveBeenCalledTimes(1);
  });

  it("retries one pending frame preview request", async () => {
    vi.useFakeTimers();
    api.getVideoFrame
      .mockResolvedValueOnce({
        frame_index: 2,
        width: 320,
        format: "webp",
        status: "pending",
        url: null,
        retry_after: null,
        error: null,
      })
      .mockResolvedValueOnce({
        frame_index: 2,
        width: 320,
        format: "webp",
        status: "ready",
        url: "/frame-2.webp",
        retry_after: null,
        error: null,
      });

    const { result } = renderHook(() => useVideoFramePreview({ taskId: "task-1", maxFrame: 9 }));

    act(() => result.current.previewFor(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.preview?.status).toBe("pending");

    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
    });

    expect(result.current.preview?.status).toBe("ready");
    expect(api.getVideoFrame).toHaveBeenCalledTimes(2);
  });

  it("prefetches unique clamped frames without binding preview state", async () => {
    api.prefetchVideoFrames.mockResolvedValue({
      dataset_item_id: "item-1",
      task_id: "task-1",
      frames: [],
    });

    const { result } = renderHook(() => useVideoFramePreview({ taskId: "task-1", maxFrame: 9 }));

    act(() => result.current.prefetch([1, 1, 20, -2]));

    await waitFor(() => expect(api.prefetchVideoFrames).toHaveBeenCalledWith(
      "task-1",
      [1, 9, 0],
      { width: 320, format: "webp" },
    ));
    expect(result.current.preview).toBeNull();
  });

  it("disables frame preview for unsupported task frame-service routes", async () => {
    api.getVideoFrame.mockRejectedValue(new ApiError(404, "not found"));

    const { result } = renderHook(() => useVideoFramePreview({ taskId: "task-1", maxFrame: 9 }));

    act(() => result.current.previewFor(3));

    await waitFor(() => expect(api.getVideoFrame).toHaveBeenCalledTimes(1));

    act(() => result.current.previewFor(4));

    expect(api.getVideoFrame).toHaveBeenCalledTimes(1);
    expect(result.current.preview).toBeNull();
  });
});
