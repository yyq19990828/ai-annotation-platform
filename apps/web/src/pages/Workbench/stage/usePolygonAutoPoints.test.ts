import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pt } from "./polygonGeom";
import { usePolygonAutoPoints } from "./usePolygonAutoPoints";

function setup(reject = false) {
  let points: Pt[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const auto = {
    getPoints: () => points,
    beforeKey: { current: null as (() => void) | null },
    append: vi.fn((batch: Pt[], expected: Pt[]) => {
      if (reject || expected !== points) return false;
      points = [...points, ...batch];
      return true;
    }),
  };
  const initial = {
    enabled: true,
    owner: "image-1",
    view: "fit",
    width: 1000,
    height: 500,
    draft: { points, addPoint: vi.fn(), cancel: vi.fn(), close: vi.fn(), autoPoints: auto },
    toImage: (x: number, y: number) => ({ x: x / 1000, y: y / 500 }),
    snap: (point: { x: number; y: number }) => ({ point }),
  };
  const hook = renderHook(usePolygonAutoPoints, { initialProps: initial });
  const start = () =>
    act(() =>
      hook.result.current(
        [0, 0],
        new MouseEvent("mousedown", { shiftKey: true, button: 0, buttons: 1 }),
      ),
    );
  const move = (x: number) =>
    act(() =>
      window.dispatchEvent(
        new MouseEvent(typeof PointerEvent === "undefined" ? "mousemove" : "pointermove", {
          clientX: x,
          clientY: 0,
          buttons: 1,
          shiftKey: true,
        }),
      ),
    );
  const flushFrames = () =>
    act(() => {
      for (const [id, cb] of frames) {
        frames.delete(id);
        cb(0);
      }
    });
  return { hook, initial, auto, frames, start, move, flushFrames };
}

afterEach(() => vi.unstubAllGlobals());

describe("Polygon automatic gesture lifecycle", () => {
  it("batches updates and flushes the unsampled endpoint before a keyboard edit", () => {
    const view = setup();
    view.start();
    view.move(10);
    view.move(23);
    expect(view.auto.getPoints()).toEqual([[0, 0]]);
    expect(view.frames.size).toBe(1);
    act(() => view.auto.beforeKey.current?.());
    expect(view.auto.getPoints()).toEqual([
      [0, 0],
      [0.008, 0],
      [0.016, 0],
      [0.023, 0],
    ]);
    expect(view.frames.size).toBe(0);
    view.move(80);
    view.flushFrames();
    expect(view.auto.getPoints()).toHaveLength(4);
    view.hook.unmount();
  });
  it.each([{ owner: "image-2" }, { enabled: false }, { view: "zoomed" }])(
    "retires an unflushed batch on context change: %o",
    (change) => {
      const view = setup();
      view.start();
      view.move(80);
      view.hook.rerender({ ...view.initial, ...change });
      view.flushFrames();
      view.move(160);
      expect(view.auto.getPoints()).toEqual([[0, 0]]);
      expect(view.auto.beforeKey.current).toBeNull();
      view.hook.unmount();
    },
  );
  it("does not install pointer listeners after the draft rejects the first batch", () => {
    const view = setup(true);
    const listen = vi.spyOn(window, "addEventListener");
    view.start();
    expect(
      listen.mock.calls.filter(([type]) =>
        ["pointermove", "mousemove", "pointerup", "mouseup"].includes(type),
      ),
    ).toEqual([]);
    expect(view.auto.getPoints()).toEqual([]);
    view.hook.unmount();
    listen.mockRestore();
  });
});
