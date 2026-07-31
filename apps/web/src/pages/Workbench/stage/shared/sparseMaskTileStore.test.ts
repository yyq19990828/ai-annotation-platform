import { describe, expect, it } from "vitest";
import { MaskBuffer } from "./geometry/maskBuffer";
import { decodeCocoRle, encodeCocoRle, type CocoRle } from "./geometry/maskRle";
import type { MaskHistoryCommand } from "./maskHistory";
import {
  buildRasterMaskWorkerSession,
  decodeRasterMaskSessionTile,
  mergeRasterMaskSessionTiles,
  morphologyRasterMaskSessionRoi,
  type RasterMaskWorkerSession,
} from "./rasterMaskWorkerRuntime";
import type { RasterMaskWorkerRunOptions } from "./rasterMaskWorkerPool";
import type { RasterMaskTileOverride, RasterMaskTileRect } from "./rasterMaskWorkerProtocol";
import {
  SparseMaskTileBudgetError,
  sparseMaskCpuComputeBudgetBytes,
  sparseMaskGpuBufferBudgetBytes,
  SparseMaskTileStore,
  sparseMaskTileBudgetBytes,
  type SparseMaskTileBackend,
} from "./sparseMaskTileStore";

class RuntimeTileBackend implements SparseMaskTileBackend {
  readonly sessions = new Map<string, RasterMaskWorkerSession>();
  decodeCalls: RasterMaskTileRect[] = [];
  mergeCalls: RasterMaskTileOverride[][] = [];
  lastMorphologyRequest: Parameters<SparseMaskTileBackend["morphologyRoi"]>[0] | null = null;

  registerSession(sessionId: string, sha256: string, rle: CocoRle): void {
    this.sessions.set(
      sessionId,
      buildRasterMaskWorkerSession(sha256, {
        size: [rle.size[0], rle.size[1]],
        counts: Uint32Array.from(rle.counts),
      }),
    );
  }

  releaseSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  async decodeTile(
    sessionId: string,
    sha256: string,
    rect: RasterMaskTileRect,
    _options?: RasterMaskWorkerRunOptions,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session || session.sha256 !== sha256) throw new Error("missing session");
    this.decodeCalls.push(rect);
    return { sessionId, sha256, rect, alpha: decodeRasterMaskSessionTile(session, rect) };
  }

  async mergeTiles(sessionId: string, sha256: string, tiles: readonly RasterMaskTileOverride[]) {
    const session = this.sessions.get(sessionId);
    if (!session || session.sha256 !== sha256) throw new Error("missing session");
    this.mergeCalls.push([...tiles]);
    return { sessionId, sha256, rle: mergeRasterMaskSessionTiles(session, tiles) };
  }

  async morphologyRoi(
    request: Parameters<SparseMaskTileBackend["morphologyRoi"]>[0],
  ): ReturnType<SparseMaskTileBackend["morphologyRoi"]> {
    const session = this.sessions.get(request.sessionId);
    if (!session || session.sha256 !== request.sha256) throw new Error("missing session");
    this.lastMorphologyRequest = request;
    return {
      kind: "morphology_roi",
      id: 1,
      ok: true,
      sessionId: request.sessionId,
      sha256: request.sha256,
      ...morphologyRasterMaskSessionRoi(session, request),
    };
  }
}

class BoundedDecodeBackend extends RuntimeTileBackend {
  activeDecodes = 0;
  maxActiveDecodes = 0;

  override async decodeTile(
    sessionId: string,
    sha256: string,
    rect: RasterMaskTileRect,
    options?: RasterMaskWorkerRunOptions,
  ) {
    this.activeDecodes += 1;
    this.maxActiveDecodes = Math.max(this.maxActiveDecodes, this.activeDecodes);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return await super.decodeTile(sessionId, sha256, rect, options);
    } finally {
      this.activeDecodes -= 1;
    }
  }
}

class DeferredMorphologyBackend extends RuntimeTileBackend {
  private startedResolve!: () => void;
  private resumeResolve!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });
  private readonly resumePromise = new Promise<void>((resolve) => {
    this.resumeResolve = resolve;
  });

  override async morphologyRoi(
    request: Parameters<SparseMaskTileBackend["morphologyRoi"]>[0],
  ): ReturnType<SparseMaskTileBackend["morphologyRoi"]> {
    this.startedResolve();
    await this.resumePromise;
    return super.morphologyRoi(request);
  }

  resume(): void {
    this.resumeResolve();
  }
}

function blankRle(width: number, height: number): CocoRle {
  return { encoding: "coco_rle", size: [height, width], counts: [width * height] };
}

function makeStore(
  width: number,
  height: number,
  baseRle = blankRle(width, height),
  maxCacheBytes?: number,
) {
  const backend = new RuntimeTileBackend();
  const store = new SparseMaskTileStore({
    sessionId: "task:mask:1",
    sha256: "sha",
    baseRle,
    backend,
    ...(maxCacheBytes == null ? {} : { maxCacheBytes }),
  });
  return { backend, store };
}

function retain(
  store: SparseMaskTileStore,
  command: MaskHistoryCommand | null,
): MaskHistoryCommand {
  expect(command).not.toBeNull();
  store.retainHistoryCommand(command!);
  return command!;
}

describe("SparseMaskTileStore", () => {
  it("decodes only requested tiles and preserves non-divisible edge dimensions", async () => {
    const { backend, store } = makeStore(1025, 513);
    const edge = await store.materializeTile(2, 1);
    expect(edge).toMatchObject({ x: 1024, y: 512, width: 1, height: 1 });
    expect(backend.decodeCalls).toEqual([{ x: 1024, y: 512, width: 1, height: 1 }]);
    expect(store.snapshot()).toMatchObject({ liveTiles: 1, dirtyTiles: 0 });
  });

  it("shares pixel-center brush/lasso semantics with dense MaskBuffer and merges canonically", async () => {
    const width = 1025;
    const height = 513;
    const { backend, store } = makeStore(width, height);
    const dense = new MaskBuffer({ width, height });
    const checkpoint = store.beginHistoryCheckpoint();
    await store.brush({ cx: 512, cy: 256, radius: 3, value: 255, shape: "circle", checkpoint });
    dense.brush(512, 256, 3, 255, "circle");
    const polygon = [
      [510, 254],
      [518, 254],
      [518, 260],
      [510, 260],
    ] as const;
    await store.lasso(polygon, 0, { checkpoint });
    dense.fromPolygon(polygon, 0);

    const command = retain(store, store.finishHistoryCheckpoint(checkpoint, "mixed", 4));
    expect(command.patches.map((patch) => patch.tileX)).toEqual([0, 1]);
    expect(store.containsPixel(512, 256)).toBe(false);
    store.applyHistoryCommand(command);
    expect(store.containsPixel(512, 256)).toBe(false);
    expect(store.snapshot().dirtyTiles).toBe(0);
    store.applyHistoryCommand(command);

    const merged = await store.merge();
    expect(decodeCocoRle(merged)).toEqual(dense.data);
    expect(backend.mergeCalls).toHaveLength(1);
    expect(backend.mergeCalls[0].length).toBe(2);
  });

  it("applies Worker morphology patches atomically across tiles and reuses them for history", async () => {
    const width = 513;
    const height = 5;
    const baseAlpha = new Uint8Array(width * height);
    baseAlpha[2 * width + 511] = 255;
    const base = encodeCocoRle(baseAlpha, width, height);
    const { store } = makeStore(width, height, base);
    const command = await store.morphologyRoi(
      { x: 510, y: 1, width: 3, height: 3 },
      { operation: "dilate", kernelShape: "square", radius: 1 },
      { name: "dilate", sourceRevision: 7 },
    );

    expect(command).toMatchObject({ name: "dilate", sourceRevision: 7, changedPixels: 8 });
    expect(command?.patches.map((patch) => patch.tileX)).toEqual([0, 1]);
    expect(store.containsPixel(510, 1)).toBe(true);
    expect(store.containsPixel(512, 3)).toBe(true);

    store.applyHistoryCommand(command!);
    expect(store.containsPixel(510, 1)).toBe(false);
    expect(store.containsPixel(511, 2)).toBe(true);
    expect(store.snapshot().dirtyTiles).toBe(0);
    store.applyHistoryCommand(command!);

    const expected = new Uint8Array(baseAlpha);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 510; x <= 512; x += 1) expected[y * width + x] = 255;
    }
    expect(decodeCocoRle(await store.merge())).toEqual(expected);
  });

  it("keeps a positive CPU budget when the low-memory GPU budget disables WebGPU", async () => {
    const backend = new RuntimeTileBackend();
    const store = new SparseMaskTileStore({
      sessionId: "low-memory",
      sha256: "low-memory-sha",
      baseRle: blankRle(16, 8),
      backend,
      deviceMemory: 2,
      morphologyBackendPolicy: "webgpu-candidate",
    });

    await store.morphologyRoi(
      { x: 0, y: 0, width: 16, height: 8 },
      { operation: "dilate", kernelShape: "square", radius: 1 },
      { name: "low-memory", sourceRevision: 0 },
    );

    expect(backend.lastMorphologyRequest).toMatchObject({
      backendPolicy: "cpu",
      cpuComputeBudgetBytes: 32 * 1024 * 1024,
      gpuBufferBudgetBytes: 0,
    });
  });

  it("bounds tile decode concurrency for ROIs larger than the Worker queue", async () => {
    const width = 512 * 33;
    const height = 1;
    const backend = new BoundedDecodeBackend();
    const store = new SparseMaskTileStore({
      sessionId: "wide-roi",
      sha256: "wide-roi-sha",
      baseRle: blankRle(width, height),
      backend,
    });

    await expect(
      store.morphologyRoi(
        { x: 0, y: 0, width, height },
        { operation: "dilate", kernelShape: "square", radius: 1 },
        { name: "wide-dilate", sourceRevision: 0 },
      ),
    ).resolves.toBeNull();
    expect(backend.decodeCalls).toHaveLength(33);
    expect(backend.maxActiveDecodes).toBeLessThanOrEqual(2);
  });

  it("feeds packed brush overrides into Worker morphology and keeps no-op revisions stable", async () => {
    const { store } = makeStore(513, 5);
    await store.brush({ cx: 511, cy: 2, radius: 0.5, value: 255, shape: "square" });
    const command = await store.morphologyRoi(
      { x: 510, y: 1, width: 3, height: 3 },
      { operation: "dilate", kernelShape: "square", radius: 1 },
      { name: "dirty-dilate", sourceRevision: 1 },
    );
    expect(command?.changedPixels).toBe(8);
    expect(store.containsPixel(512, 3)).toBe(true);
    const afterFirst = store.getRenderableTiles().map((tile) => tile.revision);

    const noOp = await store.morphologyRoi(
      { x: 510, y: 1, width: 3, height: 3 },
      { operation: "dilate", kernelShape: "square", radius: 1 },
      { name: "no-op", sourceRevision: 2 },
    );
    expect(noOp).toBeNull();
    expect(store.getRenderableTiles().map((tile) => tile.revision)).toEqual(afterFirst);
  });

  it("rejects a morphology response after any concurrent store mutation", async () => {
    const width = 1025;
    const height = 4;
    const backend = new DeferredMorphologyBackend();
    const store = new SparseMaskTileStore({
      sessionId: "stale-morphology",
      sha256: "stale-sha",
      baseRle: blankRle(width, height),
      backend,
    });
    const operation = store.morphologyRoi(
      { x: 1024, y: 1, width: 1, height: 1 },
      { operation: "dilate", kernelShape: "square", radius: 1 },
      { name: "stale", sourceRevision: 0 },
    );
    await backend.started;
    await store.brush({ cx: 0, cy: 0, radius: 0.5, value: 255, shape: "square" });
    const rejection = expect(operation).rejects.toThrow(/source changed/);
    backend.resume();

    await rejection;
    expect(store.containsPixel(0, 0)).toBe(true);
    expect(store.containsPixel(1024, 1)).toBe(false);
  });

  it("subtracts from an immutable foreground base while exact picking reads overrides first", async () => {
    const width = 1025;
    const height = 4;
    const base = {
      encoding: "coco_rle" as const,
      size: [height, width] as [number, number],
      counts: [0, width * height],
    };
    const { store } = makeStore(width, height, base);
    expect(store.containsPixel(512, 1)).toBe(true);
    await store.lasso(
      [
        [510, 0],
        [515, 0],
        [515, 4],
        [510, 4],
      ],
      0,
    );
    expect(store.containsPixel(509, 1)).toBe(true);
    expect(store.containsPixel(512, 1)).toBe(false);
    expect(store.containsPixel(516, 1)).toBe(true);
  });

  it("pins only viewport plus one ring and uses overview instead of materializing a full zoom-out", async () => {
    const { backend, store } = makeStore(4096, 4096);
    const rects = store.setViewport({ x: 1024, y: 1024, width: 512, height: 512 });
    expect(rects).toHaveLength(9);
    await store.loadViewport();
    expect(backend.decodeCalls).toHaveLength(9);
    expect(store.snapshot()).toMatchObject({
      liveTiles: 9,
      viewportPinnedTiles: 9,
      overviewOnly: false,
    });

    expect(store.setViewport({ x: 0, y: 0, width: 4096, height: 4096 })).toEqual([]);
    await store.loadViewport();
    expect(backend.decodeCalls).toHaveLength(9);
    expect(store.snapshot()).toMatchObject({ viewportPinnedTiles: 0, overviewOnly: true });
  });

  it("evicts the least-recent clean tile before admission", async () => {
    const fullTileBytes = 512 * 512 + ((512 * 512) / 8) * 2 + 96;
    const { store } = makeStore(1536, 512, undefined, fullTileBytes * 2);
    await store.materializeTile(0, 0);
    await store.materializeTile(1, 0);
    store.containsPixel(0, 0);
    await store.materializeTile(2, 0);
    expect(store.getRenderableTiles().map((tile) => tile.tileX)).toEqual([0, 2]);
    expect(store.snapshot()).toMatchObject({ liveTiles: 2, tilesCreated: 3, tilesEvicted: 1 });
  });

  it("does not evict dirty or history-referenced tiles, then reclaims them after release", async () => {
    const fullTileBytes = 512 * 512 + ((512 * 512) / 8) * 2 + 96;
    const { store } = makeStore(1024, 512, undefined, fullTileBytes);
    const checkpoint = store.beginHistoryCheckpoint();
    await store.brush({ cx: 10, cy: 10, radius: 1, value: 255, shape: "square", checkpoint });
    const command = retain(store, store.finishHistoryCheckpoint(checkpoint, "stroke", 0));
    await expect(store.materializeTile(1, 0)).rejects.toBeInstanceOf(SparseMaskTileBudgetError);
    expect(store.snapshot().admissionBlocked).toBe(true);
    store.applyHistoryCommand(command);
    await expect(store.materializeTile(1, 0)).rejects.toBeInstanceOf(SparseMaskTileBudgetError);
    store.releaseHistoryCommand(command);
    await store.materializeTile(1, 0);
    expect(store.snapshot().admissionBlocked).toBe(false);
    expect(store.getRenderableTiles().map((tile) => tile.tileX)).toEqual([1]);
  });

  it("preserves untouched base intervals during sparse merge", async () => {
    const width = 1025;
    const height = 8;
    const dense = new Uint8Array(width * height);
    dense[4 * width + 1024] = 255;
    const base = encodeCocoRle(dense, width, height);
    const { store } = makeStore(width, height, base);
    await store.brush({ cx: 1, cy: 1, radius: 1, value: 255, shape: "square" });
    const merged = await store.merge();
    const decoded = decodeCocoRle(merged);
    expect(decoded[4 * width + 1024]).toBe(255);
    expect(decoded[1 * width + 1]).toBe(255);
  });

  it("disposes the Worker session and all retained tile accounting", async () => {
    const { backend, store } = makeStore(513, 513);
    await store.materializeTile(0, 0);
    store.dispose();
    expect(backend.sessions.size).toBe(0);
    expect(store.snapshot()).toMatchObject({ liveTiles: 0, retainedBytes: 0, disposed: true });
    await expect(store.materializeTile(0, 0)).rejects.toThrow(/disposed/);
  });

  it("uses the frozen tile cache device tiers", () => {
    expect(sparseMaskTileBudgetBytes(2)).toBe(32 * 1024 * 1024);
    expect(sparseMaskTileBudgetBytes(undefined)).toBe(64 * 1024 * 1024);
    expect(sparseMaskTileBudgetBytes(8)).toBe(128 * 1024 * 1024);
    expect(sparseMaskCpuComputeBudgetBytes(2)).toBe(32 * 1024 * 1024);
    expect(sparseMaskCpuComputeBudgetBytes(undefined)).toBe(64 * 1024 * 1024);
    expect(sparseMaskCpuComputeBudgetBytes(8)).toBe(128 * 1024 * 1024);
    expect(sparseMaskGpuBufferBudgetBytes(2)).toBe(0);
    expect(sparseMaskGpuBufferBudgetBytes(undefined)).toBe(64 * 1024 * 1024);
    expect(sparseMaskGpuBufferBudgetBytes(8)).toBe(128 * 1024 * 1024);
  });
});
