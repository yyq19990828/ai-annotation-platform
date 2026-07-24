import { describe, expect, it } from "vitest";
import { MaskBuffer } from "./geometry/maskBuffer";
import { decodeCocoRle, encodeCocoRle, type CocoRle } from "./geometry/maskRle";
import type { MaskHistoryCommand } from "./maskHistory";
import {
  buildRasterMaskWorkerSession,
  decodeRasterMaskSessionTile,
  mergeRasterMaskSessionTiles,
  type RasterMaskWorkerSession,
} from "./rasterMaskWorkerRuntime";
import type { RasterMaskWorkerRunOptions } from "./rasterMaskWorkerPool";
import type { RasterMaskTileOverride, RasterMaskTileRect } from "./rasterMaskWorkerProtocol";
import {
  SparseMaskTileBudgetError,
  SparseMaskTileStore,
  sparseMaskTileBudgetBytes,
  type SparseMaskTileBackend,
} from "./sparseMaskTileStore";

class RuntimeTileBackend implements SparseMaskTileBackend {
  readonly sessions = new Map<string, RasterMaskWorkerSession>();
  decodeCalls: RasterMaskTileRect[] = [];
  mergeCalls: RasterMaskTileOverride[][] = [];

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
    const fullTileBytes = 512 * 512 + (512 * 512) / 8 + 96;
    const { store } = makeStore(1536, 512, undefined, fullTileBytes * 2);
    await store.materializeTile(0, 0);
    await store.materializeTile(1, 0);
    store.containsPixel(0, 0);
    await store.materializeTile(2, 0);
    expect(store.getRenderableTiles().map((tile) => tile.tileX)).toEqual([0, 2]);
    expect(store.snapshot()).toMatchObject({ liveTiles: 2, tilesCreated: 3, tilesEvicted: 1 });
  });

  it("does not evict dirty or history-referenced tiles, then reclaims them after release", async () => {
    const fullTileBytes = 512 * 512 + (512 * 512) / 8 + 96;
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
  });
});
