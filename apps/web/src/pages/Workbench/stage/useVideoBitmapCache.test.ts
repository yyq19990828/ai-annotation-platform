import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoBitmapCache } from "./useVideoBitmapCache";

/** close 带 spy 的假 ImageBitmap(width 用于模拟 close 后被中和)。 */
function makeBitmap(): ImageBitmap {
  return { width: 1920, height: 1080, close: vi.fn() } as unknown as ImageBitmap;
}

// readyState 4 / 有宽高 → 通过 capture 的就绪门槛。
const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;

describe("useVideoBitmapCache · capture 去重", () => {
  beforeEach(() => {
    // jsdom 默认无 createImageBitmap;每次返回一个新的假位图,便于断言"是否重抓"。
    (window as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(async () => makeBitmap());
  });

  afterEach(() => {
    delete (window as unknown as { createImageBitmap?: unknown }).createImageBitmap;
    vi.restoreAllMocks();
  });

  it("同一帧重复 capture 复用缓存位图:不重抓、不 close 正在显示的位图", async () => {
    const { result } = renderHook(() => useVideoBitmapCache({ taskId: "task-1" }));
    const createBitmap = (window as unknown as { createImageBitmap: ReturnType<typeof vi.fn> }).createImageBitmap;

    let first: Awaited<ReturnType<typeof result.current.capture>> = null;
    await act(async () => {
      first = await result.current.capture(video, 0);
    });
    expect(first).not.toBeNull();
    expect(createBitmap).toHaveBeenCalledTimes(1);

    let second: Awaited<ReturnType<typeof result.current.capture>> = null;
    await act(async () => {
      second = await result.current.capture(video, 0);
    });

    // 复用同一缓存项,没有再次 createImageBitmap。
    expect(second).toBe(first);
    expect(createBitmap).toHaveBeenCalledTimes(1);
    // 关键回归点:正在显示的位图不能被 close(close 后 width=0 → Konva drawImage 黑屏/“image source is detached”)。
    expect((first as unknown as { bitmap: { close: ReturnType<typeof vi.fn> } }).bitmap.close).not.toHaveBeenCalled();
    // 复用路径仍把该帧置为 active,保证立即显示。
    expect(result.current.activeBitmap).toBe(first);
  });

  it("不同帧分别 capture 各自解码一次", async () => {
    const { result } = renderHook(() => useVideoBitmapCache({ taskId: "task-1" }));
    const createBitmap = (window as unknown as { createImageBitmap: ReturnType<typeof vi.fn> }).createImageBitmap;

    await act(async () => {
      await result.current.capture(video, 0);
    });
    await act(async () => {
      await result.current.capture(video, 1);
    });

    expect(createBitmap).toHaveBeenCalledTimes(2);
  });
});
