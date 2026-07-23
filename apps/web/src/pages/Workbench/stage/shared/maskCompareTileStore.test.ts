import { describe, expect, it } from "vitest";
import type { CocoRle } from "./geometry/maskRle";
import type { RasterMaskWorkerRunOptions } from "./rasterMaskWorkerPool";
import type {
  RasterMaskCompareMode,
  RasterMaskCompareSessionRef,
  RasterMaskTileRect,
} from "./rasterMaskWorkerProtocol";
import {
  MaskCompareStaleGenerationError,
  MaskCompareTileStore,
  maskCompareCompanionVisible,
  type MaskCompareTileBackend,
} from "./maskCompareTileStore";
import {
  buildRasterMaskWorkerSession,
  compareRasterMaskSessionMetrics,
  compareRasterMaskSessionTile,
} from "./rasterMaskWorkerRuntime";
import type { RasterMaskWorkerSession } from "./rasterMaskWorkerRuntime";

function rle(width: number, height: number, foreground = false): CocoRle {
  return {
    encoding: "coco_rle",
    size: [height, width],
    counts: foreground ? [0, width * height] : [width * height],
  };
}

class Backend implements MaskCompareTileBackend {
  readonly sessions = new Map<string, RasterMaskWorkerSession>();
  readonly released: string[] = [];
  compareTileCalls = 0;

  registerSession(sessionId: string, sha256: string, value: CocoRle) {
    this.sessions.set(
      sessionId,
      buildRasterMaskWorkerSession(sha256, {
        size: value.size,
        counts: Uint32Array.from(value.counts),
      }),
    );
  }

  releaseSession(sessionId: string) {
    this.released.push(sessionId);
    this.sessions.delete(sessionId);
  }

  async compareTile(
    current: RasterMaskCompareSessionRef,
    baseline: RasterMaskCompareSessionRef,
    rect: RasterMaskTileRect,
    mode: RasterMaskCompareMode,
    sampleStep = 1,
    options?: RasterMaskWorkerRunOptions,
  ) {
    this.compareTileCalls += 1;
    await Promise.resolve();
    if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const currentSession = this.sessions.get(current.sessionId);
    const baselineSession = this.sessions.get(baseline.sessionId);
    if (!currentSession || !baselineSession) throw new Error("missing session");
    return {
      current,
      baseline,
      rect,
      mode,
      sampleStep,
      codes: compareRasterMaskSessionTile(currentSession, baselineSession, rect, mode, sampleStep),
    };
  }

  async compareMetrics(
    current: RasterMaskCompareSessionRef,
    baseline: RasterMaskCompareSessionRef,
  ) {
    const currentSession = this.sessions.get(current.sessionId);
    const baselineSession = this.sessions.get(baseline.sessionId);
    if (!currentSession || !baselineSession) throw new Error("missing session");
    return {
      current,
      baseline,
      metrics: compareRasterMaskSessionMetrics(currentSession, baselineSession),
    };
  }
}

describe("MaskCompareTileStore", () => {
  it("keeps at most sixteen 512px tiles and releases both immutable sessions", async () => {
    const backend = new Backend();
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(4096, 4096, true) },
      baseline: { sha256: "baseline", rle: rle(4096, 4096) },
      mode: "added",
    });

    const tiles = await store.loadViewport({ x: 0, y: 0, width: 4096, height: 4096 });
    expect(tiles).toHaveLength(16);
    expect(tiles.every((tile) => tile.rasterWidth <= 512 && tile.rasterHeight <= 512)).toBe(true);
    expect(tiles.every((tile) => tile.sampleStep === 2)).toBe(true);
    expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBe(4096 * 4096);
    expect(store.snapshot().tiles).toBe(16);
    store.dispose();
    expect(backend.released).toHaveLength(2);
    expect(store.snapshot()).toMatchObject({ tiles: 0, disposed: true });
  });

  it("discards an older viewport generation", async () => {
    const backend = new Backend();
    const gate: { release?: () => void } = {};
    const original = backend.compareTile.bind(backend);
    backend.compareTile = async (...args) => {
      if (!gate.release)
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      return original(...args);
    };
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(1024, 512, true) },
      baseline: { sha256: "baseline", rle: rle(1024, 512) },
      mode: "overlay",
    });
    const first = store.loadViewport({ x: 0, y: 0, width: 512, height: 512 });
    const second = store.loadViewport({ x: 512, y: 0, width: 512, height: 512 });
    gate.release?.();

    await expect(first).rejects.toSatisfy(
      (error) =>
        error instanceof MaskCompareStaleGenerationError ||
        (error instanceof DOMException && error.name === "AbortError"),
    );
    await expect(second).resolves.toHaveLength(2);
    store.dispose();
  });

  it("相同 tile 签名复用在途请求且不取消 Worker", async () => {
    const backend = new Backend();
    const gate: { release?: () => void } = {};
    const original = backend.compareTile.bind(backend);
    backend.compareTile = async (...args) => {
      if (!gate.release)
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      return original(...args);
    };
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(1024, 512, true) },
      baseline: { sha256: "baseline", rle: rle(1024, 512) },
      mode: "overlay",
    });

    const first = store.loadViewport({ x: 0, y: 0, width: 400, height: 400 });
    const second = store.loadViewport({ x: 8, y: 8, width: 400, height: 400 });
    expect(store.viewportSignature({ x: 0, y: 0, width: 400, height: 400 })).toBe(
      store.viewportSignature({ x: 8, y: 8, width: 400, height: 400 }),
    );
    gate.release?.();
    await expect(first).rejects.toBeInstanceOf(MaskCompareStaleGenerationError);
    const secondTiles = await second;
    expect(secondTiles).toHaveLength(2);
    expect(backend.compareTileCalls).toBe(2);
    store.dispose();
  });

  it("连续不同视口只在当前加载完成后执行最新一代", async () => {
    const backend = new Backend();
    const gate: { release?: () => void } = {};
    const original = backend.compareTile.bind(backend);
    backend.compareTile = async (...args) => {
      if (!gate.release)
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      return original(...args);
    };
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(2048, 512, true) },
      baseline: { sha256: "baseline", rle: rle(2048, 512) },
      mode: "overlay",
    });
    const first = store.loadViewport({ x: 0, y: 0, width: 512, height: 512 });
    const middle = store.loadViewport({ x: 512, y: 0, width: 512, height: 512 });
    const latest = store.loadViewport({ x: 1536, y: 0, width: 512, height: 512 });
    gate.release?.();

    await expect(first).rejects.toBeInstanceOf(MaskCompareStaleGenerationError);
    await expect(middle).rejects.toBeInstanceOf(MaskCompareStaleGenerationError);
    await expect(latest).resolves.toHaveLength(2);
    store.dispose();
  });

  it("A→B→A 快速回切时保留 A 且不启动过期 B", async () => {
    const backend = new Backend();
    const gate: { release?: () => void } = {};
    const original = backend.compareTile.bind(backend);
    backend.compareTile = async (...args) => {
      if (!gate.release)
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      return original(...args);
    };
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(1024, 512, true) },
      baseline: { sha256: "baseline", rle: rle(1024, 512) },
      mode: "overlay",
    });
    const viewportA = { x: 0, y: 0, width: 400, height: 400 };
    const viewportB = { x: 600, y: 0, width: 400, height: 400 };
    const firstA = store.loadViewport(viewportA);
    const staleB = store.loadViewport(viewportB);
    const latestA = store.loadViewport(viewportA);
    gate.release?.();

    await expect(firstA).rejects.toBeInstanceOf(MaskCompareStaleGenerationError);
    await expect(staleB).rejects.toBeInstanceOf(MaskCompareStaleGenerationError);
    await expect(latestA).resolves.toHaveLength(2);
    expect(backend.compareTileCalls).toBe(2);
    expect(store.snapshot().tiles).toBe(2);
    store.dispose();
  });

  it("为 8K 全视口选择有界 LOD，不截断可见区", async () => {
    const backend = new Backend();
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(8192, 8192, true) },
      baseline: { sha256: "baseline", rle: rle(8192, 8192) },
      mode: "overlay",
    });
    const tiles = await store.loadViewport({ x: 0, y: 0, width: 8192, height: 8192 });
    expect(tiles).toHaveLength(16);
    expect(tiles.every((tile) => tile.sampleStep === 4)).toBe(true);
    expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBe(8192 * 8192);
    store.dispose();
  });

  it("切换对比模式时复用同一对 session", async () => {
    const backend = new Backend();
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(512, 512, true) },
      baseline: { sha256: "baseline", rle: rle(512, 512) },
      mode: "overlay",
    });
    await store.loadViewport({ x: 0, y: 0, width: 512, height: 512 });
    store.setMode("xor");
    expect(backend.released).toHaveLength(0);
    expect(backend.sessions.size).toBe(2);
    const tiles = await store.loadViewport({ x: 0, y: 0, width: 512, height: 512 });
    expect(tiles[0].codes.every((value) => value === 2)).toBe(true);
    await expect(store.metrics()).resolves.toMatchObject({
      currentAreaPixels: 512 * 512,
      baselineAreaPixels: 0,
      changedPixels: 512 * 512,
    });
    store.dispose();
  });

  it("携带只读展示上下文，供画布隐藏参与比较的伴随图层", () => {
    const backend = new Backend();
    const store = new MaskCompareTileStore({
      backend,
      current: { sha256: "current", rle: rle(16, 16, true) },
      baseline: { sha256: "baseline", rle: rle(16, 16) },
      mode: "xor",
      display: {
        annotationId: "annotation-1",
        hideAiCandidate: true,
        hideTrackerCandidate: false,
      },
    });
    expect(store.display).toEqual({
      annotationId: "annotation-1",
      hideAiCandidate: true,
      hideTrackerCandidate: false,
    });
    expect(
      maskCompareCompanionVisible(store.display, {
        source: "annotation",
        id: "annotation-1",
      }),
    ).toBe(false);
    expect(
      maskCompareCompanionVisible(store.display, {
        source: "annotation",
        id: "annotation-2",
      }),
    ).toBe(true);
    expect(maskCompareCompanionVisible(store.display, { source: "ai" })).toBe(false);
    expect(maskCompareCompanionVisible(store.display, { source: "tracker" })).toBe(true);
    store.dispose();
  });
});
