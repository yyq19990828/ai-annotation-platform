import { describe, expect, it, vi } from "vitest";

import {
  POINT_CLOUD_RENDER_ALL,
  POINT_CLOUD_RENDER_MAIN,
  POINT_CLOUD_RENDER_TRI,
  PointCloudRenderScheduler,
  resolvePointCloudRenderPlan,
} from "./pointCloudRenderScheduler";

function createFrameHarness() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  });
  const cancel = vi.fn((handle: number) => callbacks.delete(handle));
  const flushNext = () => {
    const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) throw new Error("no scheduled frame");
    callbacks.delete(entry[0]);
    entry[1](performance.now());
  };
  return { request, cancel, callbacks, flushNext };
}

describe("PointCloudRenderScheduler", () => {
  it("redraws the main view before a dirty tri-view pass", () => {
    expect(resolvePointCloudRenderPlan(POINT_CLOUD_RENDER_TRI, false)).toEqual({
      renderMain: true,
      renderTri: true,
    });
  });

  it("coalesces dirty reasons into one animation frame", () => {
    const frame = createFrameHarness();
    const render = vi.fn(() => false);
    const scheduler = new PointCloudRenderScheduler(render, frame.request, frame.cancel);

    scheduler.invalidate(POINT_CLOUD_RENDER_MAIN);
    scheduler.invalidate(POINT_CLOUD_RENDER_TRI);

    expect(frame.request).toHaveBeenCalledTimes(1);
    frame.flushNext();
    expect(render).toHaveBeenCalledWith(POINT_CLOUD_RENDER_ALL);
    expect(frame.callbacks.size).toBe(0);
  });

  it("keeps rendering only while the render callback reports motion", () => {
    const frame = createFrameHarness();
    const render = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const scheduler = new PointCloudRenderScheduler(render, frame.request, frame.cancel);

    scheduler.invalidate(POINT_CLOUD_RENDER_TRI);
    frame.flushNext();
    expect(frame.callbacks.size).toBe(1);
    frame.flushNext();

    expect(render).toHaveBeenNthCalledWith(1, POINT_CLOUD_RENDER_TRI);
    expect(render).toHaveBeenNthCalledWith(2, POINT_CLOUD_RENDER_MAIN);
    expect(frame.callbacks.size).toBe(0);
  });

  it("cancels pending work and ignores later invalidations after dispose", () => {
    const frame = createFrameHarness();
    const render = vi.fn();
    const scheduler = new PointCloudRenderScheduler(render, frame.request, frame.cancel);

    scheduler.invalidate();
    scheduler.dispose();
    scheduler.invalidate();

    expect(frame.cancel).toHaveBeenCalledTimes(1);
    expect(frame.callbacks.size).toBe(0);
    expect(frame.request).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });
});
