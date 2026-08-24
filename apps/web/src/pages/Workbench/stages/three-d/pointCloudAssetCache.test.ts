import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPointCloudBuffer, prefetchPointCloudBuffer } from "./pointCloudAssetCache";

describe("pointCloudAssetCache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses an in-flight prefetched PCD request when the frame becomes current", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const prefetch = prefetchPointCloudBuffer("https://assets.test/frame-101.pcd");
    const loaded = loadPointCloudBuffer("https://assets.test/frame-101.pcd");

    await expect(prefetch).resolves.toBeUndefined();
    await expect(loaded).resolves.toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed request so a later frame load can retry", async () => {
    const bytes = new Uint8Array([4, 5, 6]).buffer;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("failed", { status: 503 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPointCloudBuffer("https://assets.test/frame-retry.pcd")).rejects.toThrow(
      "503",
    );
    await expect(loadPointCloudBuffer("https://assets.test/frame-retry.pcd")).resolves.toEqual(
      bytes,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
