import { describe, expect, it } from "vitest";
import type { ImagePyramidManifestV1 } from "./imagePyramid";
import {
  ImageTileScheduler,
  type DecodedImageTile,
  type ImageTileResourceSnapshot,
} from "./imageTileScheduler";
import { RasterResourceCoordinator } from "./shared/rasterResourceCoordinator";

const manifest: ImagePyramidManifestV1 = {
  schema: "aap-image-pyramid/v1",
  generation: 1,
  sourceFingerprint: "sha256:source",
  normalizationVersion: "exif-autorotate-srgb-v1",
  width: 1024,
  height: 512,
  tileSize: 512,
  overlap: 1,
  format: "webp",
  levels: [
    { level: 0, scaleFactor: 1, width: 1024, height: 512, columns: 2, rows: 1 },
    { level: 1, scaleFactor: 2, width: 512, height: 256, columns: 1, rows: 1 },
    { level: 2, scaleFactor: 4, width: 256, height: 128, columns: 1, rows: 1 },
    { level: 3, scaleFactor: 8, width: 128, height: 64, columns: 1, rows: 1 },
    { level: 4, scaleFactor: 16, width: 64, height: 32, columns: 1, rows: 1 },
    { level: 5, scaleFactor: 32, width: 32, height: 16, columns: 1, rows: 1 },
    { level: 6, scaleFactor: 64, width: 16, height: 8, columns: 1, rows: 1 },
    { level: 7, scaleFactor: 128, width: 8, height: 4, columns: 1, rows: 1 },
    { level: 8, scaleFactor: 256, width: 4, height: 2, columns: 1, rows: 1 },
    { level: 9, scaleFactor: 512, width: 2, height: 1, columns: 1, rows: 1 },
    { level: 10, scaleFactor: 1024, width: 1, height: 1, columns: 1, rows: 1 },
  ],
  overview: { width: 512, height: 256, contentDigest: "sha256:overview" },
};

function waitForSnapshot(
  scheduler: ImageTileScheduler,
  predicate: (snapshot: ImageTileResourceSnapshot) => boolean,
): Promise<ImageTileResourceSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("scheduler timeout"));
    }, 1_000);
    const check = () => {
      const snapshot = scheduler.getSnapshot();
      if (!predicate(snapshot)) return;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(snapshot);
    };
    const unsubscribe = scheduler.subscribe(check);
    check();
  });
}

describe("ImageTileScheduler", () => {
  it("signs, decodes, retains, and deterministically releases visible tiles", async () => {
    let released = 0;
    const coordinator = new RasterResourceCoordinator({
      budget: {
        tier: "standard",
        softBudgetBytes: 2 * 1024 * 1024,
        hardBudgetBytes: 3 * 1024 * 1024,
        hiddenFreezeMs: 10,
      },
    });
    const scheduler = new ImageTileScheduler({
      taskId: "task-1",
      sourceIdentity: "source/g1",
      generation: 1,
      manifest,
      budget: { retainedBytes: 4 * 1024 * 1024, concurrency: 2, overscanTiles: 0 },
      resourceCoordinator: coordinator,
      sign: async (coordinates) =>
        new Map(coordinates.map((item) => [`${item.level}/${item.x}/${item.y}`, "tile://ready"])),
      fetchBlob: async () => new Blob(["tile"]),
      decodeBlob: async (_blob, geometry): Promise<DecodedImageTile> => ({
        image: {} as HTMLCanvasElement,
        width: geometry.decodedWidth,
        height: geometry.decodedHeight,
        kind: "bitmap",
        hasObjectUrl: false,
        release: () => {
          released += 1;
        },
      }),
    });

    scheduler.update({ x: 0, y: 0, width: 512, height: 512 }, 1, 1);
    const ready = await waitForSnapshot(scheduler, (snapshot) => snapshot.ready === 1);
    expect(ready).toMatchObject({
      visibleTiles: 1,
      ready: 1,
      fetching: 0,
      signBatches: 1,
      staleCommits: 0,
    });
    expect(scheduler.getTiles()).toHaveLength(1);
    expect(coordinator.getSnapshot()).toMatchObject({
      committedBytes: ready.retainedBytes,
      reservedBytes: 0,
      invariantOk: true,
    });

    scheduler.update({ x: 0, y: 0, width: 512, height: 512 }, 1, 1);
    expect(scheduler.getSnapshot().signBatches).toBe(1);

    scheduler.dispose();
    expect(scheduler.getSnapshot()).toMatchObject({
      ready: 0,
      retainedBytes: 0,
      reservedBytes: 0,
      liveImageBitmaps: 0,
      bitmapsCreated: 1,
      bitmapsClosed: 1,
    });
    expect(released).toBe(1);
    expect(coordinator.getSnapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
  });

  it("drops an old viewport response instead of committing a stale tile", async () => {
    let fetchCalls = 0;
    let released = 0;
    const scheduler = new ImageTileScheduler({
      taskId: "task-1",
      sourceIdentity: "source/g1",
      generation: 1,
      manifest,
      budget: { retainedBytes: 4 * 1024 * 1024, concurrency: 1, overscanTiles: 0 },
      sign: async (coordinates) =>
        new Map(
          coordinates.map((item) => [`${item.level}/${item.x}/${item.y}`, `tile://${item.x}`]),
        ),
      fetchBlob: async (_url, signal) => {
        fetchCalls += 1;
        if (fetchCalls > 1) return new Blob(["tile"]);
        return new Promise((_resolve, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", onAbort, { once: true });
        });
      },
      decodeBlob: async (_blob, geometry) => ({
        image: {} as HTMLCanvasElement,
        width: geometry.decodedWidth,
        height: geometry.decodedHeight,
        kind: "bitmap",
        hasObjectUrl: false,
        release: () => {
          released += 1;
        },
      }),
    });

    scheduler.update({ x: 0, y: 0, width: 512, height: 512 }, 1, 1);
    await waitForSnapshot(scheduler, (snapshot) => snapshot.fetching === 1);
    scheduler.update({ x: 512, y: 0, width: 512, height: 512 }, 1, 1);
    const ready = await waitForSnapshot(
      scheduler,
      (snapshot) => snapshot.ready === 1 && snapshot.fetching === 0,
    );
    expect(ready.aborted).toBeGreaterThanOrEqual(1);
    expect(scheduler.getTiles()[0]?.x).toBe(1);
    expect(released).toBe(0);
    scheduler.dispose();
  });

  it("refreshes a signed URL once after a tile fetch failure", async () => {
    let signCalls = 0;
    let fetchCalls = 0;
    const scheduler = new ImageTileScheduler({
      taskId: "task-1",
      sourceIdentity: "source/g1",
      generation: 1,
      manifest,
      budget: { retainedBytes: 4 * 1024 * 1024, concurrency: 1, overscanTiles: 0 },
      sign: async (coordinates) => {
        signCalls += 1;
        return new Map(
          coordinates.map((item) => [
            `${item.level}/${item.x}/${item.y}`,
            `tile://signed-${signCalls}`,
          ]),
        );
      },
      fetchBlob: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) throw new Error("tile_fetch_403");
        return new Blob(["tile"]);
      },
      decodeBlob: async (_blob, geometry) => ({
        image: {} as HTMLCanvasElement,
        width: geometry.decodedWidth,
        height: geometry.decodedHeight,
        kind: "bitmap",
        hasObjectUrl: false,
        release: () => {},
      }),
    });

    scheduler.update({ x: 0, y: 0, width: 512, height: 512 }, 1, 1);
    const ready = await waitForSnapshot(scheduler, (snapshot) => snapshot.ready === 1);
    expect(ready).toMatchObject({
      errors: 1,
      signBatches: 2,
      urlRefreshes: 1,
      targetCoverageRatio: 1,
    });
    expect(fetchCalls).toBe(2);
    scheduler.dispose();
  });

  it("BFCache pressure releases even currently visible decoded tiles", async () => {
    const coordinator = new RasterResourceCoordinator({
      budget: {
        tier: "standard",
        softBudgetBytes: 2 * 1024 * 1024,
        hardBudgetBytes: 3 * 1024 * 1024,
        hiddenFreezeMs: 10,
      },
    });
    const scheduler = new ImageTileScheduler({
      taskId: "task-1",
      sourceIdentity: "source/g1",
      generation: 1,
      manifest,
      budget: { retainedBytes: 4 * 1024 * 1024, concurrency: 1, overscanTiles: 0 },
      resourceCoordinator: coordinator,
      sign: async (coordinates) =>
        new Map(coordinates.map((item) => [`${item.level}/${item.x}/${item.y}`, "tile://ready"])),
      fetchBlob: async () => new Blob(["tile"]),
      decodeBlob: async (_blob, geometry) => ({
        image: {} as HTMLCanvasElement,
        width: geometry.decodedWidth,
        height: geometry.decodedHeight,
        kind: "bitmap",
        hasObjectUrl: false,
        release: () => undefined,
      }),
    });
    scheduler.update({ x: 0, y: 0, width: 512, height: 512 }, 1, 1);
    await waitForSnapshot(scheduler, (snapshot) => snapshot.ready === 1);

    coordinator.handlePageHide(true);
    expect(scheduler.getSnapshot()).toMatchObject({ ready: 0, retainedBytes: 0 });
    expect(coordinator.getSnapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
    coordinator.handlePageShow(true);
    await waitForSnapshot(scheduler, (snapshot) => snapshot.ready === 1);
    expect(coordinator.getSnapshot()).toMatchObject({
      generation: 2,
      reservedBytes: 0,
      invariantOk: true,
    });
    scheduler.dispose();
  });

  it("requeues an in-flight visible tile when BFCache restores before abort settles", async () => {
    let fetchCalls = 0;
    const coordinator = new RasterResourceCoordinator({
      budget: {
        tier: "standard",
        softBudgetBytes: 2 * 1024 * 1024,
        hardBudgetBytes: 3 * 1024 * 1024,
        hiddenFreezeMs: 10,
      },
    });
    const scheduler = new ImageTileScheduler({
      taskId: "task-1",
      sourceIdentity: "source/g1",
      generation: 1,
      manifest,
      budget: { retainedBytes: 4 * 1024 * 1024, concurrency: 1, overscanTiles: 0 },
      resourceCoordinator: coordinator,
      sign: async (coordinates) =>
        new Map(coordinates.map((item) => [`${item.level}/${item.x}/${item.y}`, "tile://ready"])),
      fetchBlob: async (_url, signal) => {
        fetchCalls += 1;
        if (fetchCalls > 1) return new Blob(["tile"]);
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
      decodeBlob: async (_blob, geometry) => ({
        image: {} as HTMLCanvasElement,
        width: geometry.decodedWidth,
        height: geometry.decodedHeight,
        kind: "bitmap",
        hasObjectUrl: false,
        release: () => undefined,
      }),
    });
    scheduler.update({ x: 0, y: 0, width: 512, height: 512 }, 1, 1);
    await waitForSnapshot(scheduler, (snapshot) => snapshot.fetching === 1);

    coordinator.handlePageHide(true);
    coordinator.handlePageShow(true);

    const restored = await waitForSnapshot(
      scheduler,
      (snapshot) => snapshot.ready === 1 && snapshot.targetCoverageRatio === 1,
    );
    expect(fetchCalls).toBe(2);
    expect(restored).toMatchObject({ fetching: 0, reservedBytes: 0 });
    expect(coordinator.getSnapshot()).toMatchObject({
      generation: 2,
      invariantOk: true,
    });
    scheduler.dispose();
  });
});
