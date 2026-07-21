import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CocoRleMaskRef } from "@/types";
import { encodeCocoRle, type CocoRle } from "./geometry/maskRle";
import {
  rasterMaskRecordCacheKey,
  useRasterMaskRecords,
  type RasterMaskRecordDescriptor,
} from "./useRasterMaskRecords";

class FakeImageBitmap {
  close = vi.fn();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync(rounds = 8) {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  });
}

let digestCounter = 0;

function makeDescriptor(
  id: string,
  options: {
    revision?: number;
    selected?: boolean;
    zOrder?: number;
    load?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const pixels = Uint8Array.from([
    255, 0, 0,
    0, 255, 0,
  ]);
  const rle = encodeCocoRle(pixels, 3, 2);
  digestCounter += 1;
  const digest = digestCounter.toString(16).padStart(64, "0");
  const ref: CocoRleMaskRef = {
    encoding: "coco_rle_ref",
    size: rle.size,
    object_key: `raster-masks/${digest}.json`,
    sha256: digest,
    runs: rle.counts.length,
    bytes: JSON.stringify(rle).length,
  };
  const load = options.load ?? vi.fn(async () => rle);
  const descriptor: RasterMaskRecordDescriptor<"annotation"> = {
    id,
    source: "annotation",
    ref,
    revision: options.revision ?? 1,
    color: "#102030",
    colorRevision: "class-color-1",
    zOrder: options.zOrder ?? 0,
    selected: options.selected ?? false,
    load,
  };
  return { descriptor, load, rle };
}

describe("useRasterMaskRecords", () => {
  let bitmaps: FakeImageBitmap[];
  let createBitmap: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    digestCounter = 0;
    bitmaps = [];
    createBitmap = vi.fn(async () => {
      const bitmap = new FakeImageBitmap();
      bitmaps.push(bitmap);
      return bitmap;
    });
    vi.stubGlobal("ImageData", class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    });
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    vi.stubGlobal("createImageBitmap", createBitmap);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keys content revisions without including selected or z-order", () => {
    const item = makeDescriptor("mask");
    const key = rasterMaskRecordCacheKey(item.descriptor);

    expect(rasterMaskRecordCacheKey({ ...item.descriptor, selected: true, zOrder: 99 })).toBe(key);
    expect(rasterMaskRecordCacheKey({ ...item.descriptor, revision: 2 })).not.toBe(key);
    expect(rasterMaskRecordCacheKey({ ...item.descriptor, colorRevision: "class-color-2" })).not.toBe(key);
    expect(rasterMaskRecordCacheKey({
      ...item.descriptor,
      ref: { ...item.descriptor.ref, sha256: "f".repeat(64) },
    })).not.toBe(key);
  });

  it("keeps ready siblings when one object fails and retries only the target", async () => {
    const ready = makeDescriptor("ready");
    const retryingLoad = vi.fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(ready.rle);
    const retrying = makeDescriptor("retrying", { load: retryingLoad });
    const view = renderHook(() => useRasterMaskRecords({
      scopeKey: "task-1",
      descriptors: [ready.descriptor, retrying.descriptor],
    }));

    await flushAsync();

    expect(view.result.current.records.map((record) => record.id)).toEqual(["ready"]);
    expect(view.result.current.statusById.get("ready")?.state).toBe("ready");
    expect(view.result.current.statusById.get("retrying")).toMatchObject({
      state: "error",
      reason: "unavailable",
      message: "Mask 内容暂时不可用",
      retryable: true,
      httpStatus: 503,
    });

    act(() => view.result.current.retry("retrying"));
    await flushAsync();

    expect(ready.load).toHaveBeenCalledTimes(1);
    expect(retryingLoad).toHaveBeenCalledTimes(2);
    expect(view.result.current.records.map((record) => record.id)).toEqual(["ready", "retrying"]);
  });

  it("does not reload when only selected and z-order change", async () => {
    const item = makeDescriptor("mask");
    const view = renderHook(
      ({ descriptor }) => useRasterMaskRecords({
        scopeKey: "task-1",
        descriptors: [descriptor],
      }),
      { initialProps: { descriptor: item.descriptor } },
    );
    await flushAsync();

    const originalKey = rasterMaskRecordCacheKey(item.descriptor);
    view.rerender({
      descriptor: { ...item.descriptor, selected: true, zOrder: 12 },
    });

    expect(item.load).toHaveBeenCalledTimes(1);
    expect(view.result.current.records[0]).toMatchObject({
      selected: true,
      zOrder: 12,
      cacheKey: originalKey,
    });
  });

  it("withdraws a superseded record immediately and closes a late bitmap", async () => {
    const firstItem = makeDescriptor("mask");
    const lateLoad = deferred<CocoRle>();
    const lateItem = makeDescriptor("mask", { revision: 2, load: vi.fn(() => lateLoad.promise) });
    const latestItem = makeDescriptor("mask", { revision: 3 });
    // Keep the content digest stable so revision alone invalidates each cache key.
    lateItem.descriptor.ref = firstItem.descriptor.ref;
    latestItem.descriptor.ref = firstItem.descriptor.ref;
    const view = renderHook(
      ({ descriptor }) => useRasterMaskRecords({
        scopeKey: "task-1",
        descriptors: [descriptor],
      }),
      { initialProps: { descriptor: firstItem.descriptor } },
    );

    await flushAsync();
    expect(view.result.current.records[0]?.cacheKey).toBe(rasterMaskRecordCacheKey(firstItem.descriptor));

    view.rerender({ descriptor: lateItem.descriptor });
    expect(view.result.current.records).toEqual([]);
    expect(view.result.current.statusById.get("mask")?.state).toBe("loading");

    view.rerender({ descriptor: latestItem.descriptor });
    await flushAsync();
    expect(view.result.current.records[0]?.cacheKey).toBe(rasterMaskRecordCacheKey(latestItem.descriptor));

    lateLoad.resolve(lateItem.rle);
    await flushAsync();

    expect(bitmaps).toHaveLength(3);
    expect(bitmaps[0].close).not.toHaveBeenCalled();
    expect(bitmaps[1].close).not.toHaveBeenCalled();
    expect(bitmaps[2].close).toHaveBeenCalledTimes(1);
    expect(view.result.current.records[0]?.image).toBe(bitmaps[1]);
  });

  it("starts at most four loads and advances the queue one completion at a time", async () => {
    const pending = Array.from({ length: 6 }, () => deferred<CocoRle>());
    const items = pending.map((request, index) => makeDescriptor(`mask-${index}`, {
      load: vi.fn(() => request.promise),
    }));
    const view = renderHook(() => useRasterMaskRecords({
      scopeKey: "task-1",
      descriptors: items.map((item) => item.descriptor),
    }));

    expect(items.map((item) => item.load.mock.calls.length)).toEqual([1, 1, 1, 1, 0, 0]);

    pending[0].resolve(items[0].rle);
    await flushAsync();
    expect(items.map((item) => item.load.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 0]);

    for (let index = 1; index < pending.length; index += 1) pending[index].resolve(items[index].rle);
    await flushAsync(16);
    expect(view.result.current.records).toHaveLength(6);
  });

  it("LRU eviction, scope reset, and unmount close each cached bitmap once", async () => {
    const first = makeDescriptor("first");
    const second = makeDescriptor("second");
    const third = makeDescriptor("third");
    const view = renderHook(
      ({ scope, items }) => useRasterMaskRecords({
        scopeKey: scope,
        descriptors: items,
        maxCachedRecords: 2,
      }),
      {
        initialProps: {
          scope: "task-1",
          items: [first.descriptor, second.descriptor],
        },
      },
    );
    await flushAsync();

    view.rerender({ scope: "task-1", items: [second.descriptor, third.descriptor] });
    await flushAsync();
    expect(bitmaps).toHaveLength(3);
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[1].close).not.toHaveBeenCalled();
    expect(bitmaps[2].close).not.toHaveBeenCalled();

    view.rerender({ scope: "task-2", items: [] });
    expect(bitmaps[1].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[2].close).toHaveBeenCalledTimes(1);
    view.unmount();
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("closes an image created after unmount exactly once", async () => {
    const bitmapReady = deferred<FakeImageBitmap>();
    const lateBitmap = new FakeImageBitmap();
    createBitmap.mockImplementationOnce(() => bitmapReady.promise);
    const item = makeDescriptor("late");
    const view = renderHook(() => useRasterMaskRecords({
      scopeKey: "task-1",
      descriptors: [item.descriptor],
    }));

    await flushAsync();
    expect(createBitmap).toHaveBeenCalledTimes(1);
    view.unmount();
    bitmapReady.resolve(lateBitmap);
    await flushAsync();

    expect(lateBitmap.close).toHaveBeenCalledTimes(1);
  });
});
