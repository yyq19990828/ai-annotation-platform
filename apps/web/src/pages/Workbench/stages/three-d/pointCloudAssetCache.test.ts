import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskPointCloudManifestResponse } from "@/api/generated";
import type { SensorCalibration } from "@/types";

const buildDepthRastersMock = vi.hoisted(() => vi.fn());
const decodePointCloudFrameAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("./geometry/pointCloudComputeSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./geometry/pointCloudComputeSession")>();
  return {
    ...actual,
    decodePointCloudFrameAsync: decodePointCloudFrameAsyncMock,
    getPointCloudComputeSession: () => ({ buildDepthRasters: buildDepthRastersMock }),
  };
});

import {
  acquireCameraBitmap,
  loadPointCloudDepthRasters,
  loadPointCloudBuffer,
  prefetchPointCloudFrameAssets,
  prefetchPointCloudBuffer,
} from "./pointCloudAssetCache";

const CALIBRATION: SensorCalibration = {
  extrinsic: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  intrinsic: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

function depthResult(length = 4) {
  return [{ cols: length, rows: 1, depth: new Float32Array(length).fill(1) }];
}

describe("pointCloudAssetCache", () => {
  beforeEach(() => {
    buildDepthRastersMock.mockReset().mockResolvedValue(depthResult());
    decodePointCloudFrameAsyncMock.mockReset();
  });

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

  it("reuses decoded bitmaps and closes an unpinned LRU entry", async () => {
    const closeById = new Map<number, ReturnType<typeof vi.fn>>();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(async () => {
        const id = closeById.size;
        const close = vi.fn();
        closeById.set(id, close);
        return { width: 8, height: 4, close } as unknown as ImageBitmap;
      }),
    );

    const [firstA, firstB] = await Promise.all([
      acquireCameraBitmap("https://assets.test/camera-shared.jpg"),
      acquireCameraBitmap("https://assets.test/camera-shared.jpg"),
    ]);
    expect(firstA.bitmap).toBe(firstB.bitmap);
    expect(firstA.cacheReady).toBe(false);
    expect(firstB.cacheReady).toBe(false);
    const ready = await acquireCameraBitmap("https://assets.test/camera-shared.jpg");
    expect(ready.cacheReady).toBe(true);
    firstA.release();
    firstB.release();
    ready.release();

    const handles = await Promise.all(
      Array.from({ length: 18 }, (_, index) =>
        acquireCameraBitmap(`https://assets.test/camera-${index}.jpg`),
      ),
    );
    handles.forEach((handle) => handle.release());

    expect(closeById.get(0)).toHaveBeenCalledTimes(1);
  });

  it("merges concurrent depth-raster requests and reports the cache hit", async () => {
    let resolveDepth!: (value: ReturnType<typeof depthResult>) => void;
    buildDepthRastersMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDepth = resolve;
      }),
    );
    const positions = new Float32Array([0, 0, 1]);
    const cameras = [{ calibration: CALIBRATION, width: 8, height: 8 }];

    const first = loadPointCloudDepthRasters(
      "https://assets.test/depth-shared.pcd",
      positions,
      cameras,
    );
    const second = loadPointCloudDepthRasters(
      "https://assets.test/depth-shared.pcd",
      positions,
      cameras,
    );
    resolveDepth(depthResult());

    await expect(first).resolves.toMatchObject({ cacheHit: false });
    await expect(second).resolves.toMatchObject({ cacheHit: true });
    expect(buildDepthRastersMock).toHaveBeenCalledTimes(1);
  });

  it("removes failed depth requests so the same frame can retry", async () => {
    buildDepthRastersMock
      .mockRejectedValueOnce(new Error("worker failed"))
      .mockResolvedValueOnce(depthResult());
    const positions = new Float32Array([0, 0, 1]);
    const cameras = [{ calibration: CALIBRATION, width: 8, height: 8 }];

    await expect(
      loadPointCloudDepthRasters("https://assets.test/depth-retry.pcd", positions, cameras),
    ).rejects.toThrow("worker failed");
    await expect(
      loadPointCloudDepthRasters("https://assets.test/depth-retry.pcd", positions, cameras),
    ).resolves.toMatchObject({ cacheHit: false });
    expect(buildDepthRastersMock).toHaveBeenCalledTimes(2);
  });

  it("evicts depth rasters beyond the eight-key LRU limit", async () => {
    const positions = new Float32Array([0, 0, 1]);
    const cameras = [{ calibration: CALIBRATION, width: 8, height: 8 }];
    for (let index = 0; index < 9; index += 1) {
      await loadPointCloudDepthRasters(
        `https://assets.test/depth-lru-${index}.pcd`,
        positions,
        cameras,
      );
    }
    await loadPointCloudDepthRasters("https://assets.test/depth-lru-0.pcd", positions, cameras);

    expect(buildDepthRastersMock).toHaveBeenCalledTimes(10);
  });

  it("does not retain a single depth raster larger than the byte budget", async () => {
    buildDepthRastersMock.mockResolvedValue(depthResult(2_097_153));
    const positions = new Float32Array([0, 0, 1]);
    const cameras = [{ calibration: CALIBRATION, width: 8, height: 8 }];
    const url = "https://assets.test/depth-over-budget.pcd";

    await loadPointCloudDepthRasters(url, positions, cameras);
    await loadPointCloudDepthRasters(url, positions, cameras);

    expect(buildDepthRastersMock).toHaveBeenCalledTimes(2);
  });

  it("starts depth-raster prefetch without holding the frame-navigation promise open", async () => {
    let resolveDepth!: (value: ReturnType<typeof depthResult>) => void;
    buildDepthRastersMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDepth = resolve;
      }),
    );
    decodePointCloudFrameAsyncMock.mockResolvedValueOnce({
      positions: new Float32Array([0, 0, 1]),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]), { status: 200 })),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 8, height: 4, close: vi.fn() }),
    );
    const manifest = {
      point_cloud_url: "https://assets.test/frame-background-depth.pcd",
      axis_convention: "iso_8855",
      cameras: [
        {
          role: "front",
          image_url: "https://assets.test/frame-background-depth.jpg",
          calibration: CALIBRATION,
        },
      ],
    } as unknown as TaskPointCloudManifestResponse;

    const prefetch = prefetchPointCloudFrameAssets(manifest, { depthRasters: true });
    await vi.waitFor(() => expect(buildDepthRastersMock).toHaveBeenCalledTimes(1));
    const completedBeforeDepth = await Promise.race([
      prefetch.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0)),
    ]);
    resolveDepth(depthResult());
    await prefetch;

    expect(completedBeforeDepth).toBe(true);
  });
});
